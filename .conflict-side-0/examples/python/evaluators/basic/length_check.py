"""
Length Check Evaluator
======================

Checks if output length is within expected range.
"""

from typing import Dict, Union, Any
import json


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    """
    Evaluator that checks if output length is within expected range.

    Tests basic Python operations like len(), type checking, and comparisons.

    Args:
        app_params: Should contain 'min_length' and 'max_length'
        inputs: Input data
        output: LLM app output
        correct_answer: Not used in this evaluator

    Returns:
        float: 1.0 if within range, proportional score otherwise
    """
    # Convert output to string
    if isinstance(output, dict):
        output_str = json.dumps(output)
    else:
        output_str = str(output)

    # Get length constraints from app_params
    min_length = int(app_params.get("min_length", 0))
    max_length = int(app_params.get("max_length", 10000))

    output_length = len(output_str)

    # Check if within range
    if min_length <= output_length <= max_length:
        return 1.0

    # Partial credit based on how close to range
    if output_length < min_length:
        return max(0.0, output_length / min_length)
    else:  # output_length > max_length
        return max(0.0, 1.0 - (output_length - max_length) / max_length)
