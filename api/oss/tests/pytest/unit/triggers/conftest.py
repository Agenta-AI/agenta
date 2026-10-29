import socket
from functools import lru_cache
from urllib.parse import urlparse

import pytest
import pytest_asyncio

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
def _registered_sharing_service(monkeypatch):
    """The dispatcher takes the registered SharingService for the claim's initial
    policy (normally built by bootstrap_access)."""
    from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests

    return register_sharing_service_for_tests(monkeypatch)


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


@pytest_asyncio.fixture
async def _fresh_engine_per_test():
    """A new transactions engine per Postgres test, closed after it."""
    import oss.src.dbs.postgres.shared.engine as engine_module

    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest_asyncio.fixture
async def trigger_scope(_fresh_engine_per_test):
    """A user, organization, workspace, project and project connection in Postgres,
    removed after the test with the trigger rows of the project."""
    import uuid

    from sqlalchemy import text

    import oss.src.models.db_models  # noqa: F401
    from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE  # noqa: F401
    from oss.src.dbs.postgres.shared.engine import get_transactions_engine

    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    connection_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "trigger-test",
                "email": f"trigger-test-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "trigger-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "trigger-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "name": "trigger-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO gateway_connections "
                "(id, project_id, created_by_id, slug, provider_key, integration_key) "
                "VALUES (:id, :project_id, :user_id, :slug, :provider_key, :integration_key)"
            ),
            {
                "id": connection_id,
                "project_id": project_id,
                "user_id": user_id,
                "slug": "trigger-test-connection",
                "provider_key": "composio",
                "integration_key": "github",
            },
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "connection_id": connection_id,
    }

    async with engine.session() as session:
        for table in (
            "trigger_deliveries",
            "session_streams",
            "trigger_subscriptions",
            "trigger_schedules",
            "gateway_connections",
        ):
            await session.execute(
                text(f"DELETE FROM {table} WHERE project_id = :project_id"),
                {"project_id": project_id},
            )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": organization_id}
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()
