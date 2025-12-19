"""
Database Credentials Evaluator
===============================

Tests database and service credentials managed via Agenta config.
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
    Evaluator for database and service credentials managed via Agenta config.

    Tests: Database connection strings, service URLs, credential validation,
    secure credential storage (not exposed in output).

    Args:
        app_params: Should contain credential references (not actual values)
        inputs: Input data
        output: Should indicate successful connection without exposing creds
        correct_answer: Expected connection status

    Returns:
        float: Score based on proper credential handling
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_str = output
            try:
                output_data = json.loads(output)
            except json.JSONDecodeError:
                output_data = {'raw': output}
        else:
            output_data = output
            output_str = json.dumps(output)

        checks_passed = 0
        total_checks = 5

        # Check 1: No database passwords in output
        password_patterns = [
            r'password["\s:=]+[a-zA-Z0-9!@#$%^&*()]+',
            r'PASSWORD["\s:=]+[a-zA-Z0-9!@#$%^&*()]+',
            r'pwd["\s:=]+[a-zA-Z0-9!@#$%^&*()]+',
        ]
        no_password_exposed = True
        for pattern in password_patterns:
            if re.search(pattern, output_str):
                no_password_exposed = False
                break

        if no_password_exposed:
            checks_passed += 1

        # Check 2: No connection strings in output
        connection_patterns = [
            r'(postgres|postgresql)://[^"\'}\s]+',
            r'mysql://[^"\'}\s]+',
            r'mongodb://[^"\'}\s]+',
            r'redis://[^"\'}\s]+',
        ]
        no_connection_string = True
        for pattern in connection_patterns:
            if re.search(pattern, output_str, re.IGNORECASE):
                no_connection_string = False
                break

        if no_connection_string:
            checks_passed += 1

        # Check 3: Connection status is reported
        connection_status = output_data.get('connection_status', output_data.get('db_status', ''))
        success_indicators = ['connected', 'success', 'active', 'ok']
        if any(indicator in str(connection_status).lower() for indicator in success_indicators):
            checks_passed += 1

        # Check 4: Service/database name referenced (but not credentials)
        has_reference = (
            output_data.get('service_name') or
            output_data.get('database_name') or
            output_data.get('db_name')
        )
        if has_reference:
            checks_passed += 1

        # Check 5: No usernames in output (unless explicitly allowed)
        username_pattern = r'(username|user)["\s:=]+[a-zA-Z0-9_-]+'
        if not re.search(username_pattern, output_str):
            checks_passed += 1

        score = checks_passed / total_checks
        return score

    except Exception:
        return 0.0
