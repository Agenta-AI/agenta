"""
Secrets Masking Evaluator
==========================

Checks secrets are properly masked in logs and outputs.
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
    Evaluator that checks secrets are properly masked in logs and outputs.

    Tests: Log sanitization, masked display, partial key display.

    Args:
        app_params: Masking configuration
        inputs: Input data
        output: Should show masked secrets (e.g., "sk-***xyz")
        correct_answer: Expected masking pattern

    Returns:
        float: Score based on proper masking
    """
    try:
        # Convert output to string for checking
        if isinstance(output, dict):
            output_str = json.dumps(output)
            output_data = output
        else:
            output_str = str(output)
            try:
                output_data = json.loads(output_str)
            except json.JSONDecodeError:
                output_data = {}

        checks_passed = 0
        total_checks = 4

        # Check 1: Masked pattern exists (e.g., "***" or "****")
        if '***' in output_str or '****' in output_str or 'REDACTED' in output_str:
            checks_passed += 1

        # Check 2: No full API keys
        full_key_patterns = [
            r'sk-[a-zA-Z0-9]{40,}',  # Full OpenAI key
            r'sk-ant-[a-zA-Z0-9\-]{40,}',  # Full Anthropic key
        ]
        has_full_key = any(re.search(pattern, output_str) for pattern in full_key_patterns)
        if not has_full_key:
            checks_passed += 1

        # Check 3: Partial key shown (last 4 chars) if masking properly
        partial_pattern = r'\*{3,}[a-zA-Z0-9]{3,4}'  # e.g., "***xyz" or "****abcd"
        if re.search(partial_pattern, output_str):
            checks_passed += 1

        # Check 4: Key type/name is visible (for debugging)
        key_indicators = ['openai', 'anthropic', 'google', 'api_key', 'secret']
        if any(indicator in output_str.lower() for indicator in key_indicators):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except Exception:
        return 0.0
