"""
Statistical Accuracy Evaluator
===============================

Tests NumPy statistical operations (mean, std, median, etc.).
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
    Evaluator testing various NumPy statistical operations.

    Tests: array creation, statistical operations (mean, std, median), comparisons.

    Args:
        app_params: Application parameters (can include 'tolerance')
        inputs: Input data containing 'numbers' field
        output: Should be a JSON with statistical results
        correct_answer: Expected statistics as JSON

    Returns:
        float: Score based on accuracy of statistical calculations
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

        # Get tolerance
        tolerance = float(app_params.get('tolerance', 0.01))

        # Compare statistics
        scores = []
        metrics = ['mean', 'std', 'median', 'min', 'max']

        for metric in metrics:
            if metric in answer_data:
                output_val = float(output_data.get(metric, 0))
                expected_val = float(answer_data.get(metric, 0))

                # Calculate relative error
                if expected_val != 0:
                    rel_error = abs(output_val - expected_val) / abs(expected_val)
                else:
                    rel_error = abs(output_val - expected_val)

                # Score this metric
                if rel_error < tolerance:
                    scores.append(1.0)
                else:
                    scores.append(max(0.0, 1.0 - rel_error))

        if not scores:
            return 0.0

        # Average the scores
        return sum(scores) / len(scores)

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
