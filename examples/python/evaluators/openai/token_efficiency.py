"""
Token Efficiency Evaluator
===========================

Checks token usage efficiency of OpenAI responses.
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
    Evaluator that checks token usage efficiency of OpenAI responses.

    Tests: Token counting, cost efficiency, response quality vs tokens used.

    Args:
        app_params: Should contain 'max_tokens' budget
        inputs: Input data
        output: OpenAI response with usage information
        correct_answer: Expected token range or quality threshold

    Returns:
        float: Score based on token efficiency
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        # Get token usage
        usage = output_data.get('usage', {})
        total_tokens = usage.get('total_tokens', 0)

        if total_tokens == 0:
            return 0.0

        # Get max tokens from params
        max_tokens = int(app_params.get('max_tokens', 1000))

        # Check if within budget
        if total_tokens <= max_tokens:
            # Score based on efficiency (less tokens = higher efficiency)
            # But not too harsh - we want quality too
            efficiency_ratio = total_tokens / max_tokens

            # Optimal is using 50-90% of budget
            if 0.5 <= efficiency_ratio <= 0.9:
                return 1.0
            elif efficiency_ratio < 0.5:
                # Very efficient (short response)
                return 0.8 + (efficiency_ratio / 0.5) * 0.2
            else:  # 0.9 < ratio <= 1.0
                # Approaching limit
                return 1.0 - (efficiency_ratio - 0.9) * 5
        else:
            # Over budget - penalize proportionally
            overage_ratio = (total_tokens - max_tokens) / max_tokens
            penalty = min(1.0, overage_ratio)
            return max(0.0, 1.0 - penalty)

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
