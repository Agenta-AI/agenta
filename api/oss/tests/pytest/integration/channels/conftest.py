import uuid

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.channels.dbes import ChannelConnectionDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


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
    """A project + a channel_connections row, cleaned up after the test.

    connection_id columns carry no FK, but every fixture still creates a
    real connection row so connection_id reads like production data.
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

        connection = ChannelConnectionDBE(
            id=connection_id,
            project_id=project_id,
            slug=f"channels-dao-{connection_id.hex[:8]}",
            channel="slack",
            external_key=uuid.uuid4(),
            created_by_id=user_id,
            # stands for a live connection: the write path sets this once
            # verification succeeds, and routing refuses a row without it
            flags={"is_active": True, "is_verified": True},
        )
        session.add(connection)

        await session.commit()

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "connection_id": connection_id,
        # the platform-side installation id an inbound event carries
        "external_id": f"T{connection_id.hex[:8]}",
    }

    async with engine.session() as session:
        for table in (
            "channel_identity_links",
            "channel_outbox_events",
            "channel_inbox_triggers",
            "channel_inbox_events",
            "channel_threads",
            "channel_grants",
            "channel_spaces",
            "channel_agents",
            "channel_connections",
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
