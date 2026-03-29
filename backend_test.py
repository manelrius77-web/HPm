#!/usr/bin/env python3
"""
Backend API Testing for Wood Cutting Optimizer
Tests all endpoints with comprehensive scenarios
"""

import requests
import json
import sys
from typing import Dict, Any

# Use the correct backend URL from environment
BACKEND_URL = "https://board-slicer.preview.emergentagent.com/api"

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def add_pass(self, test_name: str):
        self.passed += 1
        print(f"✅ PASS: {test_name}")
    
    def add_fail(self, test_name: str, error: str):
        self.failed += 1
        self.errors.append(f"{test_name}: {error}")
        print(f"❌ FAIL: {test_name} - {error}")
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"TEST SUMMARY: {self.passed}/{total} tests passed")
        if self.errors:
            print(f"\nFAILED TESTS:")
            for error in self.errors:
                print(f"  - {error}")
        print(f"{'='*60}")
        return self.failed == 0

def test_health_endpoint():
    """Test the health check endpoint"""
    results = TestResults()
    
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "status" in data and data["status"] == "healthy":
                results.add_pass("Health endpoint returns healthy status")
            else:
                results.add_fail("Health endpoint", f"Invalid response format: {data}")
        else:
            results.add_fail("Health endpoint", f"Status code {response.status_code}")
            
    except Exception as e:
        results.add_fail("Health endpoint", f"Request failed: {str(e)}")
    
    return results

