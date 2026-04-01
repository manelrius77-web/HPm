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

  // Scroll ref
  const scrollViewRef = useRef<ScrollView>(null);

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
          <button class="btn btn-green" onclick="window.print()">🖨️ Imprimir/PDF</button>
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

  const exportToPDF = async () => {
    if (!result) {
      Alert.alert('Error', 'Primero calcula el despiece');
      return;
    }

    setExporting(true);
    
    try {
      const html = generatePDFHtml();
      
      if (Platform.OS === 'web') {
        // Web: open in new window for print
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(html);
          newWindow.document.close();
        } else {
          // Fallback: data URI
          const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          window.open(dataUri, '_blank');
        }
      } else {
        // Native: use expo-print + sharing
        try {
          const { uri } = await Print.printToFileAsync({ html });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              dialogTitle: 'Exportar Despiece',
              UTI: 'com.adobe.pdf',
            });
          } else {
            await Print.printAsync({ uri });
          }
        } catch (nativeError) {
          // Fallback to direct print
          await Print.printAsync({ html });
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'No se pudo exportar. Intenta de nuevo.');
    } finally {
      setExporting(false);
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
        </View>
        
        <View style={styles.inputGroupFull}>
          <Text style={styles.inputLabel}>Grosor de corte - Kerf (cm)</Text>
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

        <TouchableOpacity style={styles.addButton} onPress={addPiece}>
          <Ionicons name="add-circle" size={24} color="#4CAF50" />
          <Text style={styles.addButtonText}>Agregar pieza</Text>
        </TouchableOpacity>
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

          {/* Export Button */}
          <TouchableOpacity 
            style={[styles.exportButton, exporting && styles.exportButtonDisabled]} 
            onPress={exportToPDF}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="share-outline" size={22} color="#fff" />
                <Text style={styles.exportButtonText}>Exportar / Imprimir</Text>
              </>
            )}
          </TouchableOpacity>
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="cut-outline" size={28} color="#4CAF50" />
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

      {/* Export Options Modal */}
      <Modal
        visible={exportOptionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setExportOptionsVisible(false)}
      >
        <View style={styles.exportOverlay}>
          <View style={styles.exportContent}>
            <View style={styles.exportHeader}>
              <Text style={styles.exportTitle}>Exportar Despiece</Text>
              <TouchableOpacity onPress={() => setExportOptionsVisible(false)}>
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity 
              style={styles.exportOption} 
              onPress={() => { setExportOptionsVisible(false); exportToPDF(); }}
            >
              <View style={styles.exportOptionIcon}>
                <Ionicons name="share-outline" size={28} color="#2196F3" />
              </View>
              <View style={styles.exportOptionText}>
                <Text style={styles.exportOptionTitle}>Compartir PDF</Text>
                <Text style={styles.exportOptionDesc}>Enviar por WhatsApp, email, etc.</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.exportOption} 
              onPress={() => { setExportOptionsVisible(false); exportToPDF(); }}
            >
              <View style={styles.exportOptionIcon}>
                <Ionicons name="print-outline" size={28} color="#4CAF50" />
              </View>
              <View style={styles.exportOptionText}>
                <Text style={styles.exportOptionTitle}>Imprimir</Text>
                <Text style={styles.exportOptionDesc}>Imprimir directamente o guardar como PDF</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#666" />
            </TouchableOpacity>
          </View>
        </View>
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
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#1e1e1e',
    gap: 4,
  },
  activeTab: {
    backgroundColor: '#1b3a1b',
  },
  tabText: {
    fontSize: 13,
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
    paddingHorizontal: 16,
  },
  currentProjectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1b3a1b',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    gap: 8,
  },
  currentProjectText: {
    flex: 1,
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '500',
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputGroup: {
    flex: 1,
  },
  inputGroupFull: {
    marginTop: 12,
  },
  inputLabel: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1e1e1e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  pieceCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  pieceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pieceNameInput: {
    flex: 1,
    fontSize: 16,
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
    gap: 10,
  },
  pieceInputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  pieceInputHalf: {
    flex: 1,
  },
  pieceInputGroup: {
    flex: 1,
  },
  pieceInputLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  pieceInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#fff',
  },
  inputWithCalc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  pieceInputWithButton: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#fff',
  },
  calcButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    marginTop: 12,
    paddingTop: 12,
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
    marginTop: 10,
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
    width: 32,
    height: 32,
    borderRadius: 8,
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
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    gap: 8,
  },
  addButtonText: {
    fontSize: 15,
    color: '#4CAF50',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  calcButtonRed: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calcButtonYellow: {
    backgroundColor: '#FFC107',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2196F3',
    gap: 6,
    overflow: 'hidden',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
    flexShrink: 1,
  },
  calculateButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  calculateButtonDisabled: {
    opacity: 0.6,
  },
  calculateButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  bottomSpacer: {
    height: 40,
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
    padding: 16,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
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
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9C27B0',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
});
