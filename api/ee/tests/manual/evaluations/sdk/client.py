from os import getenv

import requests

BASE_TIMEOUT = 10

AGENTA_API_KEY = getenv("AGENTA_API_KEY")
AGENTA_API_URL = getenv("AGENTA_API_URL")


def authed_api():
    """
    Preconfigured requests for authenticated endpoints (supports all methods).
    """

    api_url = AGENTA_API_URL
    credentials = f"ApiKey {AGENTA_API_KEY}"

    def _request(method: str, endpoint: str, **kwargs):
        url = f"{api_url}{endpoint}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", credentials)

        return requests.request(
            method=method,
            url=url,
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request
