import pytest


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """Durable-work consumers here build run envelopes and recheck access through the
    registered AccessService. Tests that are not about the decision get one that
    allows; tests about it register their own."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)


@pytest.fixture(autouse=True)
def _trace_access_service(monkeypatch):
    """Evaluation runs build their trace read scope from the run's principal through
    the registered TraceAccessService. With the session filter off (the default) it
    reads nothing."""
    from oss.src.core.tracing import access

    monkeypatch.setattr(
        access,
        "_trace_access_service",
        access.TraceAccessService(sharing_service=None),
    )
