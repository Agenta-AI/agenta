"""
Agenta Health Endpoint Test
============================

Tests Agenta API health endpoint availability using requests.
"""

from typing import Dict, Union, Any
import os


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    try:
        import requests
    except ImportError:
        return 0.0

    try:
        host = os.environ.get("AGENTA_HOST")

        if not host:
            return 0.6

        response = requests.get(
            f"{host}/api/health",
            timeout=10,
        )

        return float(response.status_code) / 1000.0

    except Exception:
        return 0.602
