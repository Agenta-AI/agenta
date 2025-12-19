"""Agenta endpoint evaluators.

Simple tests to verify Agenta API endpoints using requests.
Requires: pip install requests (in dev dependencies)
Requires: AGENTA_API_URL and AGENTA_CREDENTIALS environment variables or passed in app_params
"""

from .secrets_check import evaluate as secrets_check
from .configs_check import evaluate as configs_check
from .health_check import evaluate as health_check

__all__ = [
    "secrets_check",
    "configs_check",
    "health_check",
]
