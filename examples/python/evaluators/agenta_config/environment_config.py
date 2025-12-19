"""
Environment Config Evaluator
=============================

Tests environment-specific configuration (dev/staging/prod).
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
    Evaluator for environment-specific configuration.

    Tests: Dev/staging/prod configs, environment variable usage, config override.

    Args:
        app_params: Should contain 'environment' (dev/staging/prod)
        inputs: Input data
        output: Should show correct environment config applied
        correct_answer: Expected environment behavior

    Returns:
        float: Score based on correct environment configuration
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        checks_passed = 0
        total_checks = 5

        # Check 1: Environment is identified
        env = output_data.get('environment', output_data.get('env', ''))
        if env:
            checks_passed += 1

        # Check 2: Environment matches app_params
        expected_env = app_params.get('environment', 'development')
        if env.lower() == expected_env.lower():
            checks_passed += 1

        # Check 3: Environment-specific settings applied
        env_config = output_data.get('config', output_data.get('settings', {}))
        if env_config:
            checks_passed += 1

        # Check 4: Correct URLs/endpoints for environment
        endpoint = output_data.get('api_endpoint', output_data.get('base_url', ''))
        if env == 'production':
            # Production should not have 'dev', 'test', 'staging' in URL
            dev_indicators = ['dev', 'test', 'staging', 'localhost']
            if not any(indicator in endpoint.lower() for indicator in dev_indicators):
                checks_passed += 1
        else:
            # Non-prod can have anything
            checks_passed += 1

        # Check 5: Appropriate security settings for environment
        security = output_data.get('security', output_data.get('security_enabled', True))
        if env == 'production':
            # Production should have security enabled
            if security:
                checks_passed += 1
        else:
            # Dev/staging can vary
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
