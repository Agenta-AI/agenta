"""OpenAI SDK evaluators.

Simple tests to verify OpenAI SDK availability and basic functionality.
Requires: pip install openai
Requires: OPENAI_API_KEY environment variable or passed in app_params
"""

from .dependency_check import evaluate as openai_available
from .exact_match import evaluate as openai_exact_match

__all__ = [
    "dependency_check",
    "exact_match",
]
