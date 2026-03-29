import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types
interface Piece {
  id: string;
  name: string;
  length: string;
  width: string;
  quantity: string;
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
}

// Color palette for pieces
const PIECE_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FFC107', '#795548', '#607D8B', '#F44336',
  '#3F51B5', '#009688', '#CDDC39', '#FF5722', '#673AB7',
];

export default function Index() {
  // Board state
  const [boardLength, setBoardLength] = useState('2440');
  const [boardWidth, setBoardWidth] = useState('1220');
  const [kerf, setKerf] = useState('3');

  // Pieces state
  const [pieces, setPieces] = useState<Piece[]>([
    { id: '1', name: 'Pieza 1', length: '600', width: '400', quantity: '2' },
  ]);

  // Result state
  const [result, setResult] = useState<CutResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'result'>('input');

  const addPiece = () => {
    const newId = String(Date.now());
    setPieces([...pieces, { id: newId, name: `Pieza ${pieces.length + 1}`, length: '', width: '', quantity: '1' }]);
  };

  const removePiece = (id: string) => {
    if (pieces.length > 1) {
      setPieces(pieces.filter(p => p.id !== id));
    }
  };

  const updatePiece = (id: string, field: keyof Piece, value: string) => {
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

  const renderBoardDiagram = (layout: BoardLayout, index: number) => {
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
            const color = PIECE_COLORS[pieceIndex % PIECE_COLORS.length];

            return (
              <View
                key={piece.piece_id}
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
                  {piece.length}x{piece.width}
                </Text>
                {piece.rotated && (
                  <Ionicons name="sync" size={12} color="#fff" style={styles.rotatedIcon} />
                )}
              </View>
            );
          })}
        </View>
        
        <Text style={styles.boardDimensions}>
          {layout.board_length} x {layout.board_width} mm
        </Text>
      </View>
    );
  };

  const renderInputTab = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      {/* Board Settings */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="cube-outline" size={22} color="#4CAF50" />
          <Text style={styles.sectionTitle}>Tablero</Text>
        </View>
        
        <View style={styles.inputRow}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Largo (mm)</Text>
            <TextInput
              style={styles.input}
              value={boardLength}
              onChangeText={setBoardLength}
              keyboardType="numeric"
              placeholder="2440"
              placeholderTextColor="#666"
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Ancho (mm)</Text>
            <TextInput
              style={styles.input}
              value={boardWidth}
              onChangeText={setBoardWidth}
              keyboardType="numeric"
              placeholder="1220"
              placeholderTextColor="#666"
            />
          </View>
        </View>
        
        <View style={styles.inputGroupFull}>
          <Text style={styles.inputLabel}>Grosor de corte - Kerf (mm)</Text>
          <TextInput
            style={styles.input}
            value={kerf}
            onChangeText={setKerf}
            keyboardType="numeric"
            placeholder="3"
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
              {pieces.length > 1 && (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removePiece(piece.id)}
                >
                  <Ionicons name="close-circle" size={24} color="#F44336" />
                </TouchableOpacity>
              )}
            </View>
            
            <View style={styles.pieceInputs}>
              <View style={styles.pieceInputGroup}>
                <Text style={styles.pieceInputLabel}>Largo</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.length}
                  onChangeText={(text) => updatePiece(piece.id, 'length', text)}
                  keyboardType="numeric"
                  placeholder="mm"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.pieceInputGroup}>
                <Text style={styles.pieceInputLabel}>Ancho</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.width}
                  onChangeText={(text) => updatePiece(piece.id, 'width', text)}
                  keyboardType="numeric"
                  placeholder="mm"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.pieceInputGroup}>
                <Text style={styles.pieceInputLabel}>Cantidad</Text>
                <TextInput
                  style={styles.pieceInput}
                  value={piece.quantity}
                  onChangeText={(text) => updatePiece(piece.id, 'quantity', text)}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor="#666"
                />
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addButton} onPress={addPiece}>
          <Ionicons name="add-circle" size={24} color="#4CAF50" />
          <Text style={styles.addButtonText}>Agregar pieza</Text>
        </TouchableOpacity>
      </View>

      {/* Calculate Button */}
      <TouchableOpacity
        style={[styles.calculateButton, loading && styles.calculateButtonDisabled]}
        onPress={calculateCut}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="calculator" size={24} color="#fff" />
            <Text style={styles.calculateButtonText}>Calcular Despiece</Text>
          </>
        )}
      </TouchableOpacity>
      
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );

  const renderResultTab = () => (
    <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
      {result ? (
        <>
          {/* Summary */}
          <View style={styles.summarySection}>
            <View style={styles.summaryCard}>
              <Ionicons name="layers" size={32} color="#4CAF50" />
              <Text style={styles.summaryNumber}>{result.total_boards}</Text>
              <Text style={styles.summaryLabel}>Tableros</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="grid" size={32} color="#2196F3" />
              <Text style={styles.summaryNumber}>{result.pieces_placed}</Text>
              <Text style={styles.summaryLabel}>Piezas</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="trash-outline" size={32} color="#FF9800" />
              <Text style={styles.summaryNumber}>{result.waste_percentage}%</Text>
              <Text style={styles.summaryLabel}>Desperdicio</Text>
            </View>
          </View>

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
            {result.board_layouts.map((layout, index) => renderBoardDiagram(layout, index))}
          </View>

          {/* Piece Legend */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list-outline" size={22} color="#607D8B" />
              <Text style={styles.sectionTitle}>Leyenda de Piezas</Text>
            </View>
            <View style={styles.legendContainer}>
              {pieces.filter(p => p.length && p.width).map((piece, index) => (
                <View key={piece.id} style={styles.legendItem}>
                  <View style={[styles.legendColor, { backgroundColor: PIECE_COLORS[index % PIECE_COLORS.length] }]} />
                  <Text style={styles.legendText}>
                    {piece.name}: {piece.length}x{piece.width}mm (x{piece.quantity})
                  </Text>
                </View>
              ))}
            </View>
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
      </View>

      <KeyboardAvoidingView 
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {activeTab === 'input' ? renderInputTab() : renderResultTab()}
      </KeyboardAvoidingView>
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
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1e1e1e',
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#1b3a1b',
  },
  tabText: {
    fontSize: 15,
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
  pieceInputs: {
    flexDirection: 'row',
    gap: 10,
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
  calculateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 10,
  },
  calculateButtonDisabled: {
    opacity: 0.6,
  },
  calculateButtonText: {
    fontSize: 17,
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
});
