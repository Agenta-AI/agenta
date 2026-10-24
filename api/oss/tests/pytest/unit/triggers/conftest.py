import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    parsed = urlparse(env.postgres.uri_core)
    host = parsed.hostname or "postgres"
    port = parsed.port or 5432
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    if request.node.get_closest_marker("integration") and not _postgres_reachable():
        pytest.skip("Postgres not reachable — skipping trigger DAO integration tests")


@pytest.fixture(autouse=True)
def _allowing_access_service(monkeypatch):
    """Durable-work consumers here build run envelopes and recheck access through the
    registered AccessService. Tests that are not about the decision get one that
    allows; tests about it register their own."""
    from oss.tests.pytest.utils.principals import register_allowing_access_service

    return register_allowing_access_service(monkeypatch)


@pytest.fixture(autouse=True)
def _mock_workflows_resolve_a_target(monkeypatch):
    """The dispatcher resolves the request target before the claim (M2). Tests that
    pass a bare `MagicMock` workflows service get a target that resolves to a live
    agent; tests about the resolution configure `resolve_request_target` themselves."""

    from unittest.mock import AsyncMock, Mock
    from uuid import uuid4

    from oss.src.core.workflows.dtos import ResolvedTarget
    from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher

    original = TriggersDispatcher.__init__

    def _init(self, *args, **kwargs):
        workflows = kwargs.get("workflows_service")
        if isinstance(workflows, Mock) and not isinstance(
            workflows.__dict__.get("resolve_request_target"), AsyncMock
        ):
            workflows.resolve_request_target = AsyncMock(
                return_value=ResolvedTarget(artifact_id=uuid4(), revision_id=uuid4())
            )
        original(self, *args, **kwargs)

    monkeypatch.setattr(TriggersDispatcher, "__init__", _init)
