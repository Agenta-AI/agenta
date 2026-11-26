import pytest


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """The invoke prelude reads the run's acting user from the registered
    AccessService. Tests here that are not about it get one that allows."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)
