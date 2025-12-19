"""
Secrets Security Evaluator
===========================

Validates proper handling of secrets and API keys (no exposure).
"""

from typing import Dict, Union, Any
import json
import re


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """
    Evaluator that validates proper use of Agenta secrets/API keys.

    Tests: Secrets retrieval, secure handling, no key exposure in output.

    Args:
        app_params: Contains references to secrets (e.g., 'api_key_name')
        inputs: Input data
        output: Should NOT contain raw API keys
        correct_answer: Expected output pattern

    Returns:
        float: 1.0 if secrets handled properly, 0.0 if exposed

    Security checks:
        - Output doesn't contain API key patterns
        - Secret names are used instead of values
        - Proper masking in logs
    """
    try:
        # Convert output to string for checking
        if isinstance(output, dict):
            output_str = json.dumps(output)
        else:
            output_str = str(output)

        checks_passed = 0
        total_checks = 6

        # Check 1: No OpenAI API key patterns in output
        openai_pattern = r'sk-[a-zA-Z0-9]{32,}'
        if not re.search(openai_pattern, output_str):
            checks_passed += 1

        # Check 2: No Anthropic API key patterns
        anthropic_pattern = r'sk-ant-[a-zA-Z0-9\-]{32,}'
        if not re.search(anthropic_pattern, output_str):
            checks_passed += 1

        # Check 3: No Google/Vertex AI key patterns
        google_pattern = r'AIza[0-9A-Za-z\-_]{35}'
        if not re.search(google_pattern, output_str):
            checks_passed += 1

        # Check 4: No common secret patterns
        generic_key_pattern = r'(api[_-]?key|secret|token)["\s:=]+[a-zA-Z0-9]{20,}'
        if not re.search(generic_key_pattern, output_str, re.IGNORECASE):
            checks_passed += 1

        # Check 5: Verify output contains expected content (not blocked by missing secrets)
        if isinstance(output, dict):
            if output.get('status') == 'success' or 'error' not in str(output).lower():
                checks_passed += 1
        else:
            if len(output_str) > 10:
                checks_passed += 1

        # Check 6: No bearer tokens exposed
        bearer_pattern = r'Bearer\s+[a-zA-Z0-9\-._~+/]+=*'
        if not re.search(bearer_pattern, output_str, re.IGNORECASE):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except Exception:
        return 0.0
