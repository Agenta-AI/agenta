"""ChannelsOutboxWorker: fold, render, post, receipt. Driven directly, no
broker and no DB — an in-memory fake DAO plays ChannelsDAOInterface, and the
contract-suite fixture plays the adapter so this suite exercises the exact
same collaborator a real adapter is held to."""

from datetime import datetime, timezone
from typing import Dict, List
from uuid import UUID, uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelDeliveryState,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.channels.service import ChannelsService
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurn
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.channels.outbox import (
    ChannelsOutboxStreamWorker,
    ChannelsOutboxWorker,
)

from .contract.fakes import WellBehavedFakeAdapter


PROJECT_ID = uuid4()


class FakeChannelsDAO(ChannelsDAOInterface):
    """Only the surface the outbox worker actually reaches: outbox CRUD,
    fetch_space, query_threads. Every other abstract method raises — a call
    through one would be this test overreaching the worker's own paths."""

    def __init__(self):
        self.outbox: Dict[UUID, ChannelOutboxEvent] = {}
        self.spaces: Dict[UUID, ChannelSpace] = {}
        self.threads: Dict[UUID, ChannelThread] = {}
        self.connections: Dict[UUID, ChannelConnection] = {}

    def seed_connection(self, *, channel: str = "fake") -> ChannelConnection:
        connection = ChannelConnection(
            id=uuid4(),
            slug="fake-connection",
            channel=channel,
            external_key=uuid4(),
        )
        self.connections[connection.id] = connection
        return connection

    def seed_space(self, *, connection_id: UUID) -> ChannelSpace:
        space = ChannelSpace(
            id=uuid4(),
            connection_id=connection_id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator={"channel": "C1"}),
        )
        self.spaces[space.id] = space
        return space

    def seed_thread(self, *, space_id: UUID, session_id: str) -> ChannelThread:
        thread = ChannelThread(
            id=uuid4(),
            space_id=space_id,
            agent_id=uuid4(),
            session_id=session_id,
            data=ChannelThreadData(),
        )
        self.threads[thread.id] = thread
        return thread

    async def fetch_space(self, *, project_id, space_id):
        return self.spaces.get(space_id)

    async def query_threads(self, *, project_id, thread=None, windowing=None):
        rows = list(self.threads.values())
        if thread and thread.session_id is not None:
            rows = [r for r in rows if r.session_id == thread.session_id]
        return rows

    async def fetch_outbox_event_by_key(self, *, project_id, key):
        return self.outbox.get(key)

    async def record_outbox_event(self, *, project_id, event: ChannelOutboxEventCreate):
        existing = self.outbox.get(event.key)
        if existing is not None:
            return existing

        now = datetime.now(timezone.utc)
        row = ChannelOutboxEvent(
            id=uuid4(),
            created_at=now,
            updated_at=now,
            connection_id=event.connection_id,
            thread_id=event.thread_id,
            turn_id=event.turn_id,
            key=event.key,
            state=event.state,
            data=event.data,
        )
        self.outbox[event.key] = row
        return row

    async def transition_outbox_event(
        self, *, project_id, event_id, state, status=None, data=None
    ):
        for key, row in self.outbox.items():
            if row.id == event_id:
                updated = row.model_copy(
                    update={
                        "state": state,
                        "data": data if data is not None else row.data,
                        "updated_at": datetime.now(timezone.utc),
                    }
                )
                self.outbox[key] = updated
                return updated
        return None

    async def claim_outbox_events(self, *, project_id=None, limit=100):
        return [
            row
            for row in self.outbox.values()
            if row.state == ChannelDeliveryState.CREATED
        ][:limit]

    async def fetch_outbox_event(self, *, project_id, event_id):
        for row in self.outbox.values():
            if row.id == event_id:
                return row
        return None

    async def query_outbox_events(self, *, project_id, event=None, windowing=None):
        raise NotImplementedError

    # --- everything else: out of the outbox worker's reach, unimplemented -- #

    async def create_agent(self, **kwargs):
        raise NotImplementedError

    async def fetch_agent(self, **kwargs):
        raise NotImplementedError

    async def fetch_agent_by_slug(self, **kwargs):
        raise NotImplementedError

    async def fetch_default_agent(self, **kwargs):
        raise NotImplementedError

    async def edit_agent(self, **kwargs):
        raise NotImplementedError

    async def delete_agent(self, **kwargs):
        raise NotImplementedError

    async def query_agents(self, **kwargs):
        raise NotImplementedError

    async def create_connection(self, **kwargs):
        raise NotImplementedError

    async def fetch_connection(self, *, project_id, connection_id):
        return self.connections.get(connection_id)

    async def edit_connection(self, **kwargs):
        raise NotImplementedError

    async def archive_connection(self, **kwargs):
        raise NotImplementedError

    async def unarchive_connection(self, **kwargs):
        raise NotImplementedError

    async def delete_connection(self, **kwargs):
        raise NotImplementedError

    async def query_connections(self, **kwargs):
        raise NotImplementedError

    async def create_space(self, **kwargs):
        raise NotImplementedError

    async def fetch_space_by_key(self, **kwargs):
        raise NotImplementedError

    async def get_or_create_space(self, **kwargs):
        raise NotImplementedError

    async def edit_space(self, **kwargs):
        raise NotImplementedError

    async def delete_space(self, **kwargs):
        raise NotImplementedError

    async def query_spaces(self, **kwargs):
        raise NotImplementedError

    async def mark_space_backfilled(self, **kwargs):
        raise NotImplementedError

    async def attach_event_to_space(self, **kwargs):
        raise NotImplementedError  # inbound only; the outbox never resolves

    async def create_grant(self, **kwargs):
        raise NotImplementedError

    async def fetch_grant(self, **kwargs):
        raise NotImplementedError

    async def fetch_default_grant(self, **kwargs):
        raise NotImplementedError

    async def edit_grant(self, **kwargs):
        raise NotImplementedError

    async def delete_grant(self, **kwargs):
        raise NotImplementedError

    async def query_grants(self, **kwargs):
        raise NotImplementedError

    async def count_grants(self, **kwargs):
        raise NotImplementedError

    async def query_matching_grants(self, **kwargs):
        raise NotImplementedError

    async def create_thread(self, **kwargs):
        raise NotImplementedError

    async def fetch_current_thread(self, **kwargs):
        raise NotImplementedError

    async def close_thread(self, **kwargs):
        raise NotImplementedError

    async def set_pending_choice(self, *, project_id, thread_id, pending_choice):
        thread = self.threads.get(thread_id)
        if thread is None:
            return None
        updated = thread.model_copy(
            update={
                "data": thread.data.model_copy(
                    update={"pending_choice": pending_choice}
                )
            }
        )
        self.threads[thread_id] = updated
        return updated

    async def record_inbox_event(self, **kwargs):
        raise NotImplementedError

    async def record_inbox_events(self, **kwargs):
        raise NotImplementedError

    async def attach_space(self, **kwargs):
        raise NotImplementedError

    async def query_events_since(self, **kwargs):
        raise NotImplementedError

    async def query_inbox_events(self, **kwargs):
        raise NotImplementedError

    async def fetch_latest_trigger(self, **kwargs):
        raise NotImplementedError

    async def record_inbox_trigger(self, **kwargs):
        raise NotImplementedError

    async def transition_inbox_trigger(self, **kwargs):
        raise NotImplementedError

    async def query_inbox_triggers(self, **kwargs):
        raise NotImplementedError

    async def get_project_and_connection_by_external_key(self, **kwargs):
        raise NotImplementedError


