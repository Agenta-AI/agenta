"""Shared scope for the differential suite: a real project and user against
real Postgres, mirroring `bridge_process/conftest.py::bridge_scope`. No
`make_connection` helper here -- every connection this suite needs goes
through `ChannelsService.create_connection`, the same write path a human
uses, never a direct row insert.
"""

import uuid

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.postgres import postgres_reachable

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _skip_without_postgres():
    if not postgres_reachable():
        pytest.skip("Postgres not reachable — skipping differential acceptance tests")


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def differential_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "differential-acceptance-test",
                "email": f"differential-acceptance-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "differential-acceptance-test-org",
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
                "name": "differential-acceptance-test-workspace",
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
                "project_name": "differential-acceptance-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
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
            "secrets",
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
