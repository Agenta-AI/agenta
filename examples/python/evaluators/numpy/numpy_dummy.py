"""
Array Sum Match Test
=====================

Simple NumPy operation that compares array sums (like exact match but with NumPy).
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
    Tests NumPy functionality by comparing array sums.

    A simple operation that requires NumPy: converts output and expected answer
    to arrays, calculates the sum of each, and checks if they match.
    This is like an exact match test but proves NumPy is functional.

    Args:
        app_params: Application parameters (not used)
        inputs: Input data (not used)
        output: Should be a JSON array or list of numbers
        correct_answer: Should be a JSON array or list of numbers

    Returns:
        float: 1.0 if array sums match, 0.0 otherwise

    Example:
        output = "[1, 2, 3]"          # sum = 6
        correct_answer = "[2, 2, 2]"  # sum = 6
        Returns: 1.0 (sums match)

        output = "[1, 2, 3]"          # sum = 6
        correct_answer = "[1, 1, 1]"  # sum = 3
        Returns: 0.0 (sums don't match)
    """
    try:
        import numpy as np
    except ImportError:
        # NumPy not available
        return 0.0

    try:
        # Parse output
        if isinstance(output, str):
            try:
                output_data = json.loads(output)
            except json.JSONDecodeError:
                # Maybe it's already a string representation of a list
                output_data = output
        else:
            output_data = output

        # Parse correct answer
        try:
            answer_data = json.loads(correct_answer)
        except json.JSONDecodeError:
            answer_data = correct_answer

        # Convert to numpy arrays
        output_array = np.array(output_data)
        answer_array = np.array(answer_data)

        # Calculate sums using NumPy
        output_sum = np.sum(output_array)
        answer_sum = np.sum(answer_array)

        # Check if sums match (with small tolerance for floating point)
        if np.isclose(output_sum, answer_sum, rtol=1e-5, atol=1e-8):
            return 1.0
        else:
            return 0.0

    except (ValueError, TypeError, AttributeError):
        return 0.0