class FakeTurnsDAO(SessionTurnsDAOInterface):
    def __init__(self):
        self.turns: Dict[str, SessionTurn] = {}

    def seed(self, *, session_id: str, turn_id: UUID, ended: bool) -> SessionTurn:
        turn = SessionTurn(
            id=uuid4(),
            session_id=session_id,
            turn_id=turn_id,
            stream_id=uuid4(),
            turn_index=0,
            harness_kind=HarnessKind.CLAUDE_CODE,
            start_time=datetime.now(timezone.utc),
            end_time=datetime.now(timezone.utc) if ended else None,
        )
        self.turns[session_id] = turn
        return turn

    async def append(self, **kwargs):
        raise NotImplementedError

    async def complete(self, **kwargs):
        raise NotImplementedError

    async def fetch_turn(self, *, project_id, turn_id):
        for turn in self.turns.values():
            if turn.turn_id == turn_id:
                return turn
        return None

    async def query_turns(self, **kwargs):
        raise NotImplementedError

    async def latest_turn(self, *, project_id, session_id):
        return self.turns.get(session_id)

    async def latest_turn_per_harness_kind(self, **kwargs):
        raise NotImplementedError

    async def delete_by_session_id(self, **kwargs):
        raise NotImplementedError


class FakeRecordsDAO(RecordsDAOInterface):
    def __init__(self):
        self.records: List[SessionRecord] = []

    def seed(self, *, session_id: str, turn_id: str, record_type: str, attributes):
        self.records.append(
            SessionRecord(
                record_id=uuid4(),
                session_id=session_id,
                project_id=PROJECT_ID,
                record_type=record_type,
                attributes=attributes,
                turn_id=turn_id,
            )
        )

    async def get_records(self, *, project_id, session_id):
        return [r for r in self.records if r.session_id == session_id]


@pytest.fixture
def channels_dao():
    return FakeChannelsDAO()


@pytest.fixture
def adapter():
    return WellBehavedFakeAdapter()


@pytest.fixture
def adapter_registry(adapter):
    return ChannelAdapterRegistry(adapters={"fake": adapter})


@pytest.fixture
def channels_service(channels_dao, adapter_registry):
    return ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=adapter_registry,
    )


@pytest.fixture
def turns_dao():
    return FakeTurnsDAO()


@pytest.fixture
def records_dao():
    return FakeRecordsDAO()


@pytest.fixture
def worker(channels_service, turns_dao, records_dao):
    return ChannelsOutboxWorker(
        channels_service=channels_service,
        turns_service=SessionTurnsService(turns_dao=turns_dao),
        records_service=RecordsService(records_dao),
    )


async def _seed_connection_and_thread(channels_dao, session_id):
    connection = channels_dao.seed_connection(channel="fake")
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(space_id=space.id, session_id=session_id)

    return connection, thread


@pytest.mark.asyncio
async def test_turn_started_produces_exactly_one_created_then_sent_row(
    worker, channels_dao
):
    session_id = "sess-1"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-1")

    assert len(channels_dao.outbox) == 1
    row = next(iter(channels_dao.outbox.values()))
    assert row.state == ChannelDeliveryState.SENT
    assert row.data.external_locator is not None


@pytest.mark.asyncio
async def test_turn_ended_edits_the_same_row_created_at_turn_started(
    worker, channels_dao, records_dao
):
    session_id = "sess-2"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-2")
    assert len(channels_dao.outbox) == 1
    started_row = next(iter(channels_dao.outbox.values()))
    started_id = started_row.id

    records_dao.seed(
        session_id=session_id,
        turn_id="turn-2",
        record_type="message",
        attributes={"text": "the final answer"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-2",
        session_id=session_id,
    )

    assert len(channels_dao.outbox) == 1  # edited in place, not a second row
    ended_row = next(iter(channels_dao.outbox.values()))
    assert ended_row.id == started_id


@pytest.mark.asyncio
async def test_redelivery_of_turn_ended_does_not_double_post(
    worker, channels_dao, records_dao, adapter
):
    session_id = "sess-3"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-3")
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-3",
        record_type="message",
        attributes={"text": "answer"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-3", session_id=session_id
    )
    first_locator = next(iter(channels_dao.outbox.values())).data.external_locator

    # redeliver the same turn-ended signal (a duplicate poll tick)
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-3", session_id=session_id
    )

    assert len(channels_dao.outbox) == 1
    second_locator = next(iter(channels_dao.outbox.values())).data.external_locator
    assert first_locator == second_locator  # edited, not re-posted to a new locator


@pytest.mark.asyncio
async def test_long_answer_splits_into_multiple_independently_editable_rows(
    worker, channels_dao, records_dao, adapter_registry
):
    session_id = "sess-4"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    # shrink max_chars via a capabilities override on this test's own adapter
    adapter = adapter_registry.get("fake")
    adapter._capabilities["rendering"]["text"]["max_chars"] = 10

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-4")
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-4",
        record_type="message",
        attributes={"text": "x" * 25},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-4", session_id=session_id
    )

    assert len(channels_dao.outbox) == 3
    keys = {row.key for row in channels_dao.outbox.values()}
    assert len(keys) == 3  # each item independently keyed and editable


