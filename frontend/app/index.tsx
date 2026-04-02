import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
  Switch,
  Modal,
  FlatList,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types
interface Piece {
  id: string;
  name: string;
  length: string;
  width: string;
  quantity: string;
  canRotate: boolean;
  edgedLong: number; // 0, 1, 2 cantos en lados largos
  edgedShort: number; // 0, 1, 2 cantos en lados cortos
}

interface PlacedPiece {
  piece_id: string;
  name: string;
  x: number;
  y: number;
  length: number;
  width: number;
  rotated: boolean;
}

interface BoardLayout {
  board_number: number;
  board_length: number;
  board_width: number;
  pieces: PlacedPiece[];
  utilization: number;
}

interface CutResult {
  total_boards: number;
  board_layouts: BoardLayout[];
  total_pieces: number;
  pieces_placed: number;
  waste_percentage: number;
  unplaced_pieces: { name: string; length: number; width: number; reason: string }[];
  total_cuts: number;
  total_edge_meters: number;
}

interface SavedProject {
  id: string;
  name: string;
  board_length: number;
  board_width: number;
  kerf: number;
  pieces: {
    id: string;
    name: string;
    length: number;
    width: number;
    quantity: number;
    can_rotate: boolean;
    edged_long: number;
    edged_short: number;
  }[];
  created_at: string;
  updated_at: string;
}

// Color palette for pieces
const PIECE_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FFC107', '#795548', '#607D8B', '#F44336',
  '#3F51B5', '#009688', '#CDDC39', '#FF5722', '#673AB7',
];

// Helper: Generate a color map based on piece dimensions (same size = same color)
const getDimensionColorMap = (pieces: PlacedPiece[]): Record<string, string> => {
  const colorMap: Record<string, string> = {};
  let colorIndex = 0;
  pieces.forEach((piece) => {
    // Normalize: always use smaller x larger as key
    const dims = [piece.length, piece.width].sort((a, b) => a - b);
    const key = `${dims[0]}x${dims[1]}`;
    if (!(key in colorMap)) {
      colorMap[key] = PIECE_COLORS[colorIndex % PIECE_COLORS.length];
      colorIndex++;
    }
  });
  return colorMap;
};

// Build a global color map from ALL boards' pieces
const getGlobalDimensionColorMap = (layouts: BoardLayout[]): Record<string, string> => {
  const colorMap: Record<string, string> = {};
  let colorIndex = 0;
  layouts.forEach((layout) => {
    layout.pieces.forEach((piece) => {
      const dims = [piece.length, piece.width].sort((a, b) => a - b);
      const key = `${dims[0]}x${dims[1]}`;
      if (!(key in colorMap)) {
        colorMap[key] = PIECE_COLORS[colorIndex % PIECE_COLORS.length];
        colorIndex++;
      }
    });
  });
  return colorMap;
};