def test_root_endpoint():
    """Test the root API endpoint"""
    results = TestResults()
    
    try:
        response = requests.get(f"{BACKEND_URL}/", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "message" in data:
                results.add_pass("Root endpoint returns message")
            else:
                results.add_fail("Root endpoint", f"Invalid response format: {data}")
        else:
            results.add_fail("Root endpoint", f"Status code {response.status_code}")
            
    except Exception as e:
        results.add_fail("Root endpoint", f"Request failed: {str(e)}")
    
    return results

def validate_optimization_response(data: Dict[Any, Any], test_name: str) -> list:
    """Validate the structure of optimization response"""
    errors = []
    
    required_fields = ["total_boards", "board_layouts", "total_pieces", "pieces_placed", "waste_percentage"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing field: {field}")
    
    if "board_layouts" in data:
        for i, layout in enumerate(data["board_layouts"]):
            layout_fields = ["board_number", "board_length", "board_width", "pieces", "utilization"]
            for field in layout_fields:
                if field not in layout:
                    errors.append(f"Board {i+1} missing field: {field}")
            
            if "pieces" in layout:
                for j, piece in enumerate(layout["pieces"]):
                    piece_fields = ["piece_id", "name", "x", "y", "length", "width"]
                    for field in piece_fields:
                        if field not in piece:
                            errors.append(f"Board {i+1}, Piece {j+1} missing field: {field}")
    
    return errors

def test_basic_optimization():
    """Test Case 1: Basic optimization with single piece type"""
    results = TestResults()
    
    payload = {
        "board": {"length": 2440, "width": 1220},
        "pieces": [
            {"id": "1", "name": "Estante", "length": 600, "width": 400, "quantity": 4}
        ],
        "kerf": 3
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            
            # Validate response structure
            validation_errors = validate_optimization_response(data, "Basic optimization")
            if validation_errors:
                results.add_fail("Basic optimization structure", "; ".join(validation_errors))
            else:
                results.add_pass("Basic optimization response structure")
            
            # Validate logic
            if data.get("total_pieces") == 4:
                results.add_pass("Basic optimization total pieces count")
            else:
                results.add_fail("Basic optimization total pieces", f"Expected 4, got {data.get('total_pieces')}")
            
            if data.get("pieces_placed") == 4:
                results.add_pass("Basic optimization all pieces placed")
            else:
                results.add_fail("Basic optimization pieces placed", f"Expected 4, got {data.get('pieces_placed')}")
            
            if data.get("total_boards", 0) > 0:
                results.add_pass("Basic optimization boards generated")
            else:
                results.add_fail("Basic optimization boards", "No boards generated")
            
            # Check utilization is reasonable
            if 0 <= data.get("waste_percentage", 100) <= 100:
                results.add_pass("Basic optimization waste percentage valid")
            else:
                results.add_fail("Basic optimization waste", f"Invalid waste percentage: {data.get('waste_percentage')}")
                
        else:
            results.add_fail("Basic optimization", f"Status code {response.status_code}: {response.text}")
            
    except Exception as e:
        results.add_fail("Basic optimization", f"Request failed: {str(e)}")
    
    return results

def test_multiple_piece_types():
    """Test Case 2: Multiple piece types optimization"""
    results = TestResults()
    
    payload = {
        "board": {"length": 2440, "width": 1220},
        "pieces": [
            {"id": "1", "name": "Lateral", "length": 1000, "width": 500, "quantity": 3},
            {"id": "2", "name": "Estante", "length": 600, "width": 400, "quantity": 4}
        ],
        "kerf": 3
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            
            # Validate response structure
            validation_errors = validate_optimization_response(data, "Multiple pieces")
            if validation_errors:
                results.add_fail("Multiple pieces structure", "; ".join(validation_errors))
            else:
                results.add_pass("Multiple pieces response structure")
            
            # Validate logic
            expected_total = 7  # 3 + 4
            if data.get("total_pieces") == expected_total:
                results.add_pass("Multiple pieces total count")
            else:
                results.add_fail("Multiple pieces total", f"Expected {expected_total}, got {data.get('total_pieces')}")
            
            # Check that pieces have different names
            piece_names = set()
            for layout in data.get("board_layouts", []):
                for piece in layout.get("pieces", []):
                    piece_names.add(piece.get("name"))
            
            if "Lateral" in piece_names and "Estante" in piece_names:
                results.add_pass("Multiple pieces different types placed")
            else:
                results.add_fail("Multiple pieces types", f"Expected both types, found: {piece_names}")
                
        else:
            results.add_fail("Multiple pieces", f"Status code {response.status_code}: {response.text}")
            
    except Exception as e:
        results.add_fail("Multiple pieces", f"Request failed: {str(e)}")
    
    return results

def test_oversized_piece():
    """Test Case 3: Piece larger than board (should be unplaced)"""
    results = TestResults()
    
    payload = {
        "board": {"length": 1000, "width": 500},
        "pieces": [
            {"id": "1", "name": "Grande", "length": 1200, "width": 600, "quantity": 1}
        ],
        "kerf": 3
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            
            # Validate response structure
            validation_errors = validate_optimization_response(data, "Oversized piece")
            if validation_errors:
                results.add_fail("Oversized piece structure", "; ".join(validation_errors))
            else:
                results.add_pass("Oversized piece response structure")
            
            # Check unplaced pieces
            if "unplaced_pieces" in data and len(data["unplaced_pieces"]) > 0:
                results.add_pass("Oversized piece correctly unplaced")
                
                unplaced = data["unplaced_pieces"][0]
                if unplaced.get("name") == "Grande":
                    results.add_pass("Oversized piece correct name in unplaced")
                else:
                    results.add_fail("Oversized piece name", f"Expected 'Grande', got {unplaced.get('name')}")
            else:
                results.add_fail("Oversized piece", "Should have unplaced pieces")
            
            # Should have 0 pieces placed
            if data.get("pieces_placed") == 0:
                results.add_pass("Oversized piece zero placed")
            else:
                results.add_fail("Oversized piece placed count", f"Expected 0, got {data.get('pieces_placed')}")
                
        else:
            results.add_fail("Oversized piece", f"Status code {response.status_code}: {response.text}")
            
    except Exception as e:
        results.add_fail("Oversized piece", f"Request failed: {str(e)}")
    
    return results

def test_empty_pieces_validation():
    """Test Case 4: Empty pieces array (should return 400)"""
    results = TestResults()
    
    payload = {
        "board": {"length": 2440, "width": 1220},
        "pieces": [],
        "kerf": 3
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 400:
            results.add_pass("Empty pieces validation returns 400")
            
            # Check error message
            try:
                error_data = response.json()
                if "detail" in error_data:
                    results.add_pass("Empty pieces validation has error detail")
                else:
                    results.add_fail("Empty pieces error format", "Missing detail field")
            except:
                results.add_fail("Empty pieces error format", "Invalid JSON response")
        else:
            results.add_fail("Empty pieces validation", f"Expected 400, got {response.status_code}")
            
    except Exception as e:
        results.add_fail("Empty pieces validation", f"Request failed: {str(e)}")
    
    return results

def test_custom_kerf():
    """Test Case 5: Custom kerf value"""
    results = TestResults()
    
    payload = {
        "board": {"length": 2440, "width": 1220},
        "pieces": [
            {"id": "1", "name": "Pieza", "length": 500, "width": 400, "quantity": 10}
        ],
        "kerf": 5
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            
            # Validate response structure
            validation_errors = validate_optimization_response(data, "Custom kerf")
            if validation_errors:
                results.add_fail("Custom kerf structure", "; ".join(validation_errors))
            else:
                results.add_pass("Custom kerf response structure")
            
            # Should handle 10 pieces
            if data.get("total_pieces") == 10:
                results.add_pass("Custom kerf total pieces count")
            else:
                results.add_fail("Custom kerf total pieces", f"Expected 10, got {data.get('total_pieces')}")
            
            # Should place some pieces (kerf affects layout efficiency)
            if data.get("pieces_placed", 0) > 0:
                results.add_pass("Custom kerf places pieces")
            else:
                results.add_fail("Custom kerf placement", "No pieces placed")
                
        else:
            results.add_fail("Custom kerf", f"Status code {response.status_code}: {response.text}")
            
    except Exception as e:
        results.add_fail("Custom kerf", f"Request failed: {str(e)}")
    
    return results

def test_piece_positioning():
    """Test that pieces don't overlap and are positioned correctly"""
    results = TestResults()
    
    payload = {
        "board": {"length": 2440, "width": 1220},
        "pieces": [
            {"id": "1", "name": "Test", "length": 600, "width": 400, "quantity": 3}
        ],
        "kerf": 3
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/optimize", 
                               json=payload, 
                               headers={"Content-Type": "application/json"},
                               timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            
            # Check piece positioning
            for layout in data.get("board_layouts", []):
                pieces = layout.get("pieces", [])
                
                # Check all pieces are within board bounds
                board_length = layout.get("board_length", 0)
                board_width = layout.get("board_width", 0)
                
                for piece in pieces:
                    x, y = piece.get("x", 0), piece.get("y", 0)
                    length, width = piece.get("length", 0), piece.get("width", 0)
                    
                    if x >= 0 and y >= 0 and (x + length) <= board_length and (y + width) <= board_width:
                        continue  # This piece is positioned correctly
                    else:
                        results.add_fail("Piece positioning", f"Piece {piece.get('name')} out of bounds")
                        return results
                
                results.add_pass("Piece positioning within bounds")
                
                # Basic overlap check (simplified)
                if len(pieces) > 1:
                    for i, piece1 in enumerate(pieces):
                        for j, piece2 in enumerate(pieces[i+1:], i+1):
                            # Simple rectangle overlap check
                            x1, y1 = piece1.get("x", 0), piece1.get("y", 0)
                            w1, h1 = piece1.get("length", 0), piece1.get("width", 0)
                            x2, y2 = piece2.get("x", 0), piece2.get("y", 0)
                            w2, h2 = piece2.get("length", 0), piece2.get("width", 0)
                            
                            if not (x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1):
                                results.add_fail("Piece overlap", f"Pieces {piece1.get('name')} and {piece2.get('name')} overlap")
                                return results
                    
                    results.add_pass("No piece overlaps detected")
                
        else:
            results.add_fail("Piece positioning test", f"Status code {response.status_code}: {response.text}")
            
    except Exception as e:
        results.add_fail("Piece positioning test", f"Request failed: {str(e)}")
    
    return results

def main():
    """Run all backend tests"""
    print("🔧 Starting Wood Cutting Optimizer Backend Tests")
    print(f"Testing against: {BACKEND_URL}")
    print("="*60)
    
    all_results = TestResults()
    
    # Run all test cases
    test_functions = [
        ("Health Check", test_health_endpoint),
        ("Root Endpoint", test_root_endpoint),
        ("Basic Optimization", test_basic_optimization),
        ("Multiple Piece Types", test_multiple_piece_types),
        ("Oversized Piece", test_oversized_piece),
        ("Empty Pieces Validation", test_empty_pieces_validation),
        ("Custom Kerf", test_custom_kerf),
        ("Piece Positioning", test_piece_positioning),
    ]
    
    for test_name, test_func in test_functions:
        print(f"\n🧪 Running: {test_name}")
        print("-" * 40)
        result = test_func()
        all_results.passed += result.passed
        all_results.failed += result.failed
        all_results.errors.extend(result.errors)
    
    # Final summary
    success = all_results.summary()
    
    if success:
        print("\n🎉 All backend tests passed!")
        return 0
    else:
        print(f"\n💥 {all_results.failed} test(s) failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())