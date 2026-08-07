import socket
import uuid
from functools import lru_cache
from urllib.parse import urlparse

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _postgres_reachable() -> bool:
    """TCP-probe the configured core Postgres once per session (mirrors
    unit/conftest.py's session fixture) — these DAO tests need a real DB."""

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
        pytest.skip("Postgres not reachable — skipping channels DAO integration tests")


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Dispose before dropping the reference, or the previous engine's pooled
    # connections leak (mirrors sessions/test_attachment_dao_integration.py).
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def channels_scope():
    """A project + a gateway_connections row, cleaned up after the test.

    Channels tables carry no FK to gateway_connections (entities.md §3
    lists none), but every fixture still creates a real connection row so
    connection_id reads like production data.
    """

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
                "username": "channels-dao-test",
                "email": f"channels-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "channels-dao-test-org",
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
                "name": "channels-dao-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "channels-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )

        connection = ConnectionDBE(
            id=connection_id,
            project_id=project_id,
            slug=f"channels-dao-{connection_id.hex[:8]}",
            provider_key="slack",
            integration_key=f"T{connection_id.hex[:8]}",
            created_by_id=user_id,
        )
        session.add(connection)

        await session.commit()

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "connection_id": connection_id,
    }

    async with engine.session() as session:
        for table in (
            "channel_outbox_events",
            "channel_inbox_triggers",
            "channel_inbox_events",
            "channel_threads",
            "channel_grants",
            "channel_spaces",
            "channel_agents",
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
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()
