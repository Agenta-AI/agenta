"""ChannelsOutboxWorker against real Postgres (channel_* + session_turns).

`RecordsService` is faked here because records live on the analytics engine
(a separate connection this fixture does not stand up); everything the
outbox worker actually owns — the outbox row lifecycle and the turns lookup
— goes through the real DAOs.
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelDeliveryState,
    ChannelInboundEvent,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThreadCreate,
    ChannelThreadData,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurnCreate
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.gateway.connections.dbes import ConnectionDBE
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.turns.dao import SessionTurnsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.tasks.asyncio.channels.outbox import ChannelsOutboxWorker


pytestmark = pytest.mark.integration


class _LocalFakeAdapter(ChannelAdapterInterface):
    """Self-contained in-memory adapter, local to this module so the
    integration suite does not import another package's unit-test internals
    across a folder boundary (unit/ and integration/ are collected
    separately by pytest.ini rootdirs, and a relative import across them
    fails collection — see `python -m pytest --collect-only` at commit
    time). Same declared shape as the contract suite's own default fixture
    (`tests/.../channels/contract/fakes.py`), independently written.
    """

    channel = "fake"

    def __init__(self):
        self._capabilities = ChannelCapabilities(
            channel="fake",
            rendering={
                "controls": {"update": True},
                "buttons": {"supported": True, "max": 5},
                "text": {"format": "markdown", "max_chars": 3000},
            },
        )
        self._messages: Dict[str, Dict[str, Any]] = {}
        self._next_id = 0

    async def fetch_capabilities(self) -> ChannelCapabilities:
        return self._capabilities

    async def verify_signature(self, *, headers: Dict[str, str], body: bytes) -> str:
        raise NotImplementedError

    async def parse_event(self, *, body: bytes) -> Optional[ChannelInboundEvent]:
        raise NotImplementedError

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        self._next_id += 1
        new_locator = {"message_id": str(self._next_id)}
        self._messages[new_locator["message_id"]] = content
        return new_locator

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        message_id = external_locator["message_id"]
        self._messages[message_id] = content
        return external_locator

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        raise NotImplementedError

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        raise NotImplementedError


class _FakeRecordsDAO(RecordsDAOInterface):
    """Records live on the analytics engine — faked here (see module docstring)."""

    def __init__(self):
        self.rows = []

    def seed(self, *, session_id, turn_id, record_type, attributes):
        self.rows.append(
            SessionRecord(
                record_id=uuid.uuid4(),
                session_id=session_id,
                project_id=uuid.uuid4(),
                record_type=record_type,
                attributes=attributes,
                turn_id=turn_id,
            )
        )

    async def get_records(self, *, project_id, session_id):
        return [r for r in self.rows if r.session_id == session_id]


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
async def outbox_scope():
    """A project, a connection, a channel_space, a channel_thread and a
    session_streams row — the minimum real graph on_turn_started/on_turn_ended
    read through."""

    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    connection_id = uuid.uuid4()
    session_id = f"sess-{uuid.uuid4().hex[:8]}"
    stream_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "channels-outbox-test",
                "email": f"channels-outbox-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {"id": organization_id, "name": "outbox-test-org", "owner_id": user_id},
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "outbox-test-workspace",
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
                "project_name": "outbox-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )

        session.add(
            ConnectionDBE(
                id=connection_id,
                project_id=project_id,
                slug=f"outbox-test-{connection_id.hex[:8]}",
                provider_key="fake",
                integration_key=f"T{connection_id.hex[:8]}",
                created_by_id=user_id,
            )
        )
        session.add(
            SessionStreamDBE(
                id=stream_id,
                project_id=project_id,
                session_id=session_id,
                name="outbox-test-stream",
            )
        )

        await session.commit()

    channels_dao = ChannelsDAO(engine=engine)

    space = await channels_dao.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"channel": "C1"}),
        ),
    )
    thread = await channels_dao.create_thread(
        project_id=project_id,
        user_id=user_id,
        thread=ChannelThreadCreate(
            space_id=space.id,
            agent_id=uuid.uuid4(),
            session_id=session_id,
            data=ChannelThreadData(),
        ),
    )

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "connection_id": connection_id,
        "session_id": session_id,
        "stream_id": stream_id,
        "thread": thread,
        "channels_dao": channels_dao,
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
            "session_turns",
            "session_streams",
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


def _worker(scope, records_dao):
    adapter = _LocalFakeAdapter()
    registry = ChannelAdapterRegistry(adapters={"fake": adapter})

    class _FakeConnectionsService:
        async def get_connection(self, *, project_id, connection_id):
            from oss.src.core.gateway.connections.dtos import Connection

            return Connection.model_construct(
                id=connection_id,
                slug="outbox-test",
                provider_key="fake",
                integration_key="fake",
            )

    channels_service = ChannelsService(
        channels_dao=scope["channels_dao"],
        adapter_registry=registry,
        connections_service=_FakeConnectionsService(),
    )
    turns_service = SessionTurnsService(turns_dao=SessionTurnsDAO(engine=None))
    records_service = RecordsService(records_dao)

    return ChannelsOutboxWorker(
        channels_service=channels_service,
        turns_service=turns_service,
        records_service=records_service,
    )


async def test_turn_started_writes_exactly_one_channel_outbox_row(outbox_scope):
    records_dao = _FakeRecordsDAO()
    worker = _worker(outbox_scope, records_dao)

    await worker.on_turn_started(
        project_id=outbox_scope["project_id"],
        thread=outbox_scope["thread"],
        turn_id="turn-int-1",
    )

    rows = await outbox_scope["channels_dao"].query_outbox_events(
        project_id=outbox_scope["project_id"]
    )
    assert len(rows) == 1
    assert rows[0].state == ChannelDeliveryState.SENT


async def test_turn_ended_edits_the_same_row_across_a_real_transition(outbox_scope):
    records_dao = _FakeRecordsDAO()
    worker = _worker(outbox_scope, records_dao)

    await worker.on_turn_started(
        project_id=outbox_scope["project_id"],
        thread=outbox_scope["thread"],
        turn_id="turn-int-2",
    )
    rows = await outbox_scope["channels_dao"].query_outbox_events(
        project_id=outbox_scope["project_id"]
    )
    started_id = rows[0].id

    records_dao.seed(
        session_id=outbox_scope["session_id"],
        turn_id="turn-int-2",
        record_type="message",
        attributes={"text": "the real answer"},
    )

    await worker.on_turn_ended(
        project_id=outbox_scope["project_id"],
        thread=outbox_scope["thread"],
        turn_id="turn-int-2",
        session_id=outbox_scope["session_id"],
    )

    rows = await outbox_scope["channels_dao"].query_outbox_events(
        project_id=outbox_scope["project_id"]
    )
    assert len(rows) == 1  # edited in place, not a second Postgres row
    assert rows[0].id == started_id


async def test_polling_finds_the_channel_thread_by_session_id(outbox_scope):
    """poll_turn's own thread lookup (query_threads by session_id) against a
    real channel_threads row, with a real session_turns row for the same
    session — the two indexed lookups this exercises."""

    turns_dao = SessionTurnsDAO(engine=None)
    await turns_dao.append(
        project_id=outbox_scope["project_id"],
        user_id=outbox_scope["user_id"],
        turn=SessionTurnCreate(
            session_id=outbox_scope["session_id"],
            turn_id=uuid.uuid4(),
            stream_id=outbox_scope["stream_id"],
            turn_index=0,
            harness_kind=HarnessKind.CLAUDE,
            start_time=datetime.now(timezone.utc),
        ),
    )

    records_dao = _FakeRecordsDAO()
    worker = _worker(outbox_scope, records_dao)

    await worker.poll_turn(
        project_id=outbox_scope["project_id"],
        session_id=outbox_scope["session_id"],
    )

    # end_time is still null -> this poll tick took the turn-started branch
    rows = await outbox_scope["channels_dao"].query_outbox_events(
        project_id=outbox_scope["project_id"]
    )
    assert len(rows) == 1
    assert rows[0].state == ChannelDeliveryState.SENT
