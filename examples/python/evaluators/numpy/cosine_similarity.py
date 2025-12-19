"""
Cosine Similarity Evaluator
============================

Uses NumPy for cosine similarity calculation between vectors.
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
    Evaluator using NumPy for cosine similarity calculation.

    Tests NumPy array operations and mathematical computations.

    Args:
        app_params: Application parameters
        inputs: Input data
        output: Should be a JSON string containing a 'vector' field
        correct_answer: Should be a JSON string containing a 'vector' field

    Returns:
        float: Cosine similarity score between 0.0 and 1.0

    Example:
        output = '{"vector": [1, 2, 3]}'
        correct_answer = '{"vector": [1, 2, 3]}'
        Returns: 1.0 (perfect similarity)
    """
    try:
        import numpy as np
    except ImportError:
        # If numpy is not available, fall back to basic comparison
        return 1.0 if output == correct_answer else 0.0

    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        # Parse correct answer
        answer_data = json.loads(correct_answer)

        # Extract vectors
        output_vector = np.array(output_data.get('vector', []))
        answer_vector = np.array(answer_data.get('vector', []))

        # Ensure vectors have same shape
        if output_vector.shape != answer_vector.shape:
            return 0.0

        if len(output_vector) == 0:
            return 0.0

        # Calculate cosine similarity
        dot_product = np.dot(output_vector, answer_vector)
        norm_output = np.linalg.norm(output_vector)
        norm_answer = np.linalg.norm(answer_vector)

        if norm_output == 0 or norm_answer == 0:
            return 0.0

        cosine_sim = dot_product / (norm_output * norm_answer)

        # Normalize to [0, 1] range (cosine similarity is in [-1, 1])
        normalized_score = (cosine_sim + 1) / 2

        return float(normalized_score)

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
