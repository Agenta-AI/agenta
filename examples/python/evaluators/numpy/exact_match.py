"""
NumPy Character Count Match Test
=================================

Simple NumPy operation that counts characters in strings (like exact match but with NumPy).
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
    Tests NumPy functionality by counting characters in strings.

    A simple operation that requires NumPy: converts strings to character arrays,
    counts the length using NumPy, and checks if they match.
    This is like an exact match test but proves NumPy is functional.

    Args:
        app_params: Application parameters (not used)
        inputs: Input data (not used)
        output: Output string to compare
        correct_answer: Expected answer string

    Returns:
        float: 1.0 if character counts match, 0.0 otherwise

    Example:
        output = "The capital of France is Paris."
        correct_answer = "The capital of France is Paris."
        Returns: 1.0 (same length, 31 chars)

        output = "Paris"
        correct_answer = "The capital of France is Paris."
        Returns: 0.0 (different lengths: 5 vs 31)
    """
    try:
        import numpy as np
    except ImportError:
        # NumPy not available
        return 0.0

    try:
        # Convert output to string
        if isinstance(output, dict):
            output_str = json.dumps(output)
        else:
            output_str = str(output)

        # Convert correct answer to string
        answer_str = str(correct_answer)

        # Convert strings to NumPy character arrays
        output_array = np.array(list(output_str))
        answer_array = np.array(list(answer_str))

        # Count characters using NumPy
        output_length = np.size(output_array)
        answer_length = np.size(answer_array)

        # Check if lengths match
        if output_length == answer_length:
            return 1.0
        else:
            return 0.0

    except (ValueError, TypeError, AttributeError):
        return 0.0
