"""
Word Count Evaluator
====================

Checks word count is within target range.
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
    Evaluator that checks word count is within target range.

    Tests: String splitting, counting, range checking.

    Args:
        app_params: Should contain 'target_words' or 'min_words' and 'max_words'
        inputs: Input data
        output: Text output
        correct_answer: Not used

    Returns:
        float: 1.0 if within range, proportional otherwise
    """
    # Convert output to string
    if isinstance(output, dict):
        output_str = str(output.get('text', json.dumps(output)))
    else:
        output_str = str(output)

    # Count words
    words = output_str.split()
    word_count = len(words)

    # Check target or range
    if 'target_words' in app_params:
        target = int(app_params['target_words'])
        # Allow 10% variance
        min_words = int(target * 0.9)
        max_words = int(target * 1.1)
    else:
        min_words = int(app_params.get('min_words', 0))
        max_words = int(app_params.get('max_words', 10000))

    if min_words <= word_count <= max_words:
        return 1.0

    # Partial credit
    if word_count < min_words:
        return max(0.0, word_count / min_words)
    else:
        excess = word_count - max_words
        penalty = excess / max_words
        return max(0.0, 1.0 - penalty)
