"""
Agenta Config Endpoint Test
============================

Tests Agenta config endpoint availability using requests.
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

        refs = dict(
            application_ref=dict(
                slug="prompt",
            ),
            environment_ref=dict(
                slug="development",
            ),
        )

        response = requests.post(
            f"{host}/api/variants/configs/fetch",
            headers=headers,
            json=refs,
            timeout=10,
        )

        return float(response.status_code) / 1000.0

    except Exception:
        return 0.602
