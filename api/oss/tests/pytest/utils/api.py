import pytest
import requests

from utils.constants import BASE_TIMEOUT


@pytest.fixture(scope="session")
def unauthed_api(ag_env):
    """
    Preconfigured requests session for unauthenticated endpoints (supports all methods).
    """
    api_url = ag_env["api_url"]
    session = requests.Session()

    def _request(method: str, endpoint: str, **kwargs):
        url = f"{api_url}{endpoint}"
        return session.request(method=method, url=url, timeout=BASE_TIMEOUT, **kwargs)

    yield _request

    # Close the session after all tests
    session.close()


@pytest.fixture(scope="class")
def authed_api(cls_account):
    """
    Preconfigured requests for authenticated endpoints (supports all methods).
    """
    api_url = cls_account["api_url"]
    credentials = cls_account["credentials"]

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
