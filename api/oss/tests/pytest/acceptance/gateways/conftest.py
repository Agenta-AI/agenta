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


@pytest.fixture(scope="session")
def llm_gateway_plane(cls_account) -> bool:
    """Whether the DEPLOYMENT under test serves the LLM gateway plane.

    Read from the deployment, not from this process's environment. An acceptance suite runs
    against a stack it did not configure, and `AGENTA_LLM_GATEWAY_ENABLED` defaults off, so
    the only trustworthy answer is the one the API gives. Any management route refuses the
    same way; listing endpoints is the cheapest and changes nothing.
    """
    response = requests.get(
        f"{cls_account['api_url']}/gateways/llms/endpoints/",
        headers={"Authorization": cls_account["credentials"]},
        timeout=BASE_TIMEOUT,
    )
    if response.status_code != 403:
        return True

    try:
        detail = response.json().get("detail")
    except ValueError:
        return True
    code = detail.get("code") if isinstance(detail, dict) else None
    return code != "llm_gateway_disabled"


@pytest.fixture
def requires_llm_gateway(llm_gateway_plane: bool) -> None:
    if not llm_gateway_plane:
        pytest.skip(
            "the LLM gateway plane is disabled on this deployment "
            "(set AGENTA_LLM_GATEWAY_ENABLED=true to run it)"
        )


@pytest.fixture
def requires_llm_gateway_off(llm_gateway_plane: bool) -> None:
    if llm_gateway_plane:
        pytest.skip(
            "the LLM gateway plane is enabled on this deployment "
            "(unset AGENTA_LLM_GATEWAY_ENABLED to run the legacy vault path)"
        )
