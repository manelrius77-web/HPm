from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from pymongo import ReturnDocument
from datetime import datetime

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# =====================
# MODELS
# =====================

class Piece(BaseModel):
    """A piece to cut from the board"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    length: float  # mm
    width: float   # mm
    quantity: int = 1
    can_rotate: bool = False  # Default: respect grain direction (veta)
    edged_long: int = 0  # Number of long sides with edge banding (0, 1, 2)
    edged_short: int = 0  # Number of short sides with edge banding (0, 1, 2)

class Board(BaseModel):
    """Board/panel dimensions"""
    length: float  # mm
    width: float   # mm

class CutRequest(BaseModel):
    """Request for cutting optimization"""
    board: Board
    pieces: List[Piece]
    kerf: float = 3.0  # blade thickness in mm

class PlacedPiece(BaseModel):
    """A piece placed on a board"""
    piece_id: str
    name: str
    x: float
    y: float
    length: float
    width: float
    rotated: bool = False

class BoardLayout(BaseModel):
    """Layout of pieces on a single board"""
    board_number: int
    board_length: float
    board_width: float
    pieces: List[PlacedPiece]
    utilization: float  # percentage

class CutResult(BaseModel):
    """Result of cutting optimization"""
    total_boards: int
    board_layouts: List[BoardLayout]
    total_pieces: int
    pieces_placed: int
    waste_percentage: float
    unplaced_pieces: List[dict] = []
    total_cuts: int = 0  # Total number of cuts needed
    total_edge_meters: float = 0.0  # Total meters of edge banding needed

# =====================
# PROJECT MODELS (for saving)
# =====================

class ProjectPiece(BaseModel):
    """Piece data for saving in project"""
    id: str
    name: str
    length: float
    width: float
    quantity: int
    can_rotate: bool = False
    edged_long: int = 0  # Long sides with edge banding
    edged_short: int = 0  # Short sides with edge banding

class ProjectCreate(BaseModel):
    """Create a new project"""
    name: str
    board_length: float
    board_width: float
    kerf: float = 3.0
    pieces: List[ProjectPiece]

class Project(BaseModel):
    """Saved project"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    board_length: float
    board_width: float
    kerf: float
    pieces: List[ProjectPiece]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

# =====================
# CUTTING ALGORITHM
# =====================

class GuillotineBinPacker:
    """2D Bin Packing with Guillotine cuts (straight cuts only)"""
    
    def __init__(self, width: float, height: float, kerf: float = 3.0):
        self.bin_width = width
        self.bin_height = height
        self.kerf = kerf
        self.free_rectangles = [(0, 0, width, height)]  # (x, y, w, h)
        self.placed_pieces = []
    
    def find_best_fit(self, piece_w: float, piece_h: float, can_rotate: bool = True):
        """Find the best free rectangle to place the piece"""
        best_rect = None
        best_idx = -1
        best_score = float('inf')
        rotated = False
        
        for idx, (rx, ry, rw, rh) in enumerate(self.free_rectangles):
            # Try normal orientation
            if piece_w <= rw and piece_h <= rh:
                score = min(rw - piece_w, rh - piece_h)  # Best short side fit
                if score < best_score:
                    best_score = score
                    best_rect = (rx, ry, rw, rh)
                    best_idx = idx
                    rotated = False
            
            # Try rotated orientation only if allowed (respects grain direction)
            if can_rotate and piece_h <= rw and piece_w <= rh:
                score = min(rw - piece_h, rh - piece_w)
                if score < best_score:
                    best_score = score
                    best_rect = (rx, ry, rw, rh)
                    best_idx = idx
                    rotated = True
        
        return best_rect, best_idx, rotated
    
    def split_free_rectangle(self, rect_idx: int, piece_x: float, piece_y: float, 
                              piece_w: float, piece_h: float):
        """Split the free rectangle after placing a piece (guillotine cut)"""
        rx, ry, rw, rh = self.free_rectangles[rect_idx]
        del self.free_rectangles[rect_idx]
        
        # Add kerf to piece dimensions for splitting
        pw_with_kerf = piece_w + self.kerf
        ph_with_kerf = piece_h + self.kerf
        
        # Right rectangle (to the right of the piece)
        right_w = rw - pw_with_kerf
        if right_w > self.kerf:  # Only if meaningful space
            self.free_rectangles.append((rx + pw_with_kerf, ry, right_w, rh))
        
        # Top rectangle (above the piece, but only the width of the piece)
        top_h = rh - ph_with_kerf
        if top_h > self.kerf:  # Only if meaningful space
            self.free_rectangles.append((rx, ry + ph_with_kerf, piece_w, top_h))
    
    def place_piece(self, piece_id: str, name: str, piece_w: float, piece_h: float, can_rotate: bool = True) -> Optional[PlacedPiece]:
        """Try to place a piece on this board"""
        best_rect, best_idx, rotated = self.find_best_fit(piece_w, piece_h, can_rotate)
        
        if best_rect is None:
            return None
        
        rx, ry, rw, rh = best_rect
        
        if rotated:
            piece_w, piece_h = piece_h, piece_w
        
        placed = PlacedPiece(
            piece_id=piece_id,
            name=name,
            x=rx,
            y=ry,
            length=piece_w,
            width=piece_h,
            rotated=rotated
        )
        
        self.placed_pieces.append(placed)
        self.split_free_rectangle(best_idx, rx, ry, piece_w, piece_h)
        
        return placed
    
    def get_utilization(self) -> float:
        """Calculate utilization percentage"""
        if not self.placed_pieces:
            return 0.0
        
        used_area = sum(p.length * p.width for p in self.placed_pieces)
        total_area = self.bin_width * self.bin_height
        return (used_area / total_area) * 100


