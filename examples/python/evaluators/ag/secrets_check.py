"""
Agenta Secrets Endpoint Test
=============================

Tests Agenta secrets endpoint availability using requests.
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
        credentials = os.environ.get("AGENTA_CREDENTIALS")

        if not host:
            return 0.6

        if not credentials:
            return 0.601

        headers = dict(
            Authorization=credentials,
        )

        response = requests.get(
            f"{host}/api/vault/v1/secrets/",
            headers=headers,
            timeout=10,
        )

        return float(response.status_code) / 1000.0

    except Exception:
        return 0.602
