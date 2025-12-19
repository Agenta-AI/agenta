"""
Config Parameters Evaluator
============================

Validates proper use of Agenta configuration parameters.
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
    Evaluator that validates proper use of Agenta configuration parameters.

    Tests: Config retrieval, parameter validation, type checking, defaults.

    Args:
        app_params: Configuration parameters from Agenta
        inputs: Input data
        output: Should reflect proper config usage
        correct_answer: Expected output based on config

    Returns:
        float: Score based on correct config parameter usage

    Config parameters tested:
        - temperature (float, 0.0-2.0)
        - max_tokens (int, > 0)
        - model (string, valid model name)
        - prompt_template (string)
    """
    try:
        # Parse output if needed
        if isinstance(output, str):
            try:
                output_data = json.loads(output)
            except json.JSONDecodeError:
                output_data = {'raw': output}
        else:
            output_data = output

        checks_passed = 0
        total_checks = 6

        # Check 1: Temperature is valid (if present)
        temperature = app_params.get('temperature')
        if temperature is not None:
            try:
                temp_val = float(temperature)
                if 0.0 <= temp_val <= 2.0:
                    checks_passed += 1
            except ValueError:
                pass
        else:
            checks_passed += 1  # Not required

        # Check 2: Max tokens is valid (if present)
        max_tokens = app_params.get('max_tokens')
        if max_tokens is not None:
            try:
                tokens_val = int(max_tokens)
                if tokens_val > 0:
                    checks_passed += 1
            except ValueError:
                pass
        else:
            checks_passed += 1  # Not required

        # Check 3: Model is specified
        model = app_params.get('model', '')
        if model and len(model) > 0:
            checks_passed += 1

        # Check 4: Output uses config correctly
        output_metadata = output_data.get('metadata', output_data.get('config', {}))
        if output_metadata:
            checks_passed += 1

        # Check 5: Output structure matches config expectations
        if output_data.get('status') or output_data.get('response') or output_data.get('result'):
            checks_passed += 1

        # Check 6: No config errors
        error_msg = str(output_data.get('error', '')).lower()
        config_errors = ['invalid config', 'missing parameter', 'config error']
        if not any(err in error_msg for err in config_errors):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except Exception:
        return 0.0