def optimize_cutting(request: CutRequest) -> CutResult:
    """Main optimization function"""
    board = request.board
    kerf = request.kerf
    
    # Build piece lookup for edge banding calculation
    piece_edge_info = {}
    for piece in request.pieces:
        piece_edge_info[piece.id] = {
            'length': piece.length,
            'width': piece.width,
            'edged_long': piece.edged_long,
            'edged_short': piece.edged_short
        }
    
    # Expand pieces by quantity and sort by area (largest first)
    expanded_pieces = []
    for piece in request.pieces:
        for i in range(piece.quantity):
            expanded_pieces.append({
                'id': f"{piece.id}_{i}",
                'original_id': piece.id,
                'name': piece.name,
                'length': piece.length,
                'width': piece.width,
                'area': piece.length * piece.width,
                'can_rotate': piece.can_rotate
            })
    
    # Sort by area descending (FFD - First Fit Decreasing)
    expanded_pieces.sort(key=lambda x: x['area'], reverse=True)
    
    total_pieces = len(expanded_pieces)
    boards: List[GuillotineBinPacker] = []
    unplaced = []
    placed_pieces_info = []  # Track placed pieces for edge calculation
    
    for piece in expanded_pieces:
        placed = False
        
        # Try to place on existing boards
        for board_packer in boards:
            result = board_packer.place_piece(
                piece['id'], piece['name'], piece['length'], piece['width'], piece['can_rotate']
            )
            if result:
                placed = True
                placed_pieces_info.append({
                    'original_id': piece['original_id'],
                    'rotated': result.rotated
                })
                break
        
        # If not placed, create a new board
        if not placed:
            new_board = GuillotineBinPacker(board.length, board.width, kerf)
            result = new_board.place_piece(
                piece['id'], piece['name'], piece['length'], piece['width'], piece['can_rotate']
            )
            if result:
                boards.append(new_board)
                placed = True
                placed_pieces_info.append({
                    'original_id': piece['original_id'],
                    'rotated': result.rotated
                })
            else:
                # Piece is too large for the board
                unplaced.append({
                    'name': piece['name'],
                    'length': piece['length'],
                    'width': piece['width'],
                    'reason': 'Pieza demasiado grande para el tablero'
                })
    
    # Calculate total edge banding meters
    total_edge_mm = 0
    for placed in placed_pieces_info:
        info = piece_edge_info[placed['original_id']]
        length = info['length']
        width = info['width']
        
        # If rotated, swap dimensions for edge calculation
        if placed['rotated']:
            length, width = width, length
        
        # Add edge banding: long sides use length, short sides use width
        total_edge_mm += info['edged_long'] * length
        total_edge_mm += info['edged_short'] * width
    
    total_edge_meters = round(total_edge_mm / 100, 2)  # cm to meters
    
    # Calculate total cuts (each placed piece needs cuts to separate it)
    total_cuts = sum(len(b.placed_pieces) for b in boards)
    
    # Build result
    board_layouts = []
    total_utilization = 0
    
    for idx, board_packer in enumerate(boards):
        utilization = board_packer.get_utilization()
        total_utilization += utilization
        
        board_layouts.append(BoardLayout(
            board_number=idx + 1,
            board_length=board.length,
            board_width=board.width,
            pieces=board_packer.placed_pieces,
            utilization=round(utilization, 1)
        ))
    
    pieces_placed = total_pieces - len(unplaced)
    avg_utilization = total_utilization / len(boards) if boards else 0
    waste_percentage = 100 - avg_utilization
    
    return CutResult(
        total_boards=len(boards),
        board_layouts=board_layouts,
        total_pieces=total_pieces,
        pieces_placed=pieces_placed,
        waste_percentage=round(waste_percentage, 1),
        unplaced_pieces=unplaced,
        total_cuts=total_cuts,
        total_edge_meters=total_edge_meters
    )

