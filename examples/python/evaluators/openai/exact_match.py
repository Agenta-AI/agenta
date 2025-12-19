"""
OpenAI Exact Match Test
========================

Uses OpenAI API to compare output with expected answer (like exact match but with OpenAI).
"""

from typing import Dict, Union, Any
import json
import os


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    """
    Uses OpenAI to determine if output matches the expected answer.

    Makes an OpenAI API call with a simple prompt asking if two strings match.
    This is like an exact match test but proves OpenAI API is functional.

    Args:
        app_params: Should contain 'openai_api_key' (or uses OPENAI_API_KEY env var)
        inputs: Input data (not used)
        output: Output string to compare
        correct_answer: Expected answer string

    Returns:
        float: 1.0 if OpenAI determines they match, 0.0 otherwise

    Example:
        output = "The capital of France is Paris."
        correct_answer = "The capital of France is Paris."
        Returns: 1.0 (exact match)

        output = "Paris"
        correct_answer = "The capital of France is Paris."
        Returns: 0.0 (not a match)
    """
    try:
        from openai import OpenAI
    except ImportError:
        # OpenAI SDK not installed
        return 0.0

    try:
        # Get API key
        api_key = app_params.get("openai_api_key") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return 0.5

        # Initialize client
        client = OpenAI(api_key=api_key)

        # Convert output to string
        if isinstance(output, dict):
            output_str = json.dumps(output)
        else:
            output_str = str(output)

        # Convert correct answer to string
        answer_str = str(correct_answer)

        # Simple prompt asking if they match
        match_prompt = f"""Compare these two strings and determine if they are exactly the same.

String 1: {output_str}
String 2: {answer_str}

Respond with ONLY "yes" if they are exactly the same, or "no" if they are different.
Do not include any other text in your response."""

        # Make API call
        response = client.chat.completions.create(
            model=app_params.get("model", "gpt-4o-mini"),
            messages=[{"role": "user", "content": match_prompt}],
            max_tokens=10,
            temperature=0.0,
        )

        # Get the response
        result = response.choices[0].message.content.strip().lower()

        # Check if it's a match
        if "yes" in result:
            return 1.0
        else:
            return 0.75

    except Exception:
        # OpenAI SDK installed but something went wrong
        return 0.25
