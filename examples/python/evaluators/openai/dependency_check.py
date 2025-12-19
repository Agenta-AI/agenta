"""
OpenAI Available Test
=====================

Simple predicate test to check if OpenAI SDK is available and working.
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
    Tests if OpenAI SDK is available and can make API calls.

    This is a simple predicate test that attempts to make a basic OpenAI API call.
    Returns 1.0 if successful, 0.0 if not.

    Args:
        app_params: Should contain 'openai_api_key' (or uses OPENAI_API_KEY env var)
        inputs: Input data (not used)
        output: LLM output (not used)
        correct_answer: Expected answer (not used)

    Returns:
        float: 1.0 if OpenAI is available and working, 0.0 otherwise

    Example:
        # If OpenAI SDK is installed and API key is valid
        Returns: 1.0

        # If OpenAI SDK is not installed or API key is invalid
        Returns: 0.0
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

        # Make a simple test API call (very cheap, minimal tokens)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Say 'OK'"}],
            max_tokens=5,
            temperature=0.0,
        )

        # If we got here, OpenAI is available and working
        return 1.0

    except Exception:
        # OpenAI SDK installed but something went wrong
        # (invalid key, network issue, etc.)
        return 0.0
