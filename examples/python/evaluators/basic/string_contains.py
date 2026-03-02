"""
Basic String Contains Evaluator
================================

Checks if the output contains expected keywords using basic Python string operations.
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
    Evaluator that checks if the output contains expected keywords.

    Tests basic Python string operations without external dependencies.

    Args:
        app_params: Application parameters
        inputs: Input data
        output: LLM app output
        correct_answer: Expected answer from testset

    Returns:
        float: Score between 0.0 and 1.0

    Example:
        output = "The capital of France is Paris"
        correct_answer = "Paris"
        Returns: 1.0
    """
    # Convert output to string if it's a dict
    if isinstance(output, dict):
        output_str = json.dumps(output)
    else:
        output_str = str(output)

    # Normalize strings for comparison
    output_normalized = output_str.lower().strip()
    answer_normalized = correct_answer.lower().strip()

    # Check if answer is contained in output
    if answer_normalized in output_normalized:
        return 1.0

    # Partial credit for word overlap
    words_in_output = set(output_normalized.split())
    words_in_answer = set(answer_normalized.split())

    if not words_in_answer:
        return 0.0

    # Calculate overlap
    overlap = len(words_in_output.intersection(words_in_answer))
    score = overlap / len(words_in_answer)

    return min(score, 1.0)
