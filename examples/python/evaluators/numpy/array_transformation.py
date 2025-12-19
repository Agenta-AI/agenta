"""
Array Transformation Evaluator
===============================

Tests NumPy array transformations (reshape, transpose, etc.).
"""

from typing import Dict, Union, Any
import json


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """
    Evaluator for NumPy array transformations and operations.

    Tests: reshape, transpose, broadcasting, element-wise operations.

    Args:
        app_params: Should contain 'operation' (e.g., 'transpose', 'reshape')
        inputs: Input array data
        output: Transformed array
        correct_answer: Expected transformed array

    Returns:
        float: 1.0 if arrays match, 0.0 otherwise
    """
    try:
        import numpy as np
    except ImportError:
        return 0.0

    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        # Parse expected answer
        answer_data = json.loads(correct_answer)

        # Extract arrays
        output_array = np.array(output_data.get('result', []))
        expected_array = np.array(answer_data.get('result', []))

        # Check shape
        if output_array.shape != expected_array.shape:
            return 0.0

        # Check values (with small tolerance for floating point)
        if np.allclose(output_array, expected_array, rtol=1e-5, atol=1e-8):
            return 1.0

        # Partial credit based on how many elements match
        if output_array.size == 0:
            return 0.0

        matching_elements = np.sum(np.isclose(output_array, expected_array))
        score = matching_elements / output_array.size

        return float(score)

    except (json.JSONDecodeError, KeyError, ValueError, TypeError, AttributeError):
        return 0.0
