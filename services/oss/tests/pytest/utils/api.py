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


def _answered_by_another_app(response) -> bool:
    """Whether this 404 came from something other than the services app.

    The same cutover the 5xx retry above is for can also route a request away from the
    services app entirely: on a shared host the web app owns every path the services app
    does not claim at that moment, so the request is answered with an HTML page and a 404
    rather than a gateway error. Seven cases failed that way on one stage while the same
    commit passed on another, and every route involved answered normally minutes later.

    Narrow on purpose. The services app is JSON end to end, including its own 404s, so an
    HTML body is proof the request never reached it. A route that genuinely does not exist
    still fails on the first try, which is the failure worth keeping.
    """
    if response.status_code != 404:
        return False
    content_type = (response.headers.get("content-type") or "").lower()
    if "html" in content_type:
        return True
    # A proxy that sends an HTML error page without a usable content type is the same
    # event, so fall back to the body rather than trusting the header alone.
    return (response.text or "").lstrip()[:15].lower().startswith("<!doctype html")


def _request_with_gateway_retry(request_fn, *, method: str, url: str, **kwargs):
    response = None
    for attempt in range(_GATEWAY_RETRY_ATTEMPTS):
        response = request_fn(method=method, url=url, **kwargs)
        if response.status_code not in _GATEWAY_RETRY_STATUSES:
            if not _answered_by_another_app(response):
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
            timeout=INVOKE_TIMEOUT,
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
            timeout=BASE_TIMEOUT,
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
        timeout = kwargs.pop("timeout", INVOKE_TIMEOUT)
        headers.setdefault("Authorization", credentials)
        return _request_with_gateway_retry(
            requests.request,
            method=method,
            url=url,
            headers=headers,
            timeout=timeout,
            **kwargs,
        )

    return _request
