"""
JSON Structure Evaluator
=========================

Validates JSON structure and required fields.
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
    Evaluator that validates JSON structure and required fields.

    Tests: JSON parsing, dict operations, key checking.

    Args:
        app_params: Should contain 'required_fields' (comma-separated)
        inputs: Input data
        output: Should be valid JSON
        correct_answer: Not used

    Returns:
        float: Score based on JSON validity and required fields present
    """
    try:
        # Parse output if string
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        if not isinstance(output_data, dict):
            return 0.0

        # Get required fields
        required_fields = app_params.get("required_fields", "").split(",")
        required_fields = [f.strip() for f in required_fields if f.strip()]

        if not required_fields:
            # No specific requirements, just valid JSON
            return 1.0

        # Check each required field
        fields_present = sum(1 for field in required_fields if field in output_data)
        score = fields_present / len(required_fields)

        return score

    except (json.JSONDecodeError, ValueError, TypeError):
        return 0.0
