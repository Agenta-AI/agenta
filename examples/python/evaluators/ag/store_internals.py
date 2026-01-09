"""
Agenta Internals Demo
=====================

Demonstrates using ag.tracing.store_internals() to expose internal evaluation data
in the observability interface.

This evaluator shows how to use store_internals() to make intermediate values
visible in the observability drawer.
"""

from typing import Dict, Union, Any


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    """
    Simple evaluator that demonstrates storing internals.

    This example:
    1. Stores a hello world message using ag.tracing.store_internals()
    2. Stores evaluation details for debugging
    3. Returns a score based on string comparison
    """
    try:
        import agenta as ag
    except ImportError:
        # If agenta is not available, still run the evaluation
        return 1.0 if str(output).lower() == str(correct_answer).lower() else 0.0

    # Store a simple hello world message in internals
    ag.tracing.store_internals(
        {
            "message": "Hello World from evaluator internals!",
            "evaluator_name": "internals_demo",
        }
    )

    # Perform actual evaluation
    output_str = str(output).lower().strip()
    correct_str = str(correct_answer).lower().strip()

    match = output_str == correct_str
    score = 1.0 if match else 0.0

    # Store evaluation details as internals
    # These will be visible in the observability drawer
    ag.tracing.store_internals(
        {
            "output_processed": output_str,
            "correct_answer_processed": correct_str,
            "exact_match": match,
            "score": score,
        }
    )

    return score