export default function Index() {
  // Board state
  const [showWelcome, setShowWelcome] = useState(true);
  const [boardLength, setBoardLength] = useState('244');
  const [boardWidth, setBoardWidth] = useState('122');
  const [kerf, setKerf] = useState('0.3');

  // Pieces state
  const [pieces, setPieces] = useState<Piece[]>([]);

  // Result state
  const [result, setResult] = useState<CutResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'result' | 'projects'>('input');

  // Projects state
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);

  // Calculator state
  const [calculatorVisible, setCalculatorVisible] = useState(false);
  const [calculatorValue, setCalculatorValue] = useState('');
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);

  // Export options state
  const [exportOptionsVisible, setExportOptionsVisible] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Pricing state
  const [pricingVisible, setPricingVisible] = useState(false);
  const [boardPrice, setBoardPrice] = useState('');
  const [backBoardPrice, setBackBoardPrice] = useState('');
  const [edgePrice, setEdgePrice] = useState('');
  const [cutPrice, setCutPrice] = useState('');
  const [pricingSaved, setPricingSaved] = useState(false);

  // Furniture template state
  const [templateVisible, setTemplateVisible] = useState(false);
  const [templateType, setTemplateType] = useState<'armario' | 'estanteria' | 'cajonera' | 'mesa'>('armario');
  const [templateAlto, setTemplateAlto] = useState('');
  const [templateAncho, setTemplateAncho] = useState('');
  const [templateFondo, setTemplateFondo] = useState('');
  const [templateGrosor, setTemplateGrosor] = useState('1.9');
  const [templateEstantes, setTemplateEstantes] = useState('2');
  const [templatePuertas, setTemplatePuertas] = useState('2');
  const [templateCajones, setTemplateCajones] = useState('3');
  const [templateDivisiones, setTemplateDivisiones] = useState('0');
  const [templateTrasera, setTemplateTrasera] = useState(true);
  const [templateGrosorTrasera, setTemplateGrosorTrasera] = useState('0.32');

  // Scroll ref
  const scrollViewRef = useRef<ScrollView>(null);

  // Pricing calculations
  const getPricingTotals = () => {
    if (!result) return null;
    const bp = parseFloat(boardPrice) || 0;
    const bbp = parseFloat(backBoardPrice) || 0;
    const ep = parseFloat(edgePrice) || 0;
    const cp = parseFloat(cutPrice) || 0;
    // Count back panels (pieces named "Trasera" or similar)
    const backPanels = pieces.filter(p => p.name.toLowerCase().includes('trasera')).reduce((sum, p) => sum + (parseInt(p.quantity) || 0), 0);
    const regularBoards = result.total_boards;
    const totalBoards = bp * regularBoards;
    const totalBackBoards = bbp * backPanels;
    const totalEdge = ep * (result.total_edge_meters || 0);
    const totalCuts = cp * result.total_cuts;
    const total = totalBoards + totalBackBoards + totalEdge + totalCuts;
    return { totalBoards, totalBackBoards, totalEdge, totalCuts, total, bp, bbp, ep, cp, backPanels, regularBoards };
  };

  // Load projects on mount
  useEffect(() => {
    if (activeTab === 'projects') {
      loadProjects();
    }
  }, [activeTab]);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/projects`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const addPiece = () => {
    const newId = String(Date.now());
    setPieces([...pieces, { id: newId, name: `Pieza ${pieces.length + 1}`, length: '', width: '', quantity: '0', canRotate: false, edgedLong: 0, edgedShort: 0 }]);
    // Scroll to bottom after adding piece
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Furniture template piece generation
  const generateTemplatePieces = () => {
    const alto = parseFloat(templateAlto);
    const ancho = parseFloat(templateAncho);
    const fondo = parseFloat(templateFondo);
    const g = parseFloat(templateGrosor);
    const gT = parseFloat(templateGrosorTrasera) || 0.5;
    const nEstantes = parseInt(templateEstantes) || 0;
    const nPuertas = parseInt(templatePuertas) || 0;
    const nCajones = parseInt(templateCajones) || 0;
    const nDivisiones = parseInt(templateDivisiones) || 0;

    if (!alto || !ancho || !fondo || !g) {
      Alert.alert('Error', 'Rellena todas las medidas');
      return;
    }

    const newPieces: Piece[] = [];
    const ts = () => String(Date.now() + Math.random() * 1000);

    const interiorAncho = ancho - (2 * g);
    const interiorFondo = templateTrasera ? fondo - gT : fondo;

    if (templateType === 'armario') {
      // Laterales exteriores
      newPieces.push({ id: ts(), name: 'Lateral', length: String(alto), width: String(fondo), quantity: '2', canRotate: false, edgedLong: 1, edgedShort: 0 });
      // Techo
      newPieces.push({ id: ts(), name: 'Techo', length: String(interiorAncho), width: String(fondo), quantity: '1', canRotate: false, edgedLong: 0, edgedShort: 1 });
      // Suelo
      newPieces.push({ id: ts(), name: 'Suelo', length: String(interiorAncho), width: String(fondo), quantity: '1', canRotate: false, edgedLong: 0, edgedShort: 1 });

      // Divisiones verticales
      const nSections = nDivisiones + 1; // número de secciones
      const interiorAlto = parseFloat((alto - (2 * g)).toFixed(1));
      
      if (nDivisiones > 0) {
        // Divisores verticales: van de suelo a techo interior
        newPieces.push({ id: ts(), name: 'División vertical', length: String(interiorAlto), width: String(interiorFondo), quantity: String(nDivisiones), canRotate: false, edgedLong: 1, edgedShort: 0 });
      }

      // Estantes: ancho de cada sección descontando divisores
      if (nEstantes > 0) {
        const anchoSeccion = parseFloat(((interiorAncho - (nDivisiones * g)) / nSections).toFixed(1));
        newPieces.push({ id: ts(), name: 'Estante', length: String(anchoSeccion), width: String(interiorFondo), quantity: String(nEstantes * nSections), canRotate: false, edgedLong: 0, edgedShort: 1 });
      }

      // Puertas
      if (nPuertas > 0) {
        const puertaAncho = parseFloat((ancho / nPuertas).toFixed(1));
        newPieces.push({ id: ts(), name: 'Puerta', length: String(alto), width: String(puertaAncho), quantity: String(nPuertas), canRotate: false, edgedLong: 2, edgedShort: 2 });
      }
      // Trasera
      if (templateTrasera) {
        newPieces.push({ id: ts(), name: 'Trasera', length: String(interiorAlto), width: String(interiorAncho), quantity: '1', canRotate: true, edgedLong: 0, edgedShort: 0 });
      }
    } else if (templateType === 'estanteria') {
      // Laterales
      newPieces.push({ id: ts(), name: 'Lateral', length: String(alto), width: String(fondo), quantity: '2', canRotate: false, edgedLong: 1, edgedShort: 0 });
      // Estantes (incluye techo y suelo)
      newPieces.push({ id: ts(), name: 'Estante', length: String(interiorAncho), width: String(interiorFondo), quantity: String(nEstantes + 2), canRotate: false, edgedLong: 0, edgedShort: 1 });
      // Trasera
      if (templateTrasera) {
        newPieces.push({ id: ts(), name: 'Trasera', length: String(alto), width: String(interiorAncho), quantity: '1', canRotate: true, edgedLong: 0, edgedShort: 0 });
      }
    } else if (templateType === 'cajonera') {
      // Laterales
      newPieces.push({ id: ts(), name: 'Lateral', length: String(alto), width: String(fondo), quantity: '2', canRotate: false, edgedLong: 1, edgedShort: 0 });
      // Techo
      newPieces.push({ id: ts(), name: 'Techo', length: String(interiorAncho), width: String(fondo), quantity: '1', canRotate: false, edgedLong: 0, edgedShort: 1 });
      // Suelo
      newPieces.push({ id: ts(), name: 'Suelo', length: String(interiorAncho), width: String(fondo), quantity: '1', canRotate: false, edgedLong: 0, edgedShort: 1 });
      // Cajones
      if (nCajones > 0) {
        const alturaCajon = parseFloat(((alto - (2 * g)) / nCajones - g).toFixed(1));
        const fondoCajon = parseFloat((interiorFondo - 3).toFixed(1)); // 3cm para guías
        const anchoCajon = parseFloat((interiorAncho - 2.6).toFixed(1)); // holgura guías
        // Frentes cajón
        newPieces.push({ id: ts(), name: 'Frente cajón', length: String(interiorAncho), width: String(parseFloat((alturaCajon + g).toFixed(1))), quantity: String(nCajones), canRotate: false, edgedLong: 2, edgedShort: 2 });
        // Laterales cajón
        newPieces.push({ id: ts(), name: 'Lateral cajón', length: String(fondoCajon), width: String(alturaCajon), quantity: String(nCajones * 2), canRotate: false, edgedLong: 0, edgedShort: 1 });
        // Trasera cajón
        newPieces.push({ id: ts(), name: 'Trasera cajón', length: String(parseFloat((anchoCajon - (2 * g)).toFixed(1))), width: String(alturaCajon), quantity: String(nCajones), canRotate: false, edgedLong: 0, edgedShort: 0 });
        // Fondo cajón
        newPieces.push({ id: ts(), name: 'Fondo cajón', length: String(anchoCajon), width: String(fondoCajon), quantity: String(nCajones), canRotate: true, edgedLong: 0, edgedShort: 0 });
      }
      // Trasera
      if (templateTrasera) {
        newPieces.push({ id: ts(), name: 'Trasera', length: String(alto - (2 * g)), width: String(interiorAncho), quantity: '1', canRotate: true, edgedLong: 0, edgedShort: 0 });
      }
    } else if (templateType === 'mesa') {
      // Sobre
      newPieces.push({ id: ts(), name: 'Sobre', length: String(ancho), width: String(fondo), quantity: '1', canRotate: false, edgedLong: 2, edgedShort: 2 });
      // Patas (si alto > grosor)
      const altoPata = parseFloat((alto - g).toFixed(1));
      newPieces.push({ id: ts(), name: 'Pata', length: String(altoPata), width: String(8), quantity: '4', canRotate: false, edgedLong: 2, edgedShort: 0 });
      // Travesaños
      newPieces.push({ id: ts(), name: 'Travesaño largo', length: String(parseFloat((ancho - 16).toFixed(1))), width: String(10), quantity: '2', canRotate: false, edgedLong: 0, edgedShort: 0 });
      newPieces.push({ id: ts(), name: 'Travesaño ancho', length: String(parseFloat((fondo - 16).toFixed(1))), width: String(10), quantity: '2', canRotate: false, edgedLong: 0, edgedShort: 0 });
    }

    setPieces([...pieces, ...newPieces]);
    setTemplateVisible(false);
    Alert.alert('Plantilla aplicada', `Se han añadido ${newPieces.length} tipos de piezas`);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 200);
  };

  // Calculator functions
  const openCalculator = () => {
    if (pieces.length === 0) {
      Alert.alert('Error', 'Primero agrega una pieza');
      return;
    }
    setSelectedPieceId(pieces[pieces.length - 1].id); // Select last piece by default
    setCalculatorValue('');
    setCalculatorVisible(true);
  };

  const handleCalculatorPress = (key: string) => {
    if (key === 'C') {
      setCalculatorValue('');
    } else if (key === '⌫') {
      setCalculatorValue(calculatorValue.slice(0, -1));
    } else if (key === '=') {
      try {
        const result = eval(calculatorValue.replace(/x/g, '*').replace(/÷/g, '/'));
        if (!isNaN(result) && isFinite(result)) {
          setCalculatorValue(String(Math.round(result * 100) / 100));
        }
      } catch (e) {
        // Invalid expression
      }
    } else if (key === 'Largo' || key === 'Ancho' || key === 'Cant.') {
      if (selectedPieceId && calculatorValue) {
        const field = key === 'Largo' ? 'length' : key === 'Ancho' ? 'width' : 'quantity';
        updatePiece(selectedPieceId, field, calculatorValue);
        Alert.alert('Aplicado', `${calculatorValue} aplicado a ${key}`);
      }
      setCalculatorVisible(false);
    } else {
      setCalculatorValue(calculatorValue + key);
    }
  };

  // Export to PDF function
  const generatePDFHtml = () => {
    if (!result) return '';

    // Build global color map for consistent colors across boards
    const globalColorMap = getGlobalDimensionColorMap(result.board_layouts);

    const piecesHtml = pieces.filter(p => p.length && p.width).map((piece, index) => {
      const dims = [parseFloat(piece.length), parseFloat(piece.width)].sort((a, b) => a - b);
      const key = `${dims[0]}x${dims[1]}`;
      const color = globalColorMap[key] || PIECE_COLORS[index % PIECE_COLORS.length];
      return `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;"><span style="display:inline-block;width:14px;height:14px;background:${color};border-radius:3px;vertical-align:middle;margin-right:6px;"></span>${piece.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${piece.length} x ${piece.width} cm</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${piece.quantity}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${piece.canRotate ? 'Sí' : 'No'}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${piece.edgedLong}L / ${piece.edgedShort}A</td>
      </tr>
    `}).join('');

    const boardsHtml = result.board_layouts.map(layout => `
      <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0;">Tablero ${layout.board_number}</h3>
        <p><strong>Dimensiones:</strong> ${layout.board_length} x ${layout.board_width} cm</p>
        <p><strong>Aprovechamiento:</strong> ${layout.utilization.toFixed(1)}%</p>
        <p><strong>Piezas:</strong></p>
        <ul>
          ${layout.pieces.map(p => `<li>${p.name}: ${p.length}x${p.width}cm en posición (${p.x.toFixed(1)}, ${p.y.toFixed(1)})${p.rotated ? ' - Rotada' : ''}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Despiece de Corte</title>
        <style>
          body { font-family: -apple-system, Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1 { color: #4CAF50; font-size: 22px; }
          h2 { font-size: 18px; }
          .summary { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
          .summary-card { background: #f5f5f5; padding: 12px; border-radius: 8px; text-align: center; flex: 1; min-width: 60px; }
          .summary-number { font-size: 22px; font-weight: bold; color: #333; }
          .summary-label { color: #666; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
          th { background: #4CAF50; color: white; padding: 8px; text-align: left; }
          td { padding: 6px; border: 1px solid #ddd; }
          .buttons { 
            position: sticky; top: 0; background: #fff; padding: 10px 0; 
            display: flex; gap: 10px; border-bottom: 2px solid #4CAF50; margin-bottom: 15px;
          }
          .btn { 
            flex: 1; padding: 14px; border: none; border-radius: 10px; 
            font-size: 15px; font-weight: 600; cursor: pointer; color: white;
          }
          .btn-green { background: #4CAF50; }
          .btn-blue { background: #2196F3; }
          @media print { .buttons { display: none !important; } }
        </style>
      </head>
      <body>
        <div class="buttons">
          <button class="btn btn-blue" onclick="compartir()">📤 Compartir</button>
        </div>

        <h1>Despiece de Corte</h1>
        
        <h2>Resumen</h2>
        <div class="summary">
          <div class="summary-card">
            <div class="summary-number">${result.total_boards}</div>
            <div class="summary-label">Tableros</div>
          </div>
          <div class="summary-card">
            <div class="summary-number">${result.total_cuts}</div>
            <div class="summary-label">Cortes</div>
          </div>
          <div class="summary-card">
            <div class="summary-number">${result.waste_percentage}%</div>
            <div class="summary-label">Desperdicio</div>
          </div>
          ${result.total_edge_meters > 0 ? `
          <div class="summary-card">
            <div class="summary-number">${result.total_edge_meters}m</div>
            <div class="summary-label">Canto</div>
          </div>
          ` : ''}
        </div>

        <h2>Tablero Base</h2>
        <p><strong>Dimensiones:</strong> ${boardLength} x ${boardWidth} cm</p>
        <p><strong>Grosor de corte:</strong> ${kerf} cm</p>

        <h2>Lista de Piezas</h2>
        <table>
          <tr>
            <th>Nombre</th>
            <th>Medidas</th>
            <th>Cant.</th>
            <th>Rota</th>
            <th>Cantos</th>
          </tr>
          ${piecesHtml}
        </table>

        <h2>Distribución por Tablero</h2>
        ${boardsHtml}

        ${pricingSaved && (parseFloat(boardPrice) > 0 || parseFloat(backBoardPrice) > 0 || parseFloat(edgePrice) > 0 || parseFloat(cutPrice) > 0) ? `
        <h2>Presupuesto</h2>
        <table>
          <tr><th>Concepto</th><th>Detalle</th><th>Importe</th></tr>
          ${parseFloat(boardPrice) > 0 ? `<tr><td style="padding:8px;border:1px solid #ddd;">Tableros</td><td style="padding:8px;border:1px solid #ddd;">${result.total_boards} x ${parseFloat(boardPrice).toFixed(2)}€</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${(result.total_boards * parseFloat(boardPrice)).toFixed(2)}€</td></tr>` : ''}
          ${parseFloat(backBoardPrice) > 0 && (getPricingTotals()?.backPanels || 0) > 0 ? `<tr><td style="padding:8px;border:1px solid #ddd;">Traseras</td><td style="padding:8px;border:1px solid #ddd;">${getPricingTotals()?.backPanels} x ${parseFloat(backBoardPrice).toFixed(2)}€</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${getPricingTotals()?.totalBackBoards.toFixed(2)}€</td></tr>` : ''}
          ${parseFloat(edgePrice) > 0 && result.total_edge_meters > 0 ? `<tr><td style="padding:8px;border:1px solid #ddd;">Canto</td><td style="padding:8px;border:1px solid #ddd;">${result.total_edge_meters}m x ${parseFloat(edgePrice).toFixed(2)}€/m</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${(result.total_edge_meters * parseFloat(edgePrice)).toFixed(2)}€</td></tr>` : ''}
          ${parseFloat(cutPrice) > 0 ? `<tr><td style="padding:8px;border:1px solid #ddd;">Cortes</td><td style="padding:8px;border:1px solid #ddd;">${result.total_cuts} x ${parseFloat(cutPrice).toFixed(2)}€</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${(result.total_cuts * parseFloat(cutPrice)).toFixed(2)}€</td></tr>` : ''}
          <tr style="background:#f0f0f0;"><td style="padding:10px;border:1px solid #ddd;font-weight:bold;" colspan="2">TOTAL</td><td style="padding:10px;border:1px solid #ddd;font-size:18px;font-weight:bold;color:#4CAF50;">${getPricingTotals()?.total.toFixed(2)}€</td></tr>
        </table>
        ` : ''}

        <p style="margin-top: 20px; color: #888; font-size: 11px;">
          ${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES')}
        </p>

        <script>
          function compartir() {
            if (navigator.share) {
              // Try sharing with URL first (works better on iOS Safari)
              navigator.share({
                title: 'Despiece de Corte',
                text: 'Tableros: ${result.total_boards}, Cortes: ${result.total_cuts}, Desperdicio: ${result.waste_percentage}%',
                url: window.location.href
              }).catch(function(err){
                // If share fails, fallback to print
                window.print();
              });
            } else {
              // Fallback: try to print directly which on iOS opens the share sheet
              window.print();
            }
          }
        </script>
      </body>
      </html>
    `;
  };

  // Export function - works on both web and native
  const exportToPDF = () => {
    if (!result) {
      Alert.alert('Error', 'Primero calcula el despiece');
      return;
    }

    setExporting(true);
    const html = generatePDFHtml();

    if (Platform.OS === 'web') {
      // Web: open in new window (synchronous for Safari)
      try {
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(html);
          newWindow.document.close();
        } else {
          window.location.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        }
      } catch (e) {
        console.error('Web export error:', e);
      }
      setExporting(false);
    } else {
      // Native iOS/Android: use expo-print which opens native share/print dialog
      Print.printAsync({ html })
        .then(() => {
          setExporting(false);
        })
        .catch((err: any) => {
          console.error('Print error:', err);
          // Fallback: try printToFileAsync + sharing
          Print.printToFileAsync({ html })
            .then((file: { uri: string }) => {
              return Sharing.shareAsync(file.uri, {
                mimeType: 'application/pdf',
                dialogTitle: 'Exportar Despiece',
              });
            })
            .then(() => {
              setExporting(false);
            })
            .catch((shareErr: any) => {
              console.error('Share error:', shareErr);
              Alert.alert('Error', 'No se pudo exportar: ' + String(shareErr));
              setExporting(false);
            });
        });
    }
  };

  const removePiece = (id: string) => {
    setPieces(pieces.filter(p => p.id !== id));
  };

  const updatePiece = (id: string, field: keyof Piece, value: string | boolean | number) => {
    setPieces(pieces.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const calculateCut = async () => {
    // Validate inputs
    if (!boardLength || !boardWidth) {
      Alert.alert('Error', 'Ingresa las dimensiones del tablero');
      return;
    }

    const validPieces = pieces.filter(p => p.length && p.width && parseFloat(p.length) > 0 && parseFloat(p.width) > 0);
    if (validPieces.length === 0) {
      Alert.alert('Error', 'Agrega al menos una pieza con dimensiones válidas');
      return;
    }

    setLoading(true);
    try {
      const requestBody = {
        board: {
          length: parseFloat(boardLength),
          width: parseFloat(boardWidth),
        },
        pieces: validPieces.map(p => ({
          id: p.id,
          name: p.name || 'Sin nombre',
          length: parseFloat(p.length),
          width: parseFloat(p.width),
          quantity: parseInt(p.quantity) || 1,
          can_rotate: p.canRotate,
          edged_long: p.edgedLong,
          edged_short: p.edgedShort,
        })),
        kerf: parseFloat(kerf) || 3,
      };

      const response = await fetch(`${BACKEND_URL}/api/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Error en el servidor');
      }

      const data: CutResult = await response.json();
      setResult(data);
      setActiveTab('result');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo calcular el despiece');
    } finally {
      setLoading(false);
    }
  };

  const saveProject = async () => {
    if (!projectName.trim()) {
      Alert.alert('Error', 'Ingresa un nombre para el proyecto');
      return;
    }

    setSavingProject(true);
    try {
      const projectData = {
        name: projectName.trim(),
        board_length: parseFloat(boardLength) || 2440,
        board_width: parseFloat(boardWidth) || 1220,
        kerf: parseFloat(kerf) || 3,
        pieces: pieces.map(p => ({
          id: p.id,
          name: p.name || 'Sin nombre',
          length: parseFloat(p.length) || 0,
          width: parseFloat(p.width) || 0,
          quantity: parseInt(p.quantity) || 1,
          can_rotate: p.canRotate,
          edged_long: p.edgedLong,
          edged_short: p.edgedShort,
        })),
      };

      let response;
      if (currentProjectId) {
        // Update existing project
        response = await fetch(`${BACKEND_URL}/api/projects/${currentProjectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectData),
        });
      } else {
        // Create new project
        response = await fetch(`${BACKEND_URL}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectData),
        });
      }

      if (response.ok) {
        const savedProject = await response.json();
        setCurrentProjectId(savedProject.id);
        setSaveModalVisible(false);
        Alert.alert('Éxito', 'Proyecto guardado correctamente');
        loadProjects();
      } else {
        throw new Error('Error al guardar');
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo guardar el proyecto');
    } finally {
      setSavingProject(false);
    }
  };

  const loadProject = (project: SavedProject) => {
    setBoardLength(String(project.board_length));
    setBoardWidth(String(project.board_width));
    setKerf(String(project.kerf));
    setPieces(project.pieces.map(p => ({
      id: p.id,
      name: p.name,
      length: String(p.length),
      width: String(p.width),
      quantity: String(p.quantity),
      canRotate: p.can_rotate,
      edgedLong: p.edged_long || 0,
      edgedShort: p.edged_short || 0,
    })));
    setCurrentProjectId(project.id);
    setProjectName(project.name);
    setResult(null);
    setActiveTab('input');
    setShowWelcome(false);
  };

  const deleteProject = async (projectId: string) => {
    Alert.alert(
      'Eliminar proyecto',
      '¿Estás seguro de que quieres eliminar este proyecto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${BACKEND_URL}/api/projects/${projectId}`, {
                method: 'DELETE',
              });
              if (response.ok) {
                if (currentProjectId === projectId) {
                  setCurrentProjectId(null);
                  setProjectName('');
                }
                loadProjects();
              }
            } catch (error) {
              Alert.alert('Error', 'No se pudo eliminar el proyecto');
            }
          },
        },
      ]
    );
  };

  const newProject = () => {
    setBoardLength('244');
    setBoardWidth('122');
    setKerf('0.3');
    setPieces([]);
    setCurrentProjectId(null);
    setProjectName('');
    setResult(null);
    setActiveTab('input');
  };

  const renderBoardDiagram = (layout: BoardLayout, index: number, globalColorMap: Record<string, string>) => {
    const maxWidth = SCREEN_WIDTH - 48;
    const scale = maxWidth / layout.board_length;
    const scaledHeight = layout.board_width * scale;

    return (
      <View key={layout.board_number} style={styles.boardContainer}>
        <View style={styles.boardHeader}>
          <Text style={styles.boardTitle}>Tablero {layout.board_number}</Text>
          <Text style={styles.boardUtilization}>
            Aprovechamiento: {layout.utilization.toFixed(1)}%
          </Text>
        </View>
        
        <View style={[styles.boardDiagram, { width: maxWidth, height: scaledHeight }]}>
          {layout.pieces.map((piece, pieceIndex) => {
            const pieceLeft = piece.x * scale;
            const pieceTop = piece.y * scale;
            const pieceWidth = piece.length * scale;
            const pieceHeight = piece.width * scale;
            // Color by dimension: same size = same color
            const dims = [piece.length, piece.width].sort((a, b) => a - b);
            const dimKey = `${dims[0]}x${dims[1]}`;
            const color = globalColorMap[dimKey] || PIECE_COLORS[pieceIndex % PIECE_COLORS.length];

            return (
              <View
                key={`${piece.piece_id}-${pieceIndex}`}
                style={[
                  styles.placedPiece,
                  {
                    left: pieceLeft,
                    top: pieceTop,
                    width: pieceWidth,
                    height: pieceHeight,
                    backgroundColor: color,
                  },
                ]}
              >
                <Text style={styles.pieceLabel} numberOfLines={1}>
                  {piece.name}
                </Text>
                <Text style={styles.pieceDimensions}>
                  {piece.length}x{piece.width}cm
                </Text>
                {piece.rotated && (
                  <Ionicons name="sync" size={12} color="#fff" style={styles.rotatedIcon} />
                )}
              </View>
            );
          })}
        </View>
        
        <Text style={styles.boardDimensions}>
          {layout.board_length} x {layout.board_width} cm
        </Text>
      </View>
    );
  };

  const renderInputTab = () => (
    <ScrollView 
      ref={scrollViewRef}
      style={styles.scrollView} 
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Current Project Info */}
      {currentProjectId && (
        <View style={styles.currentProjectBanner}>
          <Ionicons name="folder-open" size={18} color="#4CAF50" />
          <Text style={styles.currentProjectText}>{projectName}</Text>
          <TouchableOpacity onPress={newProject}>
            <Ionicons name="add-circle-outline" size={22} color="#888" />
          </TouchableOpacity>
        </View>
      )}

      {/* Board Settings */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="cube-outline" size={22} color="#4CAF50" />
          <Text style={styles.sectionTitle}>Tablero</Text>
        </View>
        
        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Largo (cm)</Text>
            <TextInput
              style={styles.input}
              value={boardLength}
              onChangeText={setBoardLength}
              keyboardType="numeric"
              placeholder="244"
              placeholderTextColor="#666"
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Ancho (cm)</Text>
            <TextInput
              style={styles.input}
              value={boardWidth}
              onChangeText={setBoardWidth}
              keyboardType="numeric"
              placeholder="122"
              placeholderTextColor="#666"
            />
          </View>
          <View style={styles.inputGroupSmall}>
            <Text style={styles.inputLabel}>Kerf (cm)</Text>
            <TextInput
              style={styles.input}
              value={kerf}
              onChangeText={setKerf}
              keyboardType="numeric"
              placeholder="0.3"
              placeholderTextColor="#666"
            />
          </View>
        </View>
      </View>

      {/* Pieces Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="grid-outline" size={22} color="#2196F3" />
          <Text style={styles.sectionTitle}>Piezas a cortar</Text>
        </View>

        {pieces.map((piece, index) => (
          <View key={piece.id} style={styles.pieceCard}>
            <View style={styles.pieceHeader}>
              <TextInput
                style={styles.pieceNameInput}
                value={piece.name}
                onChangeText={(text) => updatePiece(piece.id, 'name', text)}
                placeholder={`Pieza ${index + 1}`}
                placeholderTextColor="#666"
              />
              <TouchableOpacity
                style={styles.removePieceButton}
                onPress={() => removePiece(piece.id)}
              >
                <Ionicons name="trash-outline" size={16} color="#fff" />
                <Text style={styles.removePieceText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.pieceInputRow}>
              <View style={styles.pieceInputHalf}>
                <Text style={styles.pieceInputLabel}>Largo (cm)</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.length}
                  onChangeText={(text) => updatePiece(piece.id, 'length', text)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.pieceInputHalf}>
                <Text style={styles.pieceInputLabel}>Ancho (cm)</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.width}
                  onChangeText={(text) => updatePiece(piece.id, 'width', text)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#666"
                />
              </View>
            </View>
            <View style={styles.pieceInputRow}>
              <View style={styles.pieceInputHalf}>
                <Text style={styles.pieceInputLabel}>Cantidad</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.quantity}
                  onChangeText={(text) => updatePiece(piece.id, 'quantity', text)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.pieceInputHalf} />
            </View>

            {/* Rotation toggle */}
            <View style={styles.rotationRow}>
              <View style={styles.rotationInfo}>
                <Ionicons 
                  name={piece.canRotate ? "sync" : "lock-closed"} 
                  size={16} 
                  color={piece.canRotate ? "#4CAF50" : "#FF9800"} 
                />
                <Text style={styles.rotationLabel}>
                  {piece.canRotate ? 'Puede rotar' : 'Veta fija (no rotar)'}
                </Text>
              </View>
              <Switch
                value={piece.canRotate}
                onValueChange={(value) => updatePiece(piece.id, 'canRotate', value)}
                trackColor={{ false: '#1b5e20', true: '#3d3d3d' }}
                thumbColor={piece.canRotate ? '#888' : '#FF9800'}
              />
            </View>

            {/* Edged sides selector */}
            <View style={styles.edgedRow}>
              <View style={styles.edgedInfo}>
                <Text style={styles.edgedLabel}>Cantos largo:</Text>
              </View>
              <View style={styles.edgedSelector}>
                {[0, 1, 2].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.edgedButton,
                      piece.edgedLong === num && styles.edgedButtonActive
                    ]}
                    onPress={() => updatePiece(piece.id, 'edgedLong', num)}
                  >
                    <Text style={[
                      styles.edgedButtonText,
                      piece.edgedLong === num && styles.edgedButtonTextActive
                    ]}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.edgedRow}>
              <View style={styles.edgedInfo}>
                <Text style={styles.edgedLabel}>Cantos ancho:</Text>
              </View>
              <View style={styles.edgedSelector}>
                {[0, 1, 2].map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.edgedButton,
                      piece.edgedShort === num && styles.edgedButtonActive
                    ]}
                    onPress={() => updatePiece(piece.id, 'edgedShort', num)}
                  >
                    <Text style={[
                      styles.edgedButtonText,
                      piece.edgedShort === num && styles.edgedButtonTextActive
                    ]}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        ))}

        <View style={styles.addButtonsRow}>
          <TouchableOpacity style={styles.addButton} onPress={addPiece}>
            <Ionicons name="add-circle" size={20} color="#4CAF50" />
            <Text style={styles.addButtonText}>Agregar pieza</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.templateButton} onPress={() => setTemplateVisible(true)}>
            <Ionicons name="cube-outline" size={20} color="#2196F3" />
            <Text style={styles.templateButtonText}>Plantilla mueble</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.calcButtonYellow}
          onPress={openCalculator}
        >
          <Ionicons name="calculator" size={22} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.saveButton}
          onPress={() => {
            if (!projectName && !currentProjectId) {
              setProjectName('');
            }
            setSaveModalVisible(true);
          }}
        >
          <Text style={styles.saveButtonText} numberOfLines={1}>Guardar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.calculateButton, loading && styles.calculateButtonDisabled]}
          onPress={calculateCut}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="cut-outline" size={22} color="#fff" />
              <Text style={styles.calculateButtonText}>Calcular</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );

  const renderResultTab = () => {
    // Build global color map for all boards
    const globalColorMap = result ? getGlobalDimensionColorMap(result.board_layouts) : {};
    
    return (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      {result ? (
        <>
          {/* Summary */}
          <View style={styles.summarySection}>
            <View style={styles.summaryCard}>
              <Ionicons name="layers" size={28} color="#4CAF50" />
              <Text style={styles.summaryNumber}>{result.total_boards}</Text>
              <Text style={styles.summaryLabel}>Tableros</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="cut-outline" size={28} color="#FF9800" />
              <Text style={styles.summaryNumber}>{result.total_cuts}</Text>
              <Text style={styles.summaryLabel}>Cortes</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="trash-outline" size={28} color="#F44336" />
              <Text style={styles.summaryNumber}>{result.waste_percentage}%</Text>
              <Text style={styles.summaryLabel}>Desperdicio</Text>
            </View>
          </View>

          {/* Edge banding summary */}
          {result.total_edge_meters > 0 && (
            <View style={styles.edgeSummary}>
              <Ionicons name="resize-outline" size={24} color="#2196F3" />
              <View style={styles.edgeSummaryContent}>
                <Text style={styles.edgeSummaryTitle}>Canto necesario</Text>
                <Text style={styles.edgeSummaryValue}>{result.total_edge_meters} metros</Text>
              </View>
            </View>
          )}

          {/* Unplaced pieces warning */}
          {result.unplaced_pieces.length > 0 && (
            <View style={styles.warningSection}>
              <Ionicons name="warning" size={24} color="#F44336" />
              <View style={styles.warningContent}>
                <Text style={styles.warningTitle}>Piezas no colocadas</Text>
                {result.unplaced_pieces.map((piece, idx) => (
                  <Text key={idx} style={styles.warningText}>
                    {piece.name} ({piece.length}x{piece.width}mm): {piece.reason}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {/* Board Diagrams */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="map-outline" size={22} color="#9C27B0" />
              <Text style={styles.sectionTitle}>Diagrama de Corte</Text>
            </View>
            {result.board_layouts.map((layout, index) => renderBoardDiagram(layout, index, globalColorMap))}
          </View>

          {/* Piece Legend - color by dimension */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list-outline" size={22} color="#607D8B" />
              <Text style={styles.sectionTitle}>Leyenda de Piezas</Text>
            </View>
            <View style={styles.legendContainer}>
              {pieces.filter(p => p.length && p.width).map((piece, index) => {
                const dims = [parseFloat(piece.length), parseFloat(piece.width)].sort((a, b) => a - b);
                const dimKey = `${dims[0]}x${dims[1]}`;
                const color = globalColorMap[dimKey] || PIECE_COLORS[index % PIECE_COLORS.length];
                return (
                <View key={piece.id} style={styles.legendItem}>
                  <View style={[styles.legendColor, { backgroundColor: color }]} />
                  <View style={styles.legendTextContainer}>
                    <Text style={styles.legendText}>
                      {piece.name}: {piece.length}x{piece.width}cm (x{piece.quantity})
                    </Text>
                    <Text style={styles.legendSubtext}>
                      {!piece.canRotate ? 'Veta fija' : 'Rotable'}
                      {(piece.edgedLong > 0 || piece.edgedShort > 0) && 
                        ` | Cantos: ${piece.edgedLong}L ${piece.edgedShort}A`}
                    </Text>
                  </View>
                </View>
                );
              })}
            </View>
          </View>

          {/* Pricing summary - shown when saved */}
          {pricingSaved && result && (parseFloat(boardPrice) > 0 || parseFloat(backBoardPrice) > 0 || parseFloat(edgePrice) > 0 || parseFloat(cutPrice) > 0) && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="cash-outline" size={22} color="#FFC107" />
                <Text style={styles.sectionTitle}>Presupuesto</Text>
              </View>
              <View style={styles.pricingCard}>
                {parseFloat(boardPrice) > 0 && (
                  <View style={styles.pricingRow}>
                    <Text style={styles.pricingLabel}>Tableros ({getPricingTotals()?.regularBoards} x {parseFloat(boardPrice).toFixed(2)}€)</Text>
                    <Text style={styles.pricingValue}>{getPricingTotals()?.totalBoards.toFixed(2)}€</Text>
                  </View>
                )}
                {parseFloat(backBoardPrice) > 0 && (getPricingTotals()?.backPanels || 0) > 0 && (
                  <View style={styles.pricingRow}>
                    <Text style={styles.pricingLabel}>Traseras ({getPricingTotals()?.backPanels} x {parseFloat(backBoardPrice).toFixed(2)}€)</Text>
                    <Text style={styles.pricingValue}>{getPricingTotals()?.totalBackBoards.toFixed(2)}€</Text>
                  </View>
                )}
                {parseFloat(edgePrice) > 0 && result.total_edge_meters > 0 && (
                  <View style={styles.pricingRow}>
                    <Text style={styles.pricingLabel}>Canto ({result.total_edge_meters}m x {parseFloat(edgePrice).toFixed(2)}€/m)</Text>
                    <Text style={styles.pricingValue}>{getPricingTotals()?.totalEdge.toFixed(2)}€</Text>
                  </View>
                )}
                {parseFloat(cutPrice) > 0 && (
                  <View style={styles.pricingRow}>
                    <Text style={styles.pricingLabel}>Cortes ({result.total_cuts} x {parseFloat(cutPrice).toFixed(2)}€)</Text>
                    <Text style={styles.pricingValue}>{getPricingTotals()?.totalCuts.toFixed(2)}€</Text>
                  </View>
                )}
                <View style={styles.pricingDivider} />
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingTotalLabel}>TOTAL</Text>
                  <Text style={styles.pricingTotalValue}>{getPricingTotals()?.total.toFixed(2)}€</Text>
                </View>
              </View>
            </View>
          )}

          {/* Action Buttons Row */}
          <View style={styles.resultActionRow}>
            <TouchableOpacity 
              style={styles.pricingButton} 
              onPress={() => setPricingVisible(true)}
            >
              <Ionicons name="cash-outline" size={20} color="#000" />
              <Text style={styles.pricingButtonText}>Presupuesto</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.exportButton, exporting && styles.exportButtonDisabled]} 
              onPress={exportToPDF}
              disabled={exporting}
            >
              {exporting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="share-outline" size={20} color="#fff" />
                  <Text style={styles.exportButtonText}>Exportar / Imprimir</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.emptyResult}>
          <Ionicons name="calculator-outline" size={64} color="#444" />
          <Text style={styles.emptyResultText}>Ingresa las piezas y calcula el despiece</Text>
        </View>
      )}
      
      <View style={styles.bottomSpacer} />
    </ScrollView>
    );
  };

  const renderProjectsTab = () => (
    <View style={styles.projectsContainer}>
      {loadingProjects ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.emptyProjects}>
          <Ionicons name="folder-open-outline" size={64} color="#444" />
          <Text style={styles.emptyProjectsText}>No hay proyectos guardados</Text>
          <Text style={styles.emptyProjectsSubtext}>Guarda tu primer proyecto desde la pestaña de entrada</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.projectsList}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={[
                styles.projectCard,
                currentProjectId === item.id && styles.projectCardActive
              ]}
              onPress={() => loadProject(item)}
            >
              <View style={styles.projectInfo}>
                <Text style={styles.projectName}>{item.name}</Text>
                <Text style={styles.projectDetails}>
                  Tablero: {item.board_length}x{item.board_width}cm
                </Text>
                <Text style={styles.projectDetails}>
                  {item.pieces.length} tipo(s) de pieza • Kerf: {item.kerf}cm
                </Text>
                <Text style={styles.projectDate}>
                  {new Date(item.updated_at).toLocaleDateString('es-ES', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.deleteProjectButton}
                onPress={() => deleteProject(item.id)}
              >
                <Ionicons name="trash-outline" size={22} color="#F44336" />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  // Welcome screen
  const renderWelcomeScreen = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeHeader}>
        <Ionicons name="cog" size={48} color="#FFC107" />
        <Text style={styles.welcomeTitle}>Optimizador{'\n'}de Corte</Text>
        <Text style={styles.welcomeSubtitle}>Calcula el despiece óptimo de tus tableros</Text>
      </View>

      <Text style={styles.welcomeQuestion}>¿Qué quieres hacer?</Text>

      <TouchableOpacity
        style={styles.welcomeCard}
        onPress={() => {
          setShowWelcome(false);
          setActiveTab('input');
        }}
      >
        <View style={styles.welcomeCardIcon}>
          <Ionicons name="create-outline" size={32} color="#4CAF50" />
        </View>
        <View style={styles.welcomeCardContent}>
          <Text style={styles.welcomeCardTitle}>Despiece manual</Text>
          <Text style={styles.welcomeCardDesc}>Añade piezas una a una con sus medidas</Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color="#555" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.welcomeCard}
        onPress={() => {
          setShowWelcome(false);
          setActiveTab('input');
          setTimeout(() => setTemplateVisible(true), 300);
        }}
      >
        <View style={[styles.welcomeCardIcon, { backgroundColor: '#1a2a3a' }]}>
          <Ionicons name="cube-outline" size={32} color="#2196F3" />
        </View>
        <View style={styles.welcomeCardContent}>
          <Text style={styles.welcomeCardTitle}>Plantilla de mueble</Text>
          <Text style={styles.welcomeCardDesc}>Armario, estantería, cajonera o mesa</Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color="#555" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.welcomeCard}
        onPress={() => {
          setShowWelcome(false);
          setActiveTab('projects');
        }}
      >
        <View style={[styles.welcomeCardIcon, { backgroundColor: '#2a2a1a' }]}>
          <Ionicons name="folder-open-outline" size={32} color="#FFC107" />
        </View>
        <View style={styles.welcomeCardContent}>
          <Text style={styles.welcomeCardTitle}>Abrir proyecto</Text>
          <Text style={styles.welcomeCardDesc}>Continuar con un proyecto guardado</Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color="#555" />
      </TouchableOpacity>
    </View>
  );

  if (showWelcome) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        {renderWelcomeScreen()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* Header with back button */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowWelcome(true)} style={styles.headerBackBtn}>
          <Ionicons name="home-outline" size={22} color="#888" />
        </TouchableOpacity>
        <Ionicons name="cog" size={24} color="#FFC107" />
        <Text style={styles.headerTitle}>Optimizador de Corte</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'input' && styles.activeTab]}
          onPress={() => setActiveTab('input')}
        >
          <Ionicons 
            name="create-outline" 
            size={20} 
            color={activeTab === 'input' ? '#4CAF50' : '#888'} 
          />
          <Text style={[styles.tabText, activeTab === 'input' && styles.activeTabText]}>
            Entrada
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'result' && styles.activeTab]}
          onPress={() => setActiveTab('result')}
        >
          <Ionicons 
            name="analytics-outline" 
            size={20} 
            color={activeTab === 'result' ? '#4CAF50' : '#888'} 
          />
          <Text style={[styles.tabText, activeTab === 'result' && styles.activeTabText]}>
            Resultado
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'projects' && styles.activeTab]}
          onPress={() => setActiveTab('projects')}
        >
          <Ionicons 
            name="folder-outline" 
            size={20} 
            color={activeTab === 'projects' ? '#4CAF50' : '#888'} 
          />
          <Text style={[styles.tabText, activeTab === 'projects' && styles.activeTabText]}>
            Proyectos
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {activeTab === 'input' && renderInputTab()}
        {activeTab === 'result' && renderResultTab()}
        {activeTab === 'projects' && renderProjectsTab()}
      </KeyboardAvoidingView>

      {/* Save Modal */}
      <Modal
        visible={saveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {currentProjectId ? 'Actualizar Proyecto' : 'Guardar Proyecto'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={projectName}
              onChangeText={setProjectName}
              placeholder="Nombre del proyecto"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setSaveModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveButton, savingProject && styles.modalSaveButtonDisabled]}
                onPress={saveProject}
                disabled={savingProject}
              >
                {savingProject ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Guardar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Calculator Modal */}
      <Modal
        visible={calculatorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCalculatorVisible(false)}
      >
        <View style={styles.calculatorOverlay}>
          <View style={styles.calculatorContent}>
            <View style={styles.calculatorHeader}>
              <Text style={styles.calculatorTitle}>Calculadora</Text>
              <TouchableOpacity onPress={() => setCalculatorVisible(false)}>
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.calculatorDisplay}>
              <Text style={styles.calculatorValue}>{calculatorValue || '0'}</Text>
            </View>
            
            <View style={styles.calculatorGrid}>
              {['7', '8', '9', '÷', '4', '5', '6', 'x', '1', '2', '3', '-', 'C', '0', '.', '+', '⌫', '='].map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.calculatorKey,
                    ['÷', 'x', '-', '+', '='].includes(key) && styles.calculatorKeyOperator,
                    ['C', '⌫'].includes(key) && styles.calculatorKeyClear,
                  ]}
                  onPress={() => handleCalculatorPress(key)}
                >
                  <Text style={styles.calculatorKeyText}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={styles.calculatorApplyLabel}>Aplicar resultado a:</Text>
            <View style={styles.calculatorApplyRow}>
              <TouchableOpacity
                style={styles.calculatorApplyButton}
                onPress={() => handleCalculatorPress('Largo')}
              >
                <Text style={styles.calculatorApplyText}>Largo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.calculatorApplyButton}
                onPress={() => handleCalculatorPress('Ancho')}
              >
                <Text style={styles.calculatorApplyText}>Ancho</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.calculatorApplyButton}
                onPress={() => handleCalculatorPress('Cant.')}
              >
                <Text style={styles.calculatorApplyText}>Cant.</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Furniture Template Modal */}
      <Modal
        visible={templateVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTemplateVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.templateOverlay}>
          <ScrollView style={styles.templateScroll} contentContainerStyle={styles.templateScrollContent}>
          <View style={styles.templateModalContent}>
            <View style={styles.templateModalHeader}>
              <Text style={styles.templateModalTitle}>Plantilla Mueble</Text>
              <TouchableOpacity onPress={() => setTemplateVisible(false)}>
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>

            {/* Template type selector */}
            <Text style={styles.templateLabel}>Tipo de mueble</Text>
            <View style={styles.templateTypeRow}>
              {([
                { key: 'armario', icon: 'file-tray-stacked-outline', label: 'Armario' },
                { key: 'estanteria', icon: 'library-outline', label: 'Estantería' },
                { key: 'cajonera', icon: 'filing-outline', label: 'Cajonera' },
                { key: 'mesa', icon: 'tablet-landscape-outline', label: 'Mesa' },
              ] as const).map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.templateTypeBtn, templateType === t.key && styles.templateTypeBtnActive]}
                  onPress={() => setTemplateType(t.key)}
                >
                  <Ionicons name={t.icon} size={22} color={templateType === t.key ? '#fff' : '#888'} />
                  <Text style={[styles.templateTypeText, templateType === t.key && styles.templateTypeTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Dimensions */}
            <Text style={styles.templateLabel}>Medidas exteriores (cm)</Text>
            <View style={styles.templateDimRow}>
              <View style={styles.templateDimInput}>
                <Text style={styles.templateDimLabel}>Alto</Text>
                <TextInput style={styles.templateInput} value={templateAlto} onChangeText={setTemplateAlto} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#555" />
              </View>
              <View style={styles.templateDimInput}>
                <Text style={styles.templateDimLabel}>Ancho</Text>
                <TextInput style={styles.templateInput} value={templateAncho} onChangeText={setTemplateAncho} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#555" />
              </View>
              <View style={styles.templateDimInput}>
                <Text style={styles.templateDimLabel}>Fondo</Text>
                <TextInput style={styles.templateInput} value={templateFondo} onChangeText={setTemplateFondo} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#555" />
              </View>
            </View>

            {/* Material - Grosor con presets */}
            <Text style={styles.templateLabel}>Grosor tablero (cm)</Text>
            <View style={styles.presetRow}>
              {['1.6', '1.9', '3.0'].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.presetBtn, templateGrosor === v && styles.presetBtnActive]}
                  onPress={() => setTemplateGrosor(v)}
                >
                  <Text style={[styles.presetBtnText, templateGrosor === v && styles.presetBtnTextActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
              <View style={styles.presetInputWrap}>
                <Text style={styles.presetInputLabel}>Otro:</Text>
                <TextInput style={styles.presetInputSmall} value={templateGrosor} onChangeText={(t) => { setTemplateGrosor(t); }} keyboardType="decimal-pad" placeholderTextColor="#555" />
              </View>
            </View>

            {/* Grosor trasera con presets */}
            {templateTrasera && templateType !== 'mesa' && (
              <>
                <Text style={styles.templateLabel}>Grosor trasera (cm)</Text>
                <View style={styles.presetRow}>
                  {['0.32', '1.0'].map((v) => (
                    <TouchableOpacity
                      key={v}
                      style={[styles.presetBtn, templateGrosorTrasera === v && styles.presetBtnActive]}
                      onPress={() => setTemplateGrosorTrasera(v)}
                    >
                      <Text style={[styles.presetBtnText, templateGrosorTrasera === v && styles.presetBtnTextActive]}>{v}</Text>
                    </TouchableOpacity>
                  ))}
                  <View style={styles.presetInputWrap}>
                    <Text style={styles.presetInputLabel}>Otro:</Text>
                    <TextInput style={styles.presetInputSmall} value={templateGrosorTrasera} onChangeText={(t) => { setTemplateGrosorTrasera(t); }} keyboardType="decimal-pad" placeholderTextColor="#555" />
                  </View>
                </View>
              </>
            )}

            {/* Options based on template type */}
            {(templateType === 'armario' || templateType === 'estanteria') && (
              <View style={styles.templateDimRow}>
                <View style={styles.templateDimInput}>
                  <Text style={styles.templateDimLabel}>Nº estantes</Text>
                  <TextInput style={styles.templateInput} value={templateEstantes} onChangeText={setTemplateEstantes} keyboardType="number-pad" placeholder="2" placeholderTextColor="#555" />
                </View>
                {templateType === 'armario' && (
                  <View style={styles.templateDimInput}>
                    <Text style={styles.templateDimLabel}>Divisiones vert.</Text>
                    <TextInput style={styles.templateInput} value={templateDivisiones} onChangeText={setTemplateDivisiones} keyboardType="number-pad" placeholder="0" placeholderTextColor="#555" />
                  </View>
                )}
              </View>
            )}

            {templateType === 'armario' && (
              <View style={styles.templateDimRow}>
                <View style={styles.templateDimInput}>
                  <Text style={styles.templateDimLabel}>Nº puertas</Text>
                  <TextInput style={styles.templateInput} value={templatePuertas} onChangeText={setTemplatePuertas} keyboardType="number-pad" placeholder="2" placeholderTextColor="#555" />
                </View>
                <View style={styles.templateDimInput} />
              </View>
            )}

            {templateType === 'cajonera' && (
              <View style={styles.templateDimRow}>
                <View style={styles.templateDimInput}>
                  <Text style={styles.templateDimLabel}>Nº cajones</Text>
                  <TextInput style={styles.templateInput} value={templateCajones} onChangeText={setTemplateCajones} keyboardType="number-pad" placeholder="3" placeholderTextColor="#555" />
                </View>
              </View>
            )}

            {/* Trasera toggle */}
            {templateType !== 'mesa' && (
              <View style={styles.templateToggleRow}>
                <Text style={styles.templateToggleLabel}>Incluir trasera</Text>
                <Switch
                  value={templateTrasera}
                  onValueChange={setTemplateTrasera}
                  trackColor={{ false: '#333', true: '#4CAF50' }}
                  thumbColor="#fff"
                />
              </View>
            )}

            {/* Buttons */}
            <View style={styles.templateModalButtons}>
              <TouchableOpacity style={styles.templateCancelBtn} onPress={() => setTemplateVisible(false)}>
                <Text style={styles.templateCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.templateGenerateBtn} onPress={generateTemplatePieces}>
                <Ionicons name="construct-outline" size={20} color="#fff" />
                <Text style={styles.templateGenerateText}>Generar piezas</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pricing Modal */}
      <Modal
        visible={pricingVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPricingVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex: 1}}>
        <View style={styles.pricingOverlay}>
          <View style={styles.pricingModalContent}>
            <View style={styles.pricingModalHeader}>
              <Text style={styles.pricingModalTitle}>Presupuesto</Text>
              <TouchableOpacity onPress={() => setPricingVisible(false)}>
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>

            <View style={styles.pricingInputRow}>
              <Ionicons name="layers" size={20} color="#4CAF50" />
              <View style={styles.pricingInputGroup}>
                <Text style={styles.pricingInputLabel}>Precio tablero (€)</Text>
                <TextInput
                  style={styles.pricingInput}
                  value={boardPrice}
                  onChangeText={setBoardPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                />
              </View>
            </View>

            <View style={styles.pricingInputRow}>
              <Ionicons name="albums-outline" size={20} color="#795548" />
              <View style={styles.pricingInputGroup}>
                <Text style={styles.pricingInputLabel}>Precio tablero trasera (€)</Text>
                <TextInput
                  style={styles.pricingInput}
                  value={backBoardPrice}
                  onChangeText={setBackBoardPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                />
              </View>
            </View>

            <View style={styles.pricingInputRow}>
              <Ionicons name="resize-outline" size={20} color="#2196F3" />
              <View style={styles.pricingInputGroup}>
                <Text style={styles.pricingInputLabel}>Precio canto (€/ml)</Text>
                <TextInput
                  style={styles.pricingInput}
                  value={edgePrice}
                  onChangeText={setEdgePrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                />
              </View>
            </View>

            <View style={styles.pricingInputRow}>
              <Ionicons name="cut-outline" size={20} color="#FF9800" />
              <View style={styles.pricingInputGroup}>
                <Text style={styles.pricingInputLabel}>Precio corte (€/corte)</Text>
                <TextInput
                  style={styles.pricingInput}
                  value={cutPrice}
                  onChangeText={setCutPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                />
              </View>
            </View>

            {/* Preview total */}
            {result && (parseFloat(boardPrice) > 0 || parseFloat(edgePrice) > 0 || parseFloat(cutPrice) > 0) && (
              <View style={styles.pricingPreview}>
                <Text style={styles.pricingPreviewLabel}>Total estimado:</Text>
                <Text style={styles.pricingPreviewValue}>{getPricingTotals()?.total.toFixed(2)}€</Text>
              </View>
            )}

            <View style={styles.pricingModalButtons}>
              <TouchableOpacity
                style={styles.pricingCancelBtn}
                onPress={() => setPricingVisible(false)}
              >
                <Text style={styles.pricingCancelText}>Salir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pricingSaveBtn}
                onPress={() => {
                  setPricingSaved(true);
                  setPricingVisible(false);
                }}
              >
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text style={styles.pricingSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerBackBtn: {
    position: 'absolute',
    left: 14,
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#fff',
  },
  // Welcome screen styles
  welcomeContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  welcomeHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  welcomeTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 36,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
  },
  welcomeQuestion: {
    fontSize: 16,
    color: '#aaa',
    fontWeight: '600',
    marginBottom: 16,
  },
  welcomeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  welcomeCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#1a2a1a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  welcomeCardContent: {
    flex: 1,
  },
  welcomeCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 3,
  },
  welcomeCardDesc: {
    fontSize: 12,
    color: '#888',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1e1e1e',
    gap: 4,
  },
  activeTab: {
    backgroundColor: '#1b3a1b',
  },
  tabText: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#4CAF50',
  },
  content: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 12,
  },
  currentProjectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1b3a1b',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    gap: 6,
  },
  currentProjectText: {
    flex: 1,
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '500',
  },
  section: {
    marginTop: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputGroup: {
    flex: 1,
  },
  inputGroupSmall: {
    flex: 0.6,
  },
  inputGroup: {
    flex: 1,
  },
  inputGroupFull: {
    marginTop: 10,
  },
  inputLabel: {
    fontSize: 11,
    color: '#aaa',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  pieceCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  pieceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pieceNameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    padding: 0,
  },
  removeButton: {
    padding: 4,
  },
  removePieceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F44336',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  removePieceText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  pieceInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  pieceInputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  pieceInputHalf: {
    flex: 1,
  },
  pieceInputGroup: {
    flex: 1,
  },
  pieceInputLabel: {
    fontSize: 10,
    color: '#888',
    marginBottom: 3,
  },
  pieceInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#fff',
  },
  inputWithCalc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 7,
    overflow: 'hidden',
  },
  pieceInputWithButton: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#fff',
  },
  calcButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#4CAF50',
  },
  calcButtonSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  calcButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  calcButtonBig: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  calcButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rotationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  rotationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rotationLabel: {
    fontSize: 13,
    color: '#aaa',
  },
  edgedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  edgedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  edgedLabel: {
    fontSize: 13,
    color: '#aaa',
  },
  edgedSelector: {
    flexDirection: 'row',
    gap: 6,
  },
  edgedButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  edgedButtonActive: {
    backgroundColor: '#1565C0',
    borderColor: '#2196F3',
  },
  edgedButtonText: {
    fontSize: 14,
    color: '#888',
    fontWeight: '600',
  },
  edgedButtonTextActive: {
    color: '#fff',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    gap: 6,
  },
  addButtonText: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  calcButtonRed: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calcButtonYellow: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  saveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    flexShrink: 1,
  },
  calculateButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  calculateButtonDisabled: {
    opacity: 0.6,
  },
  calculateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  bottomSpacer: {
    height: 30,
  },
  summarySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 6,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 3,
  },
  edgeSummary: {
    flexDirection: 'row',
    backgroundColor: '#1a237e',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    alignItems: 'center',
    gap: 12,
  },
  edgeSummaryContent: {
    flex: 1,
  },
  edgeSummaryTitle: {
    fontSize: 14,
    color: '#90CAF9',
  },
  edgeSummaryValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  warningSection: {
    flexDirection: 'row',
    backgroundColor: '#3d1f1f',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    gap: 12,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F44336',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 13,
    color: '#ffaaaa',
  },
  boardContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  boardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  boardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  boardUtilization: {
    fontSize: 13,
    color: '#4CAF50',
  },
  boardDiagram: {
    backgroundColor: '#d4a574',
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  placedPiece: {
    position: 'absolute',
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.3)',
  },
  pieceLabel: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  pieceDimensions: {
    fontSize: 7,
    color: 'rgba(255,255,255,0.8)',
  },
  rotatedIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  boardDimensions: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
  },
  legendContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  legendColor: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 14,
    color: '#ccc',
  },
  legendTextContainer: {
    flex: 1,
  },
  legendSubtext: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  emptyResult: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyResultText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
  projectsContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyProjects: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyProjectsText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  emptyProjectsSubtext: {
    fontSize: 14,
    color: '#555',
    marginTop: 8,
    textAlign: 'center',
  },
  projectsList: {
    padding: 16,
  },
  projectCard: {
    flexDirection: 'row',
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  projectCardActive: {
    borderColor: '#4CAF50',
    backgroundColor: '#1b3a1b',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  projectDetails: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  },
  projectDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  deleteProjectButton: {
    padding: 8,
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '500',
  },
  modalSaveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  modalSaveButtonDisabled: {
    opacity: 0.6,
  },
  modalSaveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Calculator styles
  calculatorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  calculatorContent: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  calculatorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  calculatorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  calculatorDisplay: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    minHeight: 60,
    justifyContent: 'center',
  },
  calculatorValue: {
    fontSize: 32,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'right',
  },
  calculatorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calculatorKey: {
    width: '23%',
    aspectRatio: 1.5,
    backgroundColor: '#333',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calculatorKeyOperator: {
    backgroundColor: '#FF9800',
  },
  calculatorKeyClear: {
    backgroundColor: '#F44336',
  },
  calculatorKeyOK: {
    backgroundColor: '#4CAF50',
    width: '48%',
  },
  calculatorKeyText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#fff',
  },
  calculatorKeyTextOK: {
    fontSize: 18,
  },
  calculatorApplyLabel: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
    marginBottom: 10,
  },
  calculatorApplyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  calculatorApplyButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  calculatorApplyText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Export button styles
  resultActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  pricingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFC107',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 6,
  },
  pricingButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9C27B0',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  // Pricing card in results
  pricingCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  pricingLabel: {
    fontSize: 13,
    color: '#ccc',
    flex: 1,
  },
  pricingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  pricingDivider: {
    height: 1,
    backgroundColor: '#444',
    marginVertical: 8,
  },
  pricingTotalLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFC107',
  },
  pricingTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  // Pricing modal styles
  pricingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pricingModalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
  },
  pricingModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pricingModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  pricingInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  pricingInputGroup: {
    flex: 1,
  },
  pricingInputLabel: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 4,
  },
  pricingInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#444',
  },
  pricingPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    marginTop: 4,
  },
  pricingPreviewLabel: {
    fontSize: 14,
    color: '#aaa',
  },
  pricingPreviewValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  pricingModalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  pricingCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  pricingCancelText: {
    color: '#ccc',
    fontSize: 15,
    fontWeight: '600',
  },
  pricingSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pricingSaveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Export options modal styles
  exportOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  exportContent: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  exportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  exportTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  exportOptionIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  exportOptionText: {
    flex: 1,
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  exportOptionDesc: {
    fontSize: 13,
    color: '#888',
  },
  // Template styles
  addButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  templateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderStyle: 'dashed',
    gap: 6,
  },
  templateButtonText: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '500',
  },
  templateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  templateScroll: {
    flex: 1,
  },
  templateScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  templateModalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 18,
  },
  templateModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 12,
  },
  templateModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  templateLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  templateTypeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  templateTypeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    gap: 3,
  },
  templateTypeBtnActive: {
    backgroundColor: '#2196F3',
  },
  templateTypeText: {
    fontSize: 9,
    color: '#888',
    fontWeight: '500',
  },
  templateTypeTextActive: {
    color: '#fff',
  },
  templateDimRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  templateDimInput: {
    flex: 1,
  },
  templateDimLabel: {
    fontSize: 10,
    color: '#666',
    marginBottom: 3,
  },
  templateInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  templateToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 2,
  },
  templateToggleLabel: {
    fontSize: 12,
    color: '#aaa',
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'nowrap',
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  presetBtnActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  presetBtnText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  presetBtnTextActive: {
    color: '#fff',
  },
  presetInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  presetInputLabel: {
    fontSize: 11,
    color: '#666',
  },
  presetInputSmall: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 13,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a3a',
    textAlign: 'center',
  },
  presetInput: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#3a3a3a',
    textAlign: 'center',
  },
  templateModalButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  templateCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
  },
  templateCancelText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  templateGenerateBtn: {
    flex: 1.5,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  templateGenerateText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
