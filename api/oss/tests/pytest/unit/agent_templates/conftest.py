import pytest


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """Session consumers recheck access through the registered AccessService. Tests
    that are not about the decision get one that allows; tests about it register
    their own."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)


@pytest.fixture(autouse=True)
def _sharing_service(monkeypatch):
    """The load route computes the new agent's policy through the registered
    `SharingService`."""
    from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests

    return register_sharing_service_for_tests(monkeypatch)
