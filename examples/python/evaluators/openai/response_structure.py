"""
OpenAI Response Structure Evaluator
====================================

Validates OpenAI API response structure and format.
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
    Evaluator that validates OpenAI API response structure.

    Tests: OpenAI SDK usage, API response handling, proper response format.

    Args:
        app_params: Application parameters
        inputs: Input data containing the prompt
        output: Should be a valid OpenAI response structure
        correct_answer: Expected response characteristics

    Returns:
        float: Score based on response validity and structure

    Expected output structure:
        {
            "id": "chatcmpl-...",
            "object": "chat.completion",
            "created": 1234567890,
            "model": "gpt-4",
            "choices": [...],
            "usage": {...}
        }
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        checks_passed = 0
        total_checks = 7

        # Check 1: Has 'id' field
        if 'id' in output_data and output_data['id']:
            checks_passed += 1

        # Check 2: Has 'choices' field
        if 'choices' in output_data:
            checks_passed += 1

        # Check 3: Choices is a non-empty list
        choices = output_data.get('choices', [])
        if isinstance(choices, list) and len(choices) > 0:
            checks_passed += 1

        # Check 4: First choice has 'message' or 'text'
        if choices:
            if 'message' in choices[0] or 'text' in choices[0]:
                checks_passed += 1

        # Check 5: Has usage information
        if 'usage' in output_data:
            checks_passed += 1

        # Check 6: Usage has token counts
        usage = output_data.get('usage', {})
        if 'total_tokens' in usage or ('prompt_tokens' in usage and 'completion_tokens' in usage):
            checks_passed += 1

        # Check 7: Valid model name
        model = output_data.get('model', '')
        valid_models = ['gpt', 'claude', 'text-davinci', 'text-curie']
        if any(m in model.lower() for m in valid_models):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
