import pytest
import requests

from utils.constants import BASE_TIMEOUT

INVOKE_TIMEOUT = 60  # seconds — LLM calls can be slow


@pytest.fixture(scope="session")
def unauthed_services_api(ag_env):
    """
    Session-scoped callable for unauthenticated service endpoints (e.g. /health).
    """
    services_url = ag_env["services_url"]
    session = requests.Session()

    def _request(method: str, path: str, **kwargs):
        url = f"{services_url}{path}"
        return session.request(method=method, url=url, timeout=BASE_TIMEOUT, **kwargs)

    yield _request

    session.close()


@pytest.fixture(scope="class")
def services_api(cls_account, ag_env):
    """
    Class-scoped callable for authenticated service endpoints.

    Backed by cls_account so each test class gets its own account —
    safe for pytest-xdist parallel execution.

    Usage:
        resp = services_api("POST", "/custom/code/v0/test", json={...})
        resp = services_api("GET", "/health")
    """
    services_url = ag_env["services_url"]
    credentials = cls_account["credentials"]

    def _request(method: str, path: str, **kwargs):
        url = f"{services_url}{path}"
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


@pytest.fixture(scope="module")
def mod_api(mod_account, ag_env):
    """
    Module-scoped callable for authenticated API endpoints.

    Usage:
        resp = mod_api("POST", "/preview/workflows/", json={...})
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
        return requests.request(
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
        return requests.request(
            method=method,
            url=url,
            headers=headers,
            timeout=INVOKE_TIMEOUT,
            **kwargs,
        )

    return _request
