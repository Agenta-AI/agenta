import pytest


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """Session consumers recheck access through the registered AccessService. Tests
    that are not about the decision get one that allows; tests about it register
    their own."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)
