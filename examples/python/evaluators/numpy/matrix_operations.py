"""
Matrix Operations Evaluator
============================

Tests matrix operations using NumPy (multiplication, inverse, determinant, etc.).
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
    Evaluator for matrix operations using NumPy.

    Tests: matrix multiplication, inverse, determinant, eigenvalues.

    Args:
        app_params: Should contain 'operation' type
        inputs: Matrix data
        output: Result of matrix operation
        correct_answer: Expected result

    Returns:
        float: Score based on correctness of matrix operation
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

        operation = app_params.get('operation', 'multiply')

        if operation in ['determinant', 'trace', 'rank']:
            # Scalar results
            output_val = float(output_data.get('result', 0))
            expected_val = float(answer_data.get('result', 0))

            # Allow small numerical errors
            if abs(expected_val) > 1e-10:
                rel_error = abs(output_val - expected_val) / abs(expected_val)
            else:
                rel_error = abs(output_val - expected_val)

            if rel_error < 1e-5:
                return 1.0
            else:
                return max(0.0, 1.0 - rel_error * 10)

        else:
            # Matrix results
            output_matrix = np.array(output_data.get('result', []))
            expected_matrix = np.array(answer_data.get('result', []))

            if output_matrix.shape != expected_matrix.shape:
                return 0.0

            if np.allclose(output_matrix, expected_matrix, rtol=1e-5, atol=1e-8):
                return 1.0

            # Partial credit
            if output_matrix.size == 0:
                return 0.0

            diff = np.abs(output_matrix - expected_matrix)
            avg_diff = np.mean(diff)

            score = max(0.0, 1.0 - avg_diff)
            return float(score)

    except (json.JSONDecodeError, KeyError, ValueError, TypeError, AttributeError):
        return 0.0
