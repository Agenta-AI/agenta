"""
Function Calling Evaluator
===========================

Validates OpenAI function calling (tools) feature.
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
    Evaluator for OpenAI function calling (tools) feature.

    Tests: Tool definition, function call detection, argument parsing.

    Args:
        app_params: Should contain expected function name
        inputs: Input data
        output: OpenAI response with function call
        correct_answer: Expected function call details

    Returns:
        float: Score based on correct function calling usage
    """
    try:
        # Parse output
        if isinstance(output, str):
            output_data = json.loads(output)
        else:
            output_data = output

        checks_passed = 0
        total_checks = 5

        # Get the first choice
        choices = output_data.get('choices', [])
        if not choices:
            return 0.0

        message = choices[0].get('message', {})

        # Check 1: Has tool_calls or function_call
        has_tool_calls = 'tool_calls' in message or 'function_call' in message
        if has_tool_calls:
            checks_passed += 1

        # Check 2: Function name is present
        function_name = None
        if 'tool_calls' in message and message['tool_calls']:
            function_name = message['tool_calls'][0].get('function', {}).get('name')
        elif 'function_call' in message:
            function_name = message['function_call'].get('name')

        if function_name:
            checks_passed += 1

        # Check 3: Expected function name matches (if specified)
        expected_function = app_params.get('expected_function_name')
        if expected_function:
            if function_name == expected_function:
                checks_passed += 1
        else:
            checks_passed += 1  # No expectation, so pass

        # Check 4: Has function arguments
        arguments = None
        if 'tool_calls' in message and message['tool_calls']:
            arguments = message['tool_calls'][0].get('function', {}).get('arguments')
        elif 'function_call' in message:
            arguments = message['function_call'].get('arguments')

        if arguments:
            checks_passed += 1

            # Check 5: Arguments are valid JSON
            try:
                if isinstance(arguments, str):
                    json.loads(arguments)
                checks_passed += 1
            except json.JSONDecodeError:
                pass

        score = checks_passed / total_checks
        return score

    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        return 0.0
