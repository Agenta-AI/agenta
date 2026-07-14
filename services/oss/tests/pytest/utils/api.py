import time

import pytest
import requests

from utils.constants import BASE_TIMEOUT

INVOKE_TIMEOUT = 60  # seconds — LLM calls can be slow

# A 502 right after a fresh deploy is the gateway racing the cutover to the new
# instance, not an application error — retry a few times before failing.
_GATEWAY_RETRY_STATUSES = frozenset({502, 503, 504})
_GATEWAY_RETRY_ATTEMPTS = 4
_GATEWAY_RETRY_DELAY = 2  # seconds


def _request_with_gateway_retry(request_fn, *, method: str, url: str, **kwargs):
    response = None
    for attempt in range(_GATEWAY_RETRY_ATTEMPTS):
        response = request_fn(method=method, url=url, **kwargs)
        if response.status_code not in _GATEWAY_RETRY_STATUSES:
            return response
        if attempt < _GATEWAY_RETRY_ATTEMPTS - 1:
            time.sleep(_GATEWAY_RETRY_DELAY)
    return response


@pytest.fixture(scope="session")
def unauthed_services_api(ag_env):
    """
    Session-scoped callable for unauthenticated service endpoints (e.g. /health).
    """
    services_url = ag_env["services_url"]
    session = requests.Session()

    def _request(method: str, path: str, **kwargs):
        url = f"{services_url}{path}"
        return _request_with_gateway_retry(
            session.request, method=method, url=url, timeout=BASE_TIMEOUT, **kwargs
        )

    yield _request

    session.close()


@pytest.fixture(scope="class")
def services_api(cls_account, ag_env):
    """
    Class-scoped callable for authenticated service endpoints.

    Backed by cls_account so each test class gets its own account —
    safe for pytest-xdist parallel execution.

    Usage:
        resp = services_api("POST", "/code/v0/test", json={...})
        resp = services_api("GET", "/health")
    """
    services_url = ag_env["services_url"]
    credentials = cls_account["credentials"]

    def _request(method: str, path: str, **kwargs):
        url = f"{services_url}{path}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", credentials)
        return _request_with_gateway_retry(
            requests.request,
            method=method,
            url=url,
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request


@pytest.fixture(scope="module")
def mod_api(mod_account, ag_env):
    """
    Module-scoped callable for authenticated API endpoints.

    Usage:
        resp = mod_api("POST", "/workflows/", json={...})
    """
    api_url = ag_env["api_url"]
    credentials = mod_account["credentials"]
    project_id = mod_account["project_id"]

    def _request(method: str, path: str, **kwargs):
        url = f"{api_url}{path}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", credentials)
        params = kwargs.pop("params", {})
        params.setdefault("project_id", project_id)
        return _request_with_gateway_retry(
            requests.request,
            method=method,
            url=url,
            headers=headers,
            params=params,
            timeout=INVOKE_TIMEOUT,
            **kwargs,
        )

    return _request


@pytest.fixture(scope="module")
def mod_services_api(mod_account, ag_env):
    """
    Module-scoped callable for authenticated service endpoints.

    Usage:
        resp = mod_services_api("POST", "/services/invoke", json={...})
    """
    services_url = ag_env["services_url"]
    credentials = mod_account["credentials"]

    def _request(method: str, path: str, **kwargs):
        url = f"{services_url}{path}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", credentials)
        return _request_with_gateway_retry(
            requests.request,
            method=method,
            url=url,
            headers=headers,
            timeout=INVOKE_TIMEOUT,
            **kwargs,
        )

    return _request