@pytest.mark.asyncio
async def test_pending_interaction_renders_card_from_recorded_tool_call(
    worker, channels_dao, records_dao
):
    session_id = "sess-5"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-5")
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-5",
        record_type="interaction_request",
        attributes={
            "id": "int-1",
            "payload": {
                "toolCall": {"name": "delete_file", "arguments": {"path": "/x"}}
            },
        },
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-5",
        record_type="done",
        attributes={"stopReason": "paused"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-5", session_id=session_id
    )

    row = next(iter(channels_dao.outbox.values()))
    assert row.data.processed is not None
    content = row.data.processed["content"]
    assert any(part.get("type") == "card" for part in content)
    assert any(part.get("tool") == "delete_file" for part in content)


@pytest.mark.asyncio
async def test_pending_interaction_writes_the_thread_s_pending_choice(
    worker, channels_dao, records_dao
):
    """Written by the outbox at render time, on the thread -- not a
    side-effect of delivery."""

    session_id = "sess-choice-1"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-choice-1"
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-choice-1",
        record_type="interaction_request",
        attributes={"id": "int-1", "payload": {"toolCall": {"name": "delete_file"}}},
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-choice-1",
        record_type="done",
        attributes={"stopReason": "paused"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-choice-1",
        session_id=session_id,
    )

    stored = channels_dao.threads[thread.id]
    assert stored.data.pending_choice is not None
    tokens = {c.token for c in stored.data.pending_choice.choices}
    assert tokens == {"approve", "deny"}
    labels = {c.label for c in stored.data.pending_choice.choices}
    assert labels == {"Approve", "Deny"}


@pytest.mark.asyncio
async def test_a_second_rendered_choice_replaces_the_first_wholesale(
    worker, channels_dao, records_dao
):
    """Newest wins: the write is a wholesale replace, not an append -- which
    is the entire supersession mechanism."""

    session_id = "sess-choice-2"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    for turn_id in ("turn-choice-2a", "turn-choice-2b"):
        await worker.on_turn_started(
            project_id=PROJECT_ID, thread=thread, turn_id=turn_id
        )
        records_dao.seed(
            session_id=session_id,
            turn_id=turn_id,
            record_type="interaction_request",
            attributes={
                "id": "int-1",
                "payload": {"toolCall": {"name": "delete_file"}},
            },
        )
        records_dao.seed(
            session_id=session_id,
            turn_id=turn_id,
            record_type="done",
            attributes={"stopReason": "paused"},
        )
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id=turn_id,
            session_id=session_id,
        )

    stored = channels_dao.threads[thread.id]
    # exactly one pending choice ever exists on the row -- the second post
    # did not accumulate alongside the first.
    assert len(stored.data.pending_choice.choices) == 2


@pytest.mark.asyncio
async def test_capabilities_are_fetched_for_the_thread_s_own_connection(
    worker, channels_dao, channels_service
):
    """A per-connection capability override is only reachable if the
    connection travels with the fetch — not just the channel key."""

    from unittest.mock import AsyncMock

    session_id = "sess-6"
    connection, thread = await _seed_connection_and_thread(channels_dao, session_id)

    spy = AsyncMock(wraps=channels_service.fetch_capabilities)
    channels_service.fetch_capabilities = spy

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-6")

    spy.assert_awaited_once_with(channel=connection.channel, connection=connection)


@pytest.mark.asyncio
async def test_idempotency_key_differs_between_post_and_edit_but_is_stable_on_retry(
    worker, channels_dao, records_dao
):
    from oss.src.core.channels.utils import compose_idempotency_key

    session_id = "sess-6"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-6")
    row_after_post = next(iter(channels_dao.outbox.values()))
    post_key = compose_idempotency_key(
        key=row_after_post.key, updated_at=row_after_post.updated_at
    )

    records_dao.seed(
        session_id=session_id,
        turn_id="turn-6",
        record_type="message",
        attributes={"text": "answer"},
    )
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-6", session_id=session_id
    )
    row_after_edit = next(iter(channels_dao.outbox.values()))
    edit_key = compose_idempotency_key(
        key=row_after_edit.key, updated_at=row_after_edit.updated_at
    )

    assert post_key != edit_key  # the edit moved updated_at -> a new token

    # a retry of the SAME send (no state change) re-derives the same token
    retry_key = compose_idempotency_key(
        key=row_after_edit.key, updated_at=row_after_edit.updated_at
    )
    assert retry_key == edit_key


