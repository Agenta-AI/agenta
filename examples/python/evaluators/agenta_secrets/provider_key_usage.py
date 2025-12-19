"""
Provider Key Usage Evaluator
=============================

Tests LLM provider key management via Agenta.
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
    Evaluator for testing LLM provider key management via Agenta.

    Tests: Multiple provider keys (OpenAI, Anthropic, etc.), key rotation,
    fallback mechanisms.

    Args:
        app_params: Contains provider configuration
        inputs: Input data
        output: Should indicate successful provider authentication
        correct_answer: Expected provider response

    Returns:
        float: Score based on successful provider key usage
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        checks_passed = 0
        total_checks = 5

        # Check 1: Provider is specified and valid
        provider = output_data.get('provider', '').lower()
        valid_providers = ['openai', 'anthropic', 'google', 'cohere', 'azure', 'bedrock']
        if any(p in provider for p in valid_providers):
            checks_passed += 1

        # Check 2: Authentication succeeded
        auth_status = output_data.get('auth_status', output_data.get('status', ''))
        success_indicators = ['authenticated', 'success', 'ok', 'active']
        if any(indicator in str(auth_status).lower() for indicator in success_indicators):
            checks_passed += 1

        # Check 3: Model is available and valid
        model = output_data.get('model', '')
        if model and len(model) > 0:
            checks_passed += 1

        # Check 4: Response generated (has content)
        has_content = (
            output_data.get('content') or
            output_data.get('response') or
            output_data.get('text') or
            output_data.get('message')
        )
        if has_content:
            checks_passed += 1

        # Check 5: No authentication errors
        error_msg = str(output_data.get('error', '')).lower()
        auth_errors = ['authentication failed', 'invalid key', 'unauthorized', 'forbidden']
        if not any(err in error_msg for err in auth_errors):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
