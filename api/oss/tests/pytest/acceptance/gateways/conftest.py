"""Fixtures for the gateway data plane.

The data plane reads `X-AG-Credentials` and nothing else (D31), so its calls cannot use the
shared `authed_api`, which sets `Authorization`. That header is deliberately absent here:
on a data-plane request it belongs to the upstream, and sending one would exercise
pass-through rather than the path under test.
"""

import pytest
import requests

from oss.src.utils.env import env  # noqa: F401  — keeps env import ordering with the suite

BASE_TIMEOUT = 60


@pytest.fixture
def gateway_api(cls_account):
    """Authenticated data-plane requests: our credentials in our own header."""
    api_url = cls_account["api_url"]
    credentials = cls_account["credentials"]

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("X-AG-Credentials", credentials)

        return requests.request(
            method=method,
            url=f"{api_url}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request
