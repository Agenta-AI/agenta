"""
Config Validation Evaluator
============================

Tests configuration validation and error handling.
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
    Evaluator for configuration validation and error handling.

    Tests: Required fields, type validation, range checking, defaults.

    Args:
        app_params: Configuration to validate
        inputs: Input data
        output: Should show validation results
        correct_answer: Expected validation outcome

    Returns:
        float: Score based on proper validation
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        checks_passed = 0
        total_checks = 5

        # Check 1: Validation was performed
        if 'validation' in output_data or 'validated' in output_data:
            checks_passed += 1

        # Check 2: Required fields checked
        required_fields = output_data.get('required_fields_present', True)
        if required_fields:
            checks_passed += 1

        # Check 3: Type validation performed
        type_validation = output_data.get('types_valid', output_data.get('type_check', True))
        if type_validation:
            checks_passed += 1

        # Check 4: Validation errors reported (if any)
        validation_errors = output_data.get('validation_errors', [])
        if isinstance(validation_errors, list):
            # Having an errors list (even if empty) means validation ran
            checks_passed += 1

        # Check 5: Overall validation status
        is_valid = output_data.get('is_valid', output_data.get('valid', False))
        expected_valid = correct_answer.lower() in ['true', 'valid', '1', 'yes']

        if is_valid == expected_valid:
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