# =====================
# API ROUTES
# =====================

@api_router.get("/")
async def root():
    return {"message": "Wood Cutting Optimizer API"}

@api_router.post("/optimize", response_model=CutResult)
async def optimize_cut(request: CutRequest):
    """Optimize cutting layout for given pieces and board"""
    try:
        # Validate inputs
        if request.board.length <= 0 or request.board.width <= 0:
            raise HTTPException(status_code=400, detail="Las dimensiones del tablero deben ser positivas")
        
        if not request.pieces:
            raise HTTPException(status_code=400, detail="Debe agregar al menos una pieza")
        
        for piece in request.pieces:
            if piece.length <= 0 or piece.width <= 0:
                raise HTTPException(status_code=400, detail=f"Las dimensiones de '{piece.name}' deben ser positivas")
            if piece.quantity < 1:
                raise HTTPException(status_code=400, detail=f"La cantidad de '{piece.name}' debe ser al menos 1")
        
        result = optimize_cutting(request)
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error in optimization: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error en la optimización: {str(e)}")

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "wood-cutting-optimizer"}

# =====================
# PROJECT CRUD ROUTES
# =====================

@api_router.post("/projects", response_model=Project)
async def create_project(project: ProjectCreate):
    """Save a new project"""
    try:
        project_obj = Project(
            name=project.name,
            board_length=project.board_length,
            board_width=project.board_width,
            kerf=project.kerf,
            pieces=[ProjectPiece(**p.dict()) for p in project.pieces]
        )
        await db.projects.insert_one(project_obj.dict())
        return project_obj
    except Exception as e:
        logging.error(f"Error creating project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al guardar proyecto: {str(e)}")

@api_router.get("/projects", response_model=List[Project])
async def get_projects():
    """Get all saved projects"""
    try:
        projects = await db.projects.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
        return [Project(**p) for p in projects]
    except Exception as e:
        logging.error(f"Error fetching projects: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al obtener proyectos: {str(e)}")

@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str):
    """Get a specific project by ID"""
    try:
        project = await db.projects.find_one({"id": project_id})
        if not project:
            raise HTTPException(status_code=404, detail="Proyecto no encontrado")
        return Project(**project)
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error fetching project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al obtener proyecto: {str(e)}")

@api_router.put("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, project: ProjectCreate):
    """Update an existing project"""
    try:
        updated_data = {
            "name": project.name,
            "board_length": project.board_length,
            "board_width": project.board_width,
            "kerf": project.kerf,
            "pieces": [p.dict() for p in project.pieces],
            "updated_at": datetime.utcnow()
        }
        
        updated_project = await db.projects.find_one_and_update(
            {"id": project_id},
            {"$set": updated_data},
            return_document=ReturnDocument.AFTER
        )
        if not updated_project:
            raise HTTPException(status_code=404, detail="Proyecto no encontrado")
        return Project(**updated_project)
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error updating project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al actualizar proyecto: {str(e)}")

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project"""
    try:
        result = await db.projects.delete_one({"id": project_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Proyecto no encontrado")
        return {"message": "Proyecto eliminado correctamente"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error deleting project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al eliminar proyecto: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