@pytest.mark.asyncio
async def test_handle_turn_event_routes_started_by_kind_alone(worker, channels_dao):
    """No `latest_turn` re-read: `kind` alone decides the branch, so a
    concurrent second turn on the same session can never be mistaken for
    this one."""

    session_id = "sess-7"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.handle_turn_event(
        project_id=PROJECT_ID,
        session_id=session_id,
        turn_id="turn-7",
        kind="turn_started",
    )

    assert len(channels_dao.outbox) == 1
    assert next(iter(channels_dao.outbox.values())).state == ChannelDeliveryState.SENT


@pytest.mark.asyncio
async def test_handle_turn_event_routes_ended_by_kind_alone(
    worker, channels_dao, records_dao
):
    session_id = "sess-8"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.handle_turn_event(
        project_id=PROJECT_ID,
        session_id=session_id,
        turn_id="turn-8",
        kind="turn_started",
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-8",
        record_type="message",
        attributes={"text": "the answer"},
    )

    await worker.handle_turn_event(
        project_id=PROJECT_ID,
        session_id=session_id,
        turn_id="turn-8",
        kind="turn_ended",
    )

    assert len(channels_dao.outbox) == 1  # edited in place, same as on_turn_ended
    row = next(iter(channels_dao.outbox.values()))
    content = row.data.processed["content"]
    assert any("the answer" in part.get("text", "") for part in content)


@pytest.mark.asyncio
async def test_handle_turn_event_with_no_channel_thread_is_a_silent_no_op(worker):
    """A session with no channel_threads row (an ordinary, non-channel
    session) must not raise — most turns are not addressed from a channel."""

    await worker.handle_turn_event(
        project_id=PROJECT_ID,
        session_id="sess-not-a-channel-thread",
        turn_id="turn-9",
        kind="turn_started",
    )


def _turn_event_payload(*, kind, project_id, session_id, turn_id):
    from orjson import dumps

    return dumps(
        {
            "kind": kind,
            "project_id": str(project_id),
            "session_id": session_id,
            "turn_id": turn_id,
        }
    )


class TestChannelsOutboxStreamWorker:
    """`process_batch`: deserialize, route by `kind`, ack — the
    `streams:sessions` consumer that replaces the poll."""

    @pytest.mark.asyncio
    async def test_process_batch_drives_the_outbox_from_the_events_own_kind(
        self, worker, channels_dao
    ):
        session_id = "sess-stream-1"
        _, thread = await _seed_connection_and_thread(channels_dao, session_id)

        stream_worker = ChannelsOutboxStreamWorker(
            outbox=worker,
            redis_client=None,
            stream_name="streams:sessions",
            consumer_group="worker-sessions-channels-outbox",
        )

        batch = [
            (
                b"1-0",
                {
                    b"data": _turn_event_payload(
                        kind="turn_started",
                        project_id=PROJECT_ID,
                        session_id=session_id,
                        turn_id="turn-stream-1",
                    )
                },
            )
        ]

        total, processed_ids = await stream_worker.process_batch(batch)

        assert total == 1
        assert processed_ids == [b"1-0"]
        assert len(channels_dao.outbox) == 1

    @pytest.mark.asyncio
    async def test_process_batch_acks_unparseable_messages_without_raising(
        self, worker
    ):
        stream_worker = ChannelsOutboxStreamWorker(
            outbox=worker,
            redis_client=None,
            stream_name="streams:sessions",
            consumer_group="worker-sessions-channels-outbox",
        )

        total, processed_ids = await stream_worker.process_batch(
            [(b"1-0", {b"data": b"not-json"})]
        )

        assert total == 1
        assert processed_ids == [b"1-0"]  # acked, not left to pile up in the PEL

    @pytest.mark.asyncio
    async def test_process_batch_leaves_a_handler_failure_unacked(self, worker):
        """A real failure is retried, unlike a malformed payload: the
        message stays pending rather than being acked away."""

        async def _raising_query_threads(*, project_id, thread=None, windowing=None):
            raise RuntimeError("db unavailable")

        worker.channels_service.channels_dao.query_threads = _raising_query_threads

        stream_worker = ChannelsOutboxStreamWorker(
            outbox=worker,
            redis_client=None,
            stream_name="streams:sessions",
            consumer_group="worker-sessions-channels-outbox",
        )

        batch = [
            (
                b"1-0",
                {
                    b"data": _turn_event_payload(
                        kind="turn_started",
                        project_id=PROJECT_ID,
                        session_id="sess-any",
                        turn_id="turn-x",
                    )
                },
            )
        ]

        total, processed_ids = await stream_worker.process_batch(batch)

        assert total == 0
        assert processed_ids == []
