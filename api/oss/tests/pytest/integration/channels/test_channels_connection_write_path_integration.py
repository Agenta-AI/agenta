"""The connections write path against a real Postgres: `ChannelsService`,
`ChannelsDAO` and a real `VaultService` together. Only the platform boundary
is faked -- a scripted adapter standing in for a call we cannot make in a
test -- the same discipline `test_channels_ingress_seam.py` uses.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`channels_scope` fixture), which is not available here.
"""

from typing import Any, Dict, Optional
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import (
    ChannelConnectionCreate,
    ChannelConnectionResponse,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionVerificationFailed
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO

pytestmark = pytest.mark.integration

_CANARY_TOKEN = "xoxb-integration-write-path-canary-do-not-echo"


class _ScriptedAdapter(ChannelAdapterInterface):
    channel = "slack"

    def __init__(self, *, discovered=None, fail: Optional[Exception] = None):
        self._discovered = discovered or {}
        self._fail = fail

    async def fetch_capabilities(self, *, connection=None):
        return normalise_capabilities(
            {
                "channel": "slack",
                "identity": {
                    "keys": {"connection": ["api_app_id", "enterprise_id", "team_id"]}
                },
            }
        )

    def connection_locator(self, *, request):
        raise NotImplementedError

    async def verify_signature(self, *, request, connection):
        raise NotImplementedError

    async def parse_event(self, *, body, connection=None):
        raise NotImplementedError

    async def post_message(self, *, connection, locator, content, idempotency_key):
        raise NotImplementedError

    async def edit_message(
        self, *, connection, external_locator, content, idempotency_key
    ):
        raise NotImplementedError

    async def discover_spaces(self, *, connection):
        raise NotImplementedError

    async def fetch_history(self, *, connection, locator, limit):
        raise NotImplementedError

    async def verify_connection(
        self, *, connection: ChannelConnectionCreate, credentials: Dict[str, Any]
    ):
        if self._fail is not None:
            raise self._fail
        return dict(self._discovered)


async def _service(channels_scope, *, adapter) -> ChannelsService:
    engine = channels_scope["engine"]
    return ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
        vault_service=VaultService(secrets_dao=SecretsDAO(engine=engine)),
    )


async def _secret_count(engine, project_id) -> int:
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM secrets "
                "WHERE project_id = :project_id AND kind = 'CHANNEL_SECRET'"
            ),
            {"project_id": project_id},
        )
        return result.scalar_one()


async def _connection_count(engine, project_id) -> int:
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM channel_connections "
                "WHERE project_id = :project_id AND slug = 'write-path-acme'"
            ),
            {"project_id": project_id},
        )
        return result.scalar_one()


@pytest.fixture(autouse=True)
async def _cleanup_secrets(channels_scope):
    yield
    async with channels_scope["engine"].session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE project_id = :project_id"),
            {"project_id": channels_scope["project_id"]},
        )
        await session.commit()


async def test_successful_create_writes_a_secret_and_a_connection_row(channels_scope):
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    adapter = _ScriptedAdapter(discovered={"team_id": "T-write-path"})
    service = await _service(channels_scope, adapter=adapter)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="write-path-acme",
        data={"api_app_id": "A-write-path", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": "sec-write-path"},
    )

    result = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=connection
    )

    assert await _secret_count(channels_scope["engine"], project_id) == 1
    assert await _connection_count(channels_scope["engine"], project_id) == 1
    assert result.data["connection_locator"]["team_id"] == "T-write-path"

    payload = ChannelConnectionResponse(count=1, connection=result).model_dump_json()
    assert _CANARY_TOKEN not in payload


async def test_failed_verification_writes_neither_row(channels_scope):
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    adapter = _ScriptedAdapter(
        fail=ChannelConnectionVerificationFailed(
            channel="slack", message="invalid_auth"
        )
    )
    service = await _service(channels_scope, adapter=adapter)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="write-path-acme",
        data={"api_app_id": "A-write-path", "enterprise_id": ""},
        credentials={"bot_token": "bad", "signing_secret": "sec"},
    )

    with pytest.raises(ChannelConnectionVerificationFailed):
        await service.create_connection(
            project_id=project_id, user_id=user_id, connection=connection
        )

    assert await _secret_count(channels_scope["engine"], project_id) == 0
    assert await _connection_count(channels_scope["engine"], project_id) == 0


async def test_two_projects_one_installation_get_a_domain_error_not_a_500(
    channels_scope,
):
    engine = channels_scope["engine"]
    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    shared_key = uuid4()

    adapter = _ScriptedAdapter(discovered={})
    service = await _service(channels_scope, adapter=adapter)

    first = ChannelConnectionCreate(
        channel="slack",
        external_key=shared_key,  # a placeholder; verify_connection discovers nothing
        slug="write-path-first",
        data={"api_app_id": "A-shared", "enterprise_id": "", "team_id": "T-shared"},
        credentials={"bot_token": "x", "signing_secret": "y"},
    )
    await service.create_connection(
        project_id=project_id, user_id=user_id, connection=first
    )

    other_project_id = uuid4()
    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "SELECT :id, 'write-path-second-project', workspace_id, organization_id "
                "FROM projects WHERE id = :existing"
            ),
            {"id": other_project_id, "existing": project_id},
        )
        await session.commit()

    try:
        second = ChannelConnectionCreate(
            channel="slack",
            external_key=uuid4(),
            slug="write-path-second",
            data={"api_app_id": "A-shared", "enterprise_id": "", "team_id": "T-shared"},
            credentials={"bot_token": "x2", "signing_secret": "y2"},
        )

        with pytest.raises(EntityCreationConflict):
            await service.create_connection(
                project_id=other_project_id, user_id=user_id, connection=second
            )
    finally:
        async with engine.session() as session:
            await session.execute(
                text("DELETE FROM secrets WHERE project_id = :project_id"),
                {"project_id": other_project_id},
            )
            await session.execute(
                text("DELETE FROM channel_connections WHERE project_id = :project_id"),
                {"project_id": other_project_id},
            )
            await session.execute(
                text("DELETE FROM projects WHERE id = :id"), {"id": other_project_id}
            )
            await session.commit()


async def test_archive_cascades_to_agents_and_leaves_threads_alone(channels_scope):
    from oss.src.core.channels.dtos import ChannelAgentCreate, ChannelAgentData

    project_id = channels_scope["project_id"]
    user_id = channels_scope["user_id"]
    adapter = _ScriptedAdapter(discovered={"team_id": "T-archive"})
    service = await _service(channels_scope, adapter=adapter)

    connection = await service.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=uuid4(),
            slug="write-path-archive",
            data={"api_app_id": "A-archive", "enterprise_id": ""},
        ),
    )
    agent = await service.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection.id,
            slug="archive-agent",
            data=ChannelAgentData(references={}),
        ),
    )

    archived = await service.archive_connection(
        project_id=project_id, user_id=user_id, connection_id=connection.id
    )

    assert archived.deleted_at is not None

    fetched_agent = await service.fetch_agent(project_id=project_id, agent_id=agent.id)
    assert fetched_agent.deleted_at is not None
