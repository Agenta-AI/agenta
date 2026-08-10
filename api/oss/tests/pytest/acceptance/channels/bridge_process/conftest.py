"""Shared scope for the bridge acceptance suite: a real project and however
many channel_connections rows a test needs, against real Postgres. Mirrors
integration/channels/conftest.py's channels_scope, generalised to N
connections since the point of this suite is two bridges at once.
"""

import uuid
from typing import Any, Dict, Optional

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.apis.fastapi.channels.ingress import _placeholder_external_key
from oss.src.dbs.postgres.channels.dbes import ChannelConnectionDBE
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.postgres import postgres_reachable

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _skip_without_postgres():
    if not postgres_reachable():
        pytest.skip("Postgres not reachable — skipping bridge acceptance tests")


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
async def bridge_scope():
    """A project, cleaned up after the test. Connections are created per-test
    via `make_connection` so each test controls exactly how many bridges (and
    which credentials) exist."""

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
                "username": "bridge-acceptance-test",
                "email": f"bridge-acceptance-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "bridge-acceptance-test-org",
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
                "name": "bridge-acceptance-test-workspace",
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
                "project_name": "bridge-acceptance-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    connection_ids = []

    async def make_connection(
        *,
        integration_key: str,
        secret: str,
        delivery_url: str,
        capabilities: Optional[Dict[str, Any]] = None,
    ):
        # Written to both tables under the same id: the ingress candidate
        # lookup now reads channel_connections, but ChannelsService.create_agent
        # / create_space still check connection existence against the shared
        # gateway table (out of this wave's scope) -- see the migration notes.
        connection_id = uuid.uuid4()
        data = {
            "secret": secret,
            "delivery_url": delivery_url,
            "installation_id": integration_key,
        }
        if capabilities is not None:
            data["capabilities"] = capabilities
        async with engine.session() as session:
            session.add(
                ConnectionDBE(
                    id=connection_id,
                    project_id=project_id,
                    slug=f"bridge-{connection_id.hex[:8]}",
                    provider_key="bridge",
                    integration_key=integration_key,
                    created_by_id=user_id,
                    data=data,
                )
            )
            session.add(
                ChannelConnectionDBE(
                    id=connection_id,
                    project_id=project_id,
                    slug=f"bridge-channel-{connection_id.hex[:8]}",
                    channel="bridge",
                    external_key=_placeholder_external_key(integration_key),
                    created_by_id=user_id,
                    data=data,
                )
            )
            await session.commit()
        connection_ids.append(connection_id)
        return connection_id

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "make_connection": make_connection,
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
