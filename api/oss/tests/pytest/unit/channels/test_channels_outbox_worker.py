"""ChannelsOutboxWorker: fold, render, post, receipt. Driven directly, no
broker and no DB — an in-memory fake DAO plays ChannelsDAOInterface, and the
contract-suite fixture plays the adapter so this suite exercises the exact
same collaborator a real adapter is held to."""

from datetime import datetime, timezone
from typing import Dict, List
from uuid import UUID, uuid4

import asyncio

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
from oss.src.core.shared.dtos import Status
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

    def seed_thread(
        self, *, space_id: UUID, session_id: str, external_locator=None
    ) -> ChannelThread:
        thread = ChannelThread(
            id=uuid4(),
            space_id=space_id,
            agent_id=uuid4(),
            session_id=session_id,
            data=ChannelThreadData(external_locator=external_locator),
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
        self, *, project_id, event_id, state, status=None, data=None, claim_token=None
    ):
        for key, row in self.outbox.items():
            if row.id == event_id:
                if claim_token is not None and (
                    row.status is None
                    or row.status.code != "sending"
                    or row.status.message != claim_token
                ):
                    return None
                updated = row.model_copy(
                    update={
                        "state": state,
                        "status": status if status is not None else row.status,
                        "data": data if data is not None else row.data,
                        "updated_at": datetime.now(timezone.utc),
                    }
                )
                self.outbox[key] = updated
                return updated
        return None

    async def claim_outbox_delivery(
        self,
        *,
        project_id,
        event_id,
        content,
        claim_ttl_seconds,
        overwrite_final=True,
        delivery_key=None,
        include_held=False,
    ):
        """Same rule as the Postgres conditional UPDATE, in memory. Nothing
        awaits between the check and the write, so it is atomic here too."""
        for key, row in self.outbox.items():
            if row.id != event_id:
                continue
            if row.state == ChannelDeliveryState.HELD and not include_held:
                return None
            processed = (row.data.processed if row.data else None) or {}
            if (
                row.state == ChannelDeliveryState.SENT
                and processed.get("content") == content
            ):
                return None
            if (
                row.status is not None
                and row.status.code == "sending"
                and row.updated_at is not None
                and (datetime.now(timezone.utc) - row.updated_at).total_seconds()
                < claim_ttl_seconds
            ):
                return None
            if not overwrite_final and processed.get("final"):
                return None
            if (
                delivery_key is not None
                and row.status is not None
                and row.status.code == "delivery_uncertain"
                and row.status.type == delivery_key
            ):
                return None
            claimed = row.model_copy(
                update={
                    "status": Status(code="sending", message=str(uuid4())),
                    "updated_at": datetime.now(timezone.utc),
                }
            )
            self.outbox[key] = claimed
            return claimed
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

    async def edit_connection(self, *, project_id, user_id, connection):
        # enough for deactivate_connection: apply the flags an edit carries
        existing = self.connections.get(connection.id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={"flags": connection.flags or existing.flags}
        )
        self.connections[connection.id] = updated
        return updated

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

    async def set_space_opted_out(self, *, project_id, space_id, opted_out, event_id):
        """Same fence as the Postgres update: an older event never overrides
        a newer one (ids are time-ordered)."""
        space = self.spaces.get(space_id)
        if space is None:
            return None
        applied = getattr(self, "_consent_events", {})
        self._consent_events = applied
        if space_id in applied and str(applied[space_id]) >= str(event_id):
            return None
        applied[space_id] = event_id
        space.flags.is_opted_out = opted_out
        return space

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

    async def fetch_thread_awaiting_choice(self, **kwargs):
        raise NotImplementedError

    async def fetch_active_thread(self, **kwargs):
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

    async def query_session_ids_by_references(self, **kwargs):
        raise NotImplementedError

    async def latest_turn(self, *, project_id, session_id):
        return self.turns.get(session_id)

    async def latest_turn_per_harness_kind(self, **kwargs):
        raise NotImplementedError

    async def latest_turn_per_session(self, *, project_id, session_ids):
        return {
            session_id: self.turns[session_id]
            for session_id in session_ids
            if session_id in self.turns
        }

    async def delete_by_session_id(self, **kwargs):
        raise NotImplementedError


class FakeRecordsDAO(RecordsDAOInterface):
    def __init__(self):
        self.records: List[SessionRecord] = []

    def seed(
        self,
        *,
        session_id: str,
        turn_id: str,
        record_type: str,
        attributes,
        record_source: str = "agent",
    ):
        # every persisted record carries its author; the inbound user turn lands
        # in this same log, so a sourceless record is not a shape that exists
        self.records.append(
            SessionRecord(
                record_id=uuid4(),
                session_id=session_id,
                project_id=PROJECT_ID,
                record_type=record_type,
                attributes=attributes,
                turn_id=turn_id,
                record_source=record_source,
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


class _FakeInteractionsService:
    """Maps the fold's ACP token to the SessionInteraction row id the respond
    path answers by -- one open approval per turn in these tests."""

    def __init__(self, *, token="int-1", row_id="row-int-1", rows=None):
        self._token = token
        self._row_id = row_id
        self._rows = rows

    async def fetch_turn_interactions(self, *, project_id, session_id, turn_id):
        from types import SimpleNamespace

        if self._rows is not None:
            return list(self._rows)
        return [SimpleNamespace(id=self._row_id, token=self._token, status="pending")]


@pytest.fixture
def worker(channels_service, turns_dao, records_dao):
    return ChannelsOutboxWorker(
        channels_service=channels_service,
        turns_service=SessionTurnsService(turns_dao=turns_dao),
        records_service=RecordsService(records_dao),
        interactions_service=_FakeInteractionsService(),
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
async def test_the_answer_excludes_the_inbound_user_message(
    worker, channels_dao, records_dao
):
    """The user's turn is persisted into the same record log the answer folds
    from, and fold() labels every message record `assistant`. Only the agent's
    own records may reach the reply, or the bot repeats the user back."""

    session_id = "sess-echo"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    records_dao.seed(
        session_id=session_id,
        turn_id="turn-echo",
        record_type="message",
        attributes={"text": "what the user asked"},
        record_source="user",
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-echo",
        record_type="message",
        attributes={"text": "what the agent answered"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-echo",
        session_id=session_id,
    )

    posted = " ".join(
        part.get("text") or ""
        for row in channels_dao.outbox.values()
        for part in (row.data.processed or {}).get("content", [])
    )
    assert "what the agent answered" in posted
    assert "what the user asked" not in posted


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
        attributes={
            "id": "int-1",
            "payload": {"toolCall": {"name": "delete_file"}},
        },
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
    assert tokens == {"row-int-1:approve", "row-int-1:deny"}
    labels = {c.label for c in stored.data.pending_choice.choices}
    assert labels == {"Approve", "Deny"}
    # the parked interaction the answer must go to, so the click can resume it
    # the row id the sessions respond path answers by, resolved from the token
    assert stored.data.pending_choice.interaction_id == "row-int-1"


@pytest.mark.asyncio
async def test_card_without_a_pending_session_interaction_is_not_published(
    worker, channels_dao, records_dao
):
    session_id = "approval-no-pending-row"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    worker.interactions_service = _FakeInteractionsService(rows=[])
    records_dao.seed(
        session_id=session_id,
        turn_id="old-turn",
        record_type="interaction_request",
        attributes={"id": "old-token", "payload": {"toolCall": {"name": "test_tool"}}},
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="old-turn",
        record_type="done",
        attributes={"stopReason": "paused"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="old-turn",
        session_id=session_id,
    )

    assert channels_dao.threads[thread.id].data.pending_choice is None
    assert all(not row.data.external_locator for row in channels_dao.outbox.values())


@pytest.mark.asyncio
async def test_old_card_cannot_answer_a_new_interaction(
    worker, channels_dao, records_dao
):
    from oss.src.core.channels.service import resolve_pending_choice

    session_id = "approval-supersession"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    callbacks = []
    for token in ("old-request", "new-request"):
        row_id = str(uuid4())
        worker.interactions_service = _FakeInteractionsService(
            token=token, row_id=row_id
        )
        records_dao.seed(
            session_id=session_id,
            turn_id=token,
            record_type="interaction_request",
            attributes={"id": token, "payload": {"toolCall": {"name": "test_tool"}}},
        )
        records_dao.seed(
            session_id=session_id,
            turn_id=token,
            record_type="done",
            attributes={"stopReason": "paused"},
        )
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id=token,
            session_id=session_id,
        )
        row = list(channels_dao.outbox.values())[-1]
        callback = next(
            p["value"] for p in row.data.processed["content"] if p["type"] == "button"
        )
        assert callback == f"{row_id}:approve"
        assert len(callback.encode()) <= 64
        callbacks.append(callback)

    pending = channels_dao.threads[thread.id].data.pending_choice
    assert (
        resolve_pending_choice(
            pending_choice=pending, candidate=callbacks[0], allow_text=False
        )
        is None
    )
    assert (
        resolve_pending_choice(
            pending_choice=pending, candidate="approve", allow_text=False
        )
        is None
    )
    assert (
        resolve_pending_choice(
            pending_choice=pending, candidate=callbacks[1], allow_text=False
        )
        == callbacks[1]
    )
    assert resolve_pending_choice(pending_choice=pending, candidate="1") == callbacks[1]
    assert (
        resolve_pending_choice(pending_choice=pending, candidate="Approve")
        == callbacks[1]
    )


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


class _PostLocatorSpy(WellBehavedFakeAdapter):
    """Records the locator each post_message receives; delegates otherwise."""

    def __init__(self):
        super().__init__()
        self.post_locators: List[Dict] = []

    async def post_message(self, *, connection, locator, content, idempotency_key):
        self.post_locators.append(locator)
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
async def test_the_first_post_of_a_turn_targets_the_thread_s_locator():
    """No receipt exists before the first post, so its target can only come
    from the THREAD's locator. An empty locator here KeyError'd inside the
    Slack adapter (`locator["channel"]`) and the first answer on any thread
    was silently never delivered."""

    channels_dao = FakeChannelsDAO()
    spy = _PostLocatorSpy()
    service = ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"fake": spy}),
    )
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
    )
    connection = channels_dao.seed_connection(channel="fake")
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(
        space_id=space.id,
        session_id="s-locator",
        external_locator={"channel": "C1", "thread_ts": "42.1"},
    )

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-locator"
    )

    assert spy.post_locators == [{"channel": "C1", "thread_ts": "42.1"}]


class _LateCommitRecordsDAO(FakeRecordsDAO):
    """Answers the first `empty_reads` reads with nothing, then with whatever
    was seeded — the live race where the turn-ended event outran the final
    record commit (~150ms measured)."""

    def __init__(self, *, empty_reads: int):
        super().__init__()
        self._empty_reads = empty_reads
        self.reads = 0

    async def get_records(self, *, project_id, session_id):
        self.reads += 1
        if self.reads <= self._empty_reads:
            return []
        return await super().get_records(project_id=project_id, session_id=session_id)


def _worker_over(channels_dao, records_dao) -> ChannelsOutboxWorker:
    return ChannelsOutboxWorker(
        channels_service=ChannelsService(
            channels_dao=channels_dao,
            adapter_registry=ChannelAdapterRegistry(
                adapters={"fake": WellBehavedFakeAdapter()}
            ),
        ),
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records_dao),
    )


def _delivered_text(channels_dao) -> str:
    return " ".join(
        part.get("text") or ""
        for row in channels_dao.outbox.values()
        for part in (row.data.processed or {}).get("content", [])
    )


@pytest.mark.asyncio
async def test_an_empty_fold_is_re_read_before_it_is_rendered(monkeypatch):
    """The turn-ended event can arrive before the agent's last record is
    committed. Folding that early read yields an EMPTY answer, which rendered
    an empty Slack section (rejected as invalid_blocks) and orphaned the
    indicator on "Working…". The read is retried before anything renders."""

    monkeypatch.setattr(
        "oss.src.tasks.asyncio.channels.outbox._EMPTY_FOLD_BACKOFF_SECONDS", 0
    )

    channels_dao = FakeChannelsDAO()
    records_dao = _LateCommitRecordsDAO(empty_reads=1)
    worker = _worker_over(channels_dao, records_dao)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-race")

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-race"
    )
    records_dao.seed(
        session_id="sess-race",
        turn_id="turn-race",
        record_type="message",
        attributes={"text": "the answer that was still committing"},
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-race",
        session_id="sess-race",
    )

    assert records_dao.reads == 2  # the early read, then the one that won
    assert "the answer that was still committing" in _delivered_text(channels_dao)


@pytest.mark.asyncio
async def test_a_fold_still_empty_after_the_re_reads_tells_the_chat(
    monkeypatch, caplog
):
    """A blank bubble is worse than no bubble, and a "Thinking…" that never
    changes is no better: when the re-reads run out, the indicator is edited
    into a plain "the run failed" line and the worker fails loudly in the log."""

    monkeypatch.setattr(
        "oss.src.tasks.asyncio.channels.outbox._EMPTY_FOLD_BACKOFF_SECONDS", 0
    )

    channels_dao = FakeChannelsDAO()
    records_dao = _LateCommitRecordsDAO(empty_reads=99)  # nothing ever commits
    worker = _worker_over(channels_dao, records_dao)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-empty")

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-empty"
    )
    indicator = _delivered_text(channels_dao)
    assert indicator  # the indicator did post, and is what must survive

    with caplog.at_level("ERROR"):
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-empty",
            session_id="sess-empty",
        )

    assert records_dao.reads == 3  # bounded: one read plus two re-reads
    assert len(channels_dao.outbox) == 1
    from oss.src.core.channels.render.render import NO_ANSWER_TEXT

    assert _delivered_text(channels_dao) == NO_ANSWER_TEXT  # never blank
    assert any(
        "empty" in record.message and record.levelname == "ERROR"
        for record in caplog.records
    )


class _PlatformRejected(Exception):
    """A platform answer that refused the call, shaped like the adapters' own
    API errors: it carries the HTTP status, so the outbox knows nothing was
    posted."""

    def __init__(self, error: str, status_code: int = 200):
        self.status_code = status_code
        super().__init__(error)


class _RefusingAdapter(WellBehavedFakeAdapter):
    """The platform rejects every post, the way Slack answers `channel_not_found`."""

    async def post_message(self, *, connection, locator, content, idempotency_key):
        raise _PlatformRejected("channel_not_found")


@pytest.mark.asyncio
async def test_a_rejected_post_is_written_down_as_failed_with_the_reason():
    """The row said CREATED forever after a rejected post, indistinguishable
    from one the worker had not reached yet (F87)."""
    channels_dao = FakeChannelsDAO()
    service = ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"fake": _RefusingAdapter()}),
    )
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
    )
    connection = channels_dao.seed_connection(channel="fake")
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(
        space_id=space.id,
        session_id="s-failed",
        external_locator={"channel": "C1", "thread_ts": "42.1"},
    )

    with pytest.raises(_PlatformRejected):
        await worker.on_turn_started(
            project_id=PROJECT_ID, thread=thread, turn_id="turn-failed"
        )

    (row,) = channels_dao.outbox.values()
    assert row.state is ChannelDeliveryState.FAILED
    assert row.status is not None and row.status.code == "delivery_failed"
    assert "channel_not_found" in (row.status.message or "")


class _FlakyAdapter(WellBehavedFakeAdapter):
    """Rejects the first post, accepts the second, and records every token."""

    def __init__(self):
        super().__init__()
        self.tokens: List = []
        self.calls = 0

    async def post_message(self, *, connection, locator, content, idempotency_key):
        self.calls += 1
        self.tokens.append(idempotency_key)
        if self.calls == 1:
            raise _PlatformRejected("ratelimited", status_code=429)
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
async def test_a_redelivered_start_never_writes_the_indicator_over_a_failed_answer():
    """Item zero carries the indicator and then the answer. When the answer's
    edit fails after the indicator landed, the row is FAILED with a receipt;
    a redelivered turn-started must leave it alone, or it edits the message
    the platform may already show as the answer back to the indicator."""
    channels_dao = FakeChannelsDAO()
    adapter = _FlakyAdapter()
    adapter.calls = 1  # the indicator already went out; the next post succeeds
    service = ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"fake": adapter}),
    )
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
    )
    connection = channels_dao.seed_connection(channel="fake")
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(
        space_id=space.id,
        session_id="s-answer-failed",
        external_locator={"channel": "C1", "thread_ts": "42.1"},
    )
    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-af"
    )
    (row,) = channels_dao.outbox.values()
    assert row.state is ChannelDeliveryState.SENT
    assert row.data.external_locator  # the receipt
    # the answer edit failed later: the row is FAILED but keeps its receipt
    await channels_dao.transition_outbox_event(
        project_id=PROJECT_ID,
        event_id=row.id,
        state=ChannelDeliveryState.FAILED,
    )
    calls_before = adapter.calls

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-af"
    )

    (row,) = channels_dao.outbox.values()
    assert row.state is ChannelDeliveryState.FAILED
    assert adapter.calls == calls_before


async def test_a_failed_post_retries_with_the_same_token_and_ends_sent():
    """A retry of the same content reuses its idempotency token, so a post the
    platform accepted but whose reply timed out is never duplicated; the row
    that was FAILED ends SENT, and the failure it recorded is replaced."""
    channels_dao = FakeChannelsDAO()
    adapter = _FlakyAdapter()
    service = ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"fake": adapter}),
    )
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
    )
    connection = channels_dao.seed_connection(channel="fake")
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(
        space_id=space.id,
        session_id="s-retry",
        external_locator={"channel": "C1", "thread_ts": "42.1"},
    )

    with pytest.raises(_PlatformRejected):
        await worker.on_turn_started(
            project_id=PROJECT_ID, thread=thread, turn_id="turn-retry"
        )
    (row,) = channels_dao.outbox.values()
    assert row.state is ChannelDeliveryState.FAILED

    # the platform redelivers turn-started: the FAILED row is attempted again
    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-retry"
    )

    (row,) = channels_dao.outbox.values()
    assert row.state is ChannelDeliveryState.SENT
    assert row.status is not None and row.status.code == "sent"
    assert adapter.calls == 2
    assert adapter.tokens[0] == adapter.tokens[1]


class _NoEditPostCounter(WellBehavedFakeAdapter):
    """A no-edit channel (like Telegram): the answer posts a fresh message, so a
    duplicate turn_ended would post twice without the delivery idempotency guard."""

    def __init__(self):
        super().__init__()
        self._capabilities["rendering"]["controls"]["update"] = False
        self.post_count = 0

    async def post_message(self, *, connection, locator, content, idempotency_key):
        self.post_count += 1
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
async def test_no_edit_channel_does_not_duplicate_on_redelivered_turn_ended():
    channels_dao = FakeChannelsDAO()
    adapter = _NoEditPostCounter()
    service = ChannelsService(
        channels_dao=channels_dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"fake": adapter}),
    )
    records_dao = FakeRecordsDAO()
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records_dao),
        interactions_service=_FakeInteractionsService(),
    )
    session_id = "sess-noedit"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-x")
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-x",
        record_type="message",
        attributes={"text": "answer"},
    )
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-x", session_id=session_id
    )
    # A duplicate turn_ended (both publishers fire) must NOT post a second answer.
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-x", session_id=session_id
    )
    # indicator (1) + the answer (1); the duplicate is skipped, not a third post.
    assert adapter.post_count == 2


# --- progress: keep the chat alive while the turn runs ----------------------- #


class _ActivitySpy(WellBehavedFakeAdapter):
    def __init__(self):
        super().__init__()
        self.activity = 0

    async def signal_activity(self, *, connection, locator):
        self.activity += 1


def _progress_worker(channels_dao, records_dao, adapter) -> ChannelsOutboxWorker:
    return ChannelsOutboxWorker(
        channels_service=ChannelsService(
            channels_dao=channels_dao,
            adapter_registry=ChannelAdapterRegistry(adapters={"fake": adapter}),
        ),
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records_dao=records_dao),
        progress_interval_seconds=0.01,
    )


@pytest.mark.asyncio
async def test_progress_moves_the_dots_signals_activity_and_edits_the_answer_so_far():
    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _ActivitySpy()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-p")

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-p", session_id="sess-p"
    )
    await asyncio.sleep(0.05)
    # no text yet: the indicator's dots move, and the activity signal repeats
    assert _delivered_text(channels_dao).startswith("Thinking")
    assert adapter.activity >= 1

    records_dao.seed(
        session_id="sess-p",
        turn_id="turn-p",
        record_type="message",
        attributes={"text": "the answer so far"},
    )
    await asyncio.sleep(0.05)
    # the partial answer is edited into the same row, with a cursor
    assert len(channels_dao.outbox) == 1
    assert _delivered_text(channels_dao).startswith("the answer so far")
    assert _delivered_text(channels_dao).endswith("…")

    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-p", session_id="sess-p"
    )
    # turn_ended stops the loop and posts the final answer without the cursor
    assert "turn-p" not in worker._progress_tasks
    assert _delivered_text(channels_dao) == "the answer so far"
    activity_at_end = adapter.activity
    await asyncio.sleep(0.05)
    assert adapter.activity == activity_at_end  # nothing runs after the end


@pytest.mark.asyncio
async def test_progress_stops_by_itself_when_the_records_say_the_turn_is_done():
    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _ActivitySpy()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-d")

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-d", session_id="sess-d"
    )
    records_dao.seed(
        session_id="sess-d",
        turn_id="turn-d",
        record_type="done",
        attributes={"stopReason": "end_turn"},
    )
    await asyncio.sleep(0.05)
    assert "turn-d" not in worker._progress_tasks


@pytest.mark.asyncio
async def test_no_progress_loop_on_a_channel_that_cannot_edit():
    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _ActivitySpy()
    adapter._capabilities["rendering"]["controls"]["update"] = False
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-n")

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-n", session_id="sess-n"
    )
    assert "turn-n" not in worker._progress_tasks


# --- a revoked credential switches the connection off ----------------------- #


class _RevokedAdapter(WellBehavedFakeAdapter):
    async def post_message(self, *, connection, locator, content, idempotency_key):
        from oss.src.core.channels.types import ChannelCredentialRevoked

        raise ChannelCredentialRevoked(channel="fake", detail="Unauthorized")


@pytest.mark.asyncio
async def test_a_revoked_credential_marks_the_row_and_switches_the_connection_off():
    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    worker = _progress_worker(channels_dao, records_dao, _RevokedAdapter())
    connection, thread = await _seed_connection_and_thread(channels_dao, "sess-r")

    await worker.on_turn_started(project_id=PROJECT_ID, thread=thread, turn_id="turn-r")

    row = next(iter(channels_dao.outbox.values()))
    assert row.state is ChannelDeliveryState.FAILED
    assert row.status.code == "credential_revoked"
    stored = await channels_dao.fetch_connection(
        project_id=PROJECT_ID, connection_id=connection.id
    )
    assert stored.flags.is_active is False


def _interaction_row(row_id, token, status):
    from types import SimpleNamespace

    return SimpleNamespace(id=row_id, token=token, status=status)


def _resolver(rows):
    return ChannelsOutboxWorker(
        channels_service=None,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
        interactions_service=_FakeInteractionsService(rows=rows),
    )


async def test_the_resolver_answers_only_a_pending_interaction_with_the_cards_token():
    """A delayed park signal must not put a card back for an interaction that
    was answered elsewhere, and a card's token names one question only."""
    rows = [
        _interaction_row("row-old", "int-old", "resolved"),
        _interaction_row("row-open", "int-open", "pending"),
    ]
    worker = _resolver(rows)

    assert (
        await worker._resolve_interaction_row_id(
            project_id=PROJECT_ID, session_id="s", turn_id="t", token="int-open"
        )
        == "row-open"
    )
    # the answered one, even by its own token
    assert (
        await worker._resolve_interaction_row_id(
            project_id=PROJECT_ID, session_id="s", turn_id="t", token="int-old"
        )
        is None
    )
    # a token nothing open matches is another question, never the open one
    assert (
        await worker._resolve_interaction_row_id(
            project_id=PROJECT_ID, session_id="s", turn_id="t", token="int-other"
        )
        is None
    )


async def test_the_resolver_falls_back_to_the_sole_pending_row_without_a_token():
    rows = [
        _interaction_row("row-old", "int-old", "cancelled"),
        _interaction_row("row-open", "int-open", "pending"),
    ]
    worker = _resolver(rows)

    assert (
        await worker._resolve_interaction_row_id(
            project_id=PROJECT_ID, session_id="s", turn_id="t", token=None
        )
        == "row-open"
    )
    rows.append(_interaction_row("row-open-2", "int-open-2", "pending"))
    assert (
        await worker._resolve_interaction_row_id(
            project_id=PROJECT_ID, session_id="s", turn_id="t", token=None
        )
        is None
    )


@pytest.mark.asyncio
async def test_a_failed_start_notice_is_not_followed_by_a_second_failure_line(
    monkeypatch,
):
    """The dispatcher posted the failed-start notice on the turn's first
    item. A late turn-ended with nothing to show must not add "the run
    failed" on top: one failed trigger, one line in the chat."""

    monkeypatch.setattr(
        "oss.src.tasks.asyncio.channels.outbox._EMPTY_FOLD_BACKOFF_SECONDS", 0
    )
    from oss.src.core.channels.dtos import ChannelOutboxEventData
    from oss.src.core.channels.render.render import FAILED_START_TEXT
    from oss.src.core.channels.utils import compose_outbox_key

    channels_dao = FakeChannelsDAO()
    records_dao = _LateCommitRecordsDAO(empty_reads=99)
    worker = _worker_over(channels_dao, records_dao)
    connection, thread = await _seed_connection_and_thread(channels_dao, "sess-fs")

    content = [{"type": "text", "text": FAILED_START_TEXT, "format": "plain"}]
    row = await channels_dao.record_outbox_event(
        project_id=PROJECT_ID,
        event=ChannelOutboxEventCreate(
            connection_id=connection.id,
            thread_id=thread.id,
            turn_id="turn-fs",
            key=compose_outbox_key(thread_id=thread.id, turn_id="turn-fs", item=0),
            data=ChannelOutboxEventData(),
        ),
    )
    await channels_dao.transition_outbox_event(
        project_id=PROJECT_ID,
        event_id=row.id,
        state=ChannelDeliveryState.SENT,
        data=ChannelOutboxEventData(
            external_locator={"message_id": "m-1"},
            processed={"content": content},
        ),
    )

    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-fs"
    )
    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-fs",
        session_id="sess-fs",
    )

    assert len(channels_dao.outbox) == 1
    assert _delivered_text(channels_dao) == FAILED_START_TEXT


# --- delivery claim: two workers on one row post once ------------------------ #


class _SlowNoEditPostCounter(_NoEditPostCounter):
    """A no-edit channel whose post takes a moment, so two workers that both
    passed a read-then-post check would both be inside the post at once."""

    async def post_message(self, *, connection, locator, content, idempotency_key):
        await asyncio.sleep(0.05)
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


def _no_edit_worker(channels_dao, records_dao, adapter) -> ChannelsOutboxWorker:
    return ChannelsOutboxWorker(
        channels_service=ChannelsService(
            channels_dao=channels_dao,
            adapter_registry=ChannelAdapterRegistry(adapters={"fake": adapter}),
        ),
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records_dao),
        interactions_service=_FakeInteractionsService(),
    )


@pytest.mark.asyncio
async def test_two_concurrent_turn_ended_handlers_post_the_answer_once():
    """Two consumers each receive one of the two turn_ended copies and run at
    the same time. Before the claim, both read the row as not yet sent and
    both posted: a duplicate reply on Telegram."""

    channels_dao = FakeChannelsDAO()
    adapter = _SlowNoEditPostCounter()
    records_dao = FakeRecordsDAO()
    # Two worker instances share one DAO, as two containers share Postgres.
    first = _no_edit_worker(channels_dao, records_dao, adapter)
    second = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = "sess-race"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-race",
        record_type="message",
        attributes={"text": "answer"},
    )

    await asyncio.gather(
        *(
            worker.on_turn_ended(
                project_id=PROJECT_ID,
                thread=thread,
                turn_id="turn-race",
                session_id=session_id,
            )
            for worker in (first, second)
        )
    )

    assert adapter.post_count == 1
    row = next(iter(channels_dao.outbox.values()))
    assert row.state == ChannelDeliveryState.SENT
    assert row.status.code == "sent"  # the claim was released


@pytest.mark.asyncio
async def test_a_stale_claim_from_a_dead_worker_is_taken_over():
    """A worker that died mid-post leaves the row `sending`. Once the claim is
    older than its TTL the next delivery takes it over, so the reply is not
    lost."""

    channels_dao = FakeChannelsDAO()
    adapter = _NoEditPostCounter()
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = "sess-stale"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-stale",
        record_type="message",
        attributes={"text": "answer"},
    )
    row = await worker._get_or_create_item(
        project_id=PROJECT_ID,
        connection_id=thread.space_id,
        thread_id=thread.id,
        turn_id="turn-stale",
        item_index=0,
    )
    from datetime import timedelta

    channels_dao.outbox[row.key] = row.model_copy(
        update={
            "status": Status(code="sending"),
            "updated_at": datetime.now(timezone.utc) - timedelta(minutes=5),
        }
    )

    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-stale",
        session_id=session_id,
    )

    assert adapter.post_count == 1
    assert channels_dao.outbox[row.key].state == ChannelDeliveryState.SENT


@pytest.mark.asyncio
async def test_a_live_claim_that_never_releases_leaves_the_entry_for_redelivery(
    monkeypatch,
):
    """The holder is alive but slow: wait a bounded time, then raise so the
    stream entry stays pending and the reclaim pass retries it later, rather
    than skipping a delivery nobody may finish."""

    from oss.src.tasks.asyncio.channels import outbox as outbox_module

    monkeypatch.setattr(outbox_module, "_CLAIM_WAIT_SECONDS", 0.05)
    monkeypatch.setattr(outbox_module, "_CLAIM_POLL_SECONDS", 0.01)

    channels_dao = FakeChannelsDAO()
    adapter = _NoEditPostCounter()
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = "sess-busy"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-busy",
        record_type="message",
        attributes={"text": "answer"},
    )
    row = await worker._get_or_create_item(
        project_id=PROJECT_ID,
        connection_id=thread.space_id,
        thread_id=thread.id,
        turn_id="turn-busy",
        item_index=0,
    )
    channels_dao.outbox[row.key] = row.model_copy(
        update={
            "status": Status(code="sending"),
            "updated_at": datetime.now(timezone.utc),
        }
    )

    with pytest.raises(outbox_module.ChannelOutboxDeliveryBusy):
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-busy",
            session_id=session_id,
        )
    assert adapter.post_count == 0


class _SlowEditAdapter(WellBehavedFakeAdapter):
    """An edit channel whose edits take a moment and are recorded in order."""

    def __init__(self):
        super().__init__()
        self.edits: List[str] = []

    async def edit_message(
        self, *, connection, external_locator, content, idempotency_key
    ):
        await asyncio.sleep(0.05)
        self.edits.append(" ".join(part.get("text") or "" for part in content))
        return await super().edit_message(
            connection=connection,
            external_locator=external_locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
async def test_the_final_answer_waits_for_an_in_flight_edit_and_lands_last():
    """A progress edit is mid-flight on one worker when the final answer
    arrives on another. The final edit waits for the claim to be released
    instead of skipping, so the chat ends on the answer."""

    channels_dao = FakeChannelsDAO()
    adapter = _SlowEditAdapter()
    records_dao = FakeRecordsDAO()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    session_id = "sess-final-waits"
    connection, thread = await _seed_connection_and_thread(channels_dao, session_id)
    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-fw"
    )
    capabilities = await worker.channels_service.fetch_capabilities(
        channel=connection.channel, connection=connection
    )
    row = next(iter(channels_dao.outbox.values()))

    from oss.src.core.channels.render.render import render_progress

    records_dao.seed(
        session_id=session_id,
        turn_id="turn-fw",
        record_type="message",
        attributes={"text": "the final answer"},
    )
    progress = asyncio.create_task(
        worker._send(
            project_id=PROJECT_ID,
            event=row,
            connection=connection,
            capabilities=capabilities,
            item=render_progress(capabilities=capabilities, text="partial"),
            thread=thread,
            wait_for_claim=False,
        )
    )
    await asyncio.sleep(0.01)  # the progress edit now holds the claim
    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-fw",
        session_id=session_id,
    )
    await progress

    assert len(adapter.edits) == 2
    assert "final answer" in adapter.edits[-1]
    final_row = channels_dao.outbox[row.key]
    assert final_row.data.processed.get("final") is True


@pytest.mark.asyncio
async def test_a_late_progress_edit_never_overwrites_the_final_answer():
    """A progress tick that folded before the turn ended can reach the row
    after the answer was written. It must not replace the answer."""

    channels_dao = FakeChannelsDAO()
    adapter = _SlowEditAdapter()
    records_dao = FakeRecordsDAO()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    session_id = "sess-late-progress"
    connection, thread = await _seed_connection_and_thread(channels_dao, session_id)
    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-lp"
    )
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-lp",
        record_type="message",
        attributes={"text": "the final answer"},
    )
    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-lp",
        session_id=session_id,
    )
    edits_after_final = list(adapter.edits)

    from oss.src.core.channels.render.render import render_progress

    capabilities = await worker.channels_service.fetch_capabilities(
        channel=connection.channel, connection=connection
    )
    row = next(iter(channels_dao.outbox.values()))
    await worker._send(
        project_id=PROJECT_ID,
        event=row,
        connection=connection,
        capabilities=capabilities,
        item=render_progress(capabilities=capabilities, text="stale partial"),
        thread=thread,
        wait_for_claim=False,
    )

    assert adapter.edits == edits_after_final
    assert "final answer" in _delivered_text(channels_dao)


# --- stream redelivery -------------------------------------------------------- #


class TestChannelsOutboxRedelivery:
    def _stream_worker(self, worker):
        return ChannelsOutboxStreamWorker(
            outbox=worker,
            redis_client=None,
            stream_name="streams:sessions",
            consumer_group="worker-sessions-channels-outbox",
        )

    def test_the_consumer_reclaims_pending_entries_with_a_bounded_budget(self, worker):
        stream_worker = self._stream_worker(worker)

        assert stream_worker.reclaim_pending is True
        assert stream_worker.reclaim_min_idle_ms == 30_000
        assert stream_worker.max_deliveries == 5
        # Asked only for an entry over its delivery count. The bound is the
        # entry's age: a fresh entry keeps retrying, an old one is dropped.
        import time as time_module

        fresh_id = f"{int(time_module.time() * 1000) - 60_000}-0".encode()
        assert stream_worker.is_permanent_failure(fresh_id, {b"data": b"{}"}) is False
        assert stream_worker.is_permanent_failure(b"1-0", {b"data": b"{}"}) is True

    @pytest.mark.asyncio
    async def test_a_failed_post_is_redelivered_and_the_retry_sends_it(
        self, channels_dao, records_dao
    ):
        adapter = _FlakyAdapter()
        worker = _progress_worker(channels_dao, records_dao, adapter)
        stream_worker = self._stream_worker(worker)
        session_id = "sess-redeliver"
        _, _thread = await _seed_connection_and_thread(channels_dao, session_id)
        batch = [
            (
                b"1-0",
                {
                    b"data": _turn_event_payload(
                        kind="turn_started",
                        project_id=PROJECT_ID,
                        session_id=session_id,
                        turn_id="turn-rd",
                    )
                },
            )
        ]

        _, first = await stream_worker.process_batch(batch)
        assert first == []  # left pending
        row = next(iter(channels_dao.outbox.values()))
        assert row.state == ChannelDeliveryState.FAILED

        # the reclaim pass hands the same entry back
        _, second = await stream_worker.process_batch(batch)
        assert second == [b"1-0"]
        row = next(iter(channels_dao.outbox.values()))
        assert row.state == ChannelDeliveryState.SENT
        for task in list(worker._progress_tasks):
            await worker.stop_progress(task)

    @pytest.mark.asyncio
    async def test_a_redelivered_entry_whose_row_already_went_out_posts_nothing(
        self, channels_dao, records_dao
    ):
        adapter = _NoEditPostCounter()
        worker = _no_edit_worker(channels_dao, records_dao, adapter)
        stream_worker = self._stream_worker(worker)
        session_id = "sess-redelivered-sent"
        await _seed_connection_and_thread(channels_dao, session_id)
        records_dao.seed(
            session_id=session_id,
            turn_id="turn-rs",
            record_type="message",
            attributes={"text": "answer"},
        )
        batch = [
            (
                b"1-0",
                {
                    b"data": _turn_event_payload(
                        kind="turn_ended",
                        project_id=PROJECT_ID,
                        session_id=session_id,
                        turn_id="turn-rs",
                    )
                },
            )
        ]

        await stream_worker.process_batch(batch)
        _, again = await stream_worker.process_batch(batch)

        assert again == [b"1-0"]
        assert adapter.post_count == 1

    @pytest.mark.asyncio
    async def test_a_thread_whose_space_is_gone_is_acked_not_retried(
        self, channels_dao, records_dao
    ):
        worker = _no_edit_worker(channels_dao, records_dao, _NoEditPostCounter())
        stream_worker = self._stream_worker(worker)
        session_id = "sess-no-space"
        _, thread = await _seed_connection_and_thread(channels_dao, session_id)
        channels_dao.spaces.pop(thread.space_id)
        batch = [
            (
                b"1-0",
                {
                    b"data": _turn_event_payload(
                        kind="turn_ended",
                        project_id=PROJECT_ID,
                        session_id=session_id,
                        turn_id="turn-ns",
                    )
                },
            )
        ]

        _, processed = await stream_worker.process_batch(batch)

        assert processed == [b"1-0"]

    @pytest.mark.asyncio
    async def test_a_stale_reclaimed_entry_is_dropped_not_replayed(
        self, worker, monkeypatch
    ):
        """Turning the reclaim pass on inherits whatever an earlier deploy left
        pending. Found live: entries fifteen days old were redelivered, and a
        turn_started among them would post a "Thinking…" nobody resolves.
        Anything past the retry window is acknowledged and logged instead."""

        import time as time_module

        from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

        now_ms = int(time_module.time() * 1000)
        fresh_id = f"{now_ms - 60_000}-0".encode()
        stale_id = f"{now_ms - 15 * 24 * 3600 * 1000}-0".encode()
        payload = {
            b"data": _turn_event_payload(
                kind="turn_started",
                project_id=PROJECT_ID,
                session_id="sess-any",
                turn_id="turn-old",
            )
        }

        async def _reclaimed(self):
            return [(stale_id, payload), (fresh_id, payload)]

        monkeypatch.setattr(StreamConsumer, "reclaim_batch", _reclaimed)
        stream_worker = self._stream_worker(worker)
        acked: List[bytes] = []

        async def _ack(message_ids):
            acked.extend(message_ids)

        stream_worker.ack_and_delete = _ack

        batch = await stream_worker.reclaim_batch()

        assert [msg_id for msg_id, _ in batch] == [fresh_id]
        assert acked == [stale_id]
        assert stream_worker.dropped_messages == 1


# --- review follow-ups: final ordering, busy progress ticks, fencing -------- #


@pytest.mark.asyncio
async def test_a_late_no_answer_notice_never_replaces_a_sent_answer():
    """Two turn_ended handlers can fold different snapshots: one sees the
    answer, the other (reading before the last record committed) sees none.
    Whichever finishes last must not replace the answer with "no answer"."""

    channels_dao = FakeChannelsDAO()
    adapter = _SlowEditAdapter()
    records_dao = FakeRecordsDAO()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    session_id = "sess-no-answer-late"
    connection, thread = await _seed_connection_and_thread(channels_dao, session_id)
    records_dao.seed(
        session_id=session_id,
        turn_id="turn-nal",
        record_type="message",
        attributes={"text": "the real answer"},
    )
    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-nal",
        session_id=session_id,
    )
    row = next(iter(channels_dao.outbox.values()))
    capabilities = await worker.channels_service.fetch_capabilities(
        channel=connection.channel, connection=connection
    )

    from oss.src.core.channels.render.render import render_no_answer

    delivered = await worker._send(
        project_id=PROJECT_ID,
        event=row,
        connection=connection,
        capabilities=capabilities,
        item=render_no_answer(capabilities=capabilities),
        thread=thread,
        final=True,
        overwrite_final=False,
    )

    assert delivered is False
    assert _delivered_text(channels_dao) == "the real answer"


@pytest.mark.asyncio
async def test_a_progress_tick_that_finds_the_row_busy_retries_the_same_text():
    """A tick that skipped a busy row must not count its text as shown, or
    later ticks with the same text skip it too and it never appears."""

    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _ActivitySpy()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-busy-tick")

    await worker.on_turn_started(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-bt",
        session_id="sess-busy-tick",
    )
    key, row = next(iter(channels_dao.outbox.items()))
    sent_status = row.status
    # another worker holds the row while the partial answer lands
    channels_dao.outbox[key] = row.model_copy(
        update={
            "status": Status(code="sending", message="other-worker"),
            "updated_at": datetime.now(timezone.utc),
        }
    )
    records_dao.seed(
        session_id="sess-busy-tick",
        turn_id="turn-bt",
        record_type="message",
        attributes={"text": "the answer so far"},
    )
    await asyncio.sleep(0.05)
    assert not _delivered_text(channels_dao).startswith("the answer so far")

    # the other worker finishes; the same text must still reach the chat
    channels_dao.outbox[key] = channels_dao.outbox[key].model_copy(
        update={"status": sent_status}
    )
    await asyncio.sleep(0.05)
    await worker.stop_progress("turn-bt")

    assert _delivered_text(channels_dao).startswith("the answer so far")


# --- second review: cancel mid-post, unknown outcomes, fencing -------------- #


class _GatedNoEditAdapter(_NoEditPostCounter):
    """A no-edit channel whose post blocks until the test opens the gate, so
    the test can act while a post is in flight."""

    def __init__(self):
        super().__init__()
        self.in_post = asyncio.Event()
        self.gate = asyncio.Event()

    async def post_message(self, *, connection, locator, content, idempotency_key):
        self.in_post.set()
        await self.gate.wait()
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


def _seed_answer(records_dao, session_id, turn_id, text="answer"):
    records_dao.seed(
        session_id=session_id,
        turn_id=turn_id,
        record_type="message",
        attributes={"text": text},
    )


@pytest.mark.asyncio
async def test_a_cancel_mid_post_still_writes_the_receipt_so_nobody_reposts():
    """SIGTERM lands while the platform call is in flight. The post finishes
    and its SENT write lands before the cancel propagates; before, the row
    stayed `sending` and the next worker posted again once the lease ran out."""

    channels_dao = FakeChannelsDAO()
    adapter = _GatedNoEditAdapter()
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = "sess-cancel"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    _seed_answer(records_dao, session_id, "turn-cancel")

    task = asyncio.create_task(
        worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-cancel",
            session_id=session_id,
        )
    )
    await adapter.in_post.wait()
    task.cancel()
    await asyncio.sleep(0)
    adapter.gate.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    row = next(iter(channels_dao.outbox.values()))
    assert row.state == ChannelDeliveryState.SENT
    assert row.status.code == "sent"

    # the other copy of turn_ended, on another worker, finds it sent
    await _no_edit_worker(channels_dao, records_dao, adapter).on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-cancel",
        session_id=session_id,
    )
    assert adapter.post_count == 1


class _GatedEditAdapter(WellBehavedFakeAdapter):
    def __init__(self):
        super().__init__()
        self.in_edit = asyncio.Event()
        self.gate = asyncio.Event()
        self.edits: List[str] = []

    async def edit_message(
        self, *, connection, external_locator, content, idempotency_key
    ):
        self.in_edit.set()
        await self.gate.wait()
        self.edits.append(" ".join(part.get("text") or "" for part in content))
        return await super().edit_message(
            connection=connection,
            external_locator=external_locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
async def test_stopping_progress_mid_edit_leaves_the_row_released_not_claimed():
    """stop_progress cancels the loop while an edit is in flight. The edit and
    its receipt write finish first, so the row is not left `sending` for the
    final answer to wait out."""

    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _GatedEditAdapter()
    adapter.gate.set()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-stop-mid")
    await worker.on_turn_started(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-sm",
        session_id="sess-stop-mid",
    )
    adapter.gate.clear()
    adapter.in_edit.clear()
    _seed_answer(records_dao, "sess-stop-mid", "turn-sm", "partial")
    await adapter.in_edit.wait()

    stopping = asyncio.create_task(worker.stop_progress("turn-sm"))
    await asyncio.sleep(0.01)
    adapter.gate.set()
    await stopping

    row = next(iter(channels_dao.outbox.values()))
    assert row.status.code == "sent"
    assert adapter.edits and adapter.edits[-1].startswith("partial")


class _TimingOutPostAdapter(_NoEditPostCounter):
    def __init__(self, exc):
        super().__init__()
        self.exc = exc

    async def post_message(self, *, connection, locator, content, idempotency_key):
        self.post_count += 1
        raise self.exc


@pytest.mark.asyncio
async def test_a_post_with_an_unknown_outcome_is_recorded_and_never_retried():
    """A read timeout: the request went out and no answer came back. The post
    may be in the chat, and Slack and Telegram take no idempotency key, so a
    retry could show it twice. The row records it; nothing re-posts it."""

    import httpx

    channels_dao = FakeChannelsDAO()
    adapter = _TimingOutPostAdapter(httpx.ReadTimeout("read timed out"))
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    stream_worker = ChannelsOutboxStreamWorker(
        outbox=worker,
        redis_client=None,
        stream_name="streams:sessions",
        consumer_group="worker-sessions-channels-outbox",
    )
    session_id = "sess-unknown"
    await _seed_connection_and_thread(channels_dao, session_id)
    _seed_answer(records_dao, session_id, "turn-unknown")
    batch = [
        (
            b"1-0",
            {
                b"data": _turn_event_payload(
                    kind="turn_ended",
                    project_id=PROJECT_ID,
                    session_id=session_id,
                    turn_id="turn-unknown",
                )
            },
        )
    ]

    _, first = await stream_worker.process_batch(batch)
    # both the redelivery and the second turn_ended copy
    _, second = await stream_worker.process_batch(batch)

    assert first == [b"1-0"]  # acknowledged: not left for a retry
    assert second == [b"1-0"]
    assert adapter.post_count == 1
    row = next(iter(channels_dao.outbox.values()))
    assert row.state == ChannelDeliveryState.FAILED
    assert row.status.code == "delivery_uncertain"


@pytest.mark.asyncio
async def test_a_post_that_never_reached_the_platform_is_retried():
    """A connect error: the request never left, so a retry cannot duplicate."""

    import httpx

    channels_dao = FakeChannelsDAO()
    adapter = _TimingOutPostAdapter(httpx.ConnectError("connection refused"))
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = "sess-connect"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    _seed_answer(records_dao, session_id, "turn-connect")

    with pytest.raises(httpx.ConnectError):
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-connect",
            session_id=session_id,
        )
    with pytest.raises(httpx.ConnectError):
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-connect",
            session_id=session_id,
        )

    assert adapter.post_count == 2
    row = next(iter(channels_dao.outbox.values()))
    assert row.status.code == "delivery_failed"


class _TakenOverMidSend(WellBehavedFakeAdapter):
    """While this worker's post is in flight, another worker takes the row
    over (the lease ran out): the row now carries the other worker's claim."""

    def __init__(self, channels_dao, *, fail: bool = False):
        super().__init__()
        self._capabilities["rendering"]["controls"]["update"] = False
        self.channels_dao = channels_dao
        self.fail = fail

    async def post_message(self, *, connection, locator, content, idempotency_key):
        for key, row in list(self.channels_dao.outbox.items()):
            self.channels_dao.outbox[key] = row.model_copy(
                update={"status": Status(code="sending", message="other-worker")}
            )
        if self.fail:
            raise _PlatformRejected("channel_not_found")
        return await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True], ids=["sent-write", "failed-write"])
async def test_a_taken_over_worker_cannot_write_over_the_new_holder(fail):
    channels_dao = FakeChannelsDAO()
    adapter = _TakenOverMidSend(channels_dao, fail=fail)
    records_dao = FakeRecordsDAO()
    worker = _no_edit_worker(channels_dao, records_dao, adapter)
    session_id = f"sess-takeover-{fail}"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    _seed_answer(records_dao, session_id, "turn-to")

    try:
        await worker.on_turn_ended(
            project_id=PROJECT_ID,
            thread=thread,
            turn_id="turn-to",
            session_id=session_id,
        )
    except _PlatformRejected:
        pass

    row = next(iter(channels_dao.outbox.values()))
    assert row.status.code == "sending"
    assert row.status.message == "other-worker"
    assert row.state == ChannelDeliveryState.CREATED


@pytest.mark.asyncio
async def test_a_late_empty_turn_ended_never_replaces_the_sent_answer(monkeypatch):
    """Through the caller: the second turn_ended copy folds nothing (it read
    before the last record committed, or the records are gone) after the
    first already sent the answer. on_turn_ended must leave the answer."""

    from oss.src.tasks.asyncio.channels import outbox as outbox_module

    monkeypatch.setattr(outbox_module, "_EMPTY_FOLD_ATTEMPTS", 1)

    channels_dao = FakeChannelsDAO()
    adapter = _SlowEditAdapter()
    records_dao = FakeRecordsDAO()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    session_id = "sess-late-empty"
    _, thread = await _seed_connection_and_thread(channels_dao, session_id)
    _seed_answer(records_dao, session_id, "turn-le", "the real answer")
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-le", session_id=session_id
    )
    assert _delivered_text(channels_dao) == "the real answer"

    records_dao.records.clear()
    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-le", session_id=session_id
    )

    assert _delivered_text(channels_dao) == "the real answer"


# --- Telegram: an identical re-edit is a success (#7113) --------------------- #


def _telegram_worker(channels_dao, records_dao, handler):
    import httpx

    from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter

    adapter = TelegramAdapter(
        http_client=httpx.AsyncClient(
            base_url="https://api.telegram.org",
            transport=httpx.MockTransport(handler),
        )
    )
    return ChannelsOutboxWorker(
        channels_service=ChannelsService(
            channels_dao=channels_dao,
            adapter_registry=ChannelAdapterRegistry(adapters={"telegram": adapter}),
        ),
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records_dao),
    )


@pytest.mark.asyncio
async def test_telegram_not_modified_on_one_chunk_marks_it_sent_and_posts_the_rest():
    import json as json_module

    import httpx

    calls: List[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        calls.append(method)
        if method == "editMessageText":
            return httpx.Response(
                400,
                json={
                    "ok": False,
                    "error_code": 400,
                    "description": "Bad Request: message is not modified: "
                    "specified new message content and reply markup are "
                    "exactly the same as a current content and reply markup "
                    "of the message",
                },
            )
        payload = json_module.loads(request.content.decode() or "{}")
        return httpx.Response(
            200,
            json={
                "ok": True,
                "result": {
                    "message_id": 100 + len(calls),
                    "chat": {"id": payload.get("chat_id")},
                },
            },
        )

    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    worker = _telegram_worker(channels_dao, records_dao, handler)
    connection = ChannelConnection(
        id=uuid4(),
        slug="telegram-connection",
        channel="telegram",
        external_key=uuid4(),
        data={"bot_token": "123:abc"},
    )
    channels_dao.connections[connection.id] = connection
    space = channels_dao.seed_space(connection_id=connection.id)
    thread = channels_dao.seed_thread(
        space_id=space.id,
        session_id="sess-tg",
        external_locator={"chat_id": 999},
    )
    # The first chunk already shows in the chat (its earlier edit landed but
    # the row never recorded it), so Telegram answers "not modified".
    row = await worker._get_or_create_item(
        project_id=PROJECT_ID,
        connection_id=connection.id,
        thread_id=thread.id,
        turn_id="turn-tg",
        item_index=0,
    )
    channels_dao.outbox[row.key] = row.model_copy(
        update={
            "state": ChannelDeliveryState.FAILED,
            "data": row.data.model_copy(
                update={"external_locator": {"chat_id": 999, "message_id": 1}}
            ),
        }
    )
    _seed_answer(records_dao, "sess-tg", "turn-tg", "word " * 2000)

    await worker.on_turn_ended(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-tg", session_id="sess-tg"
    )

    rows = list(channels_dao.outbox.values())
    assert len(rows) >= 2
    assert all(r.state == ChannelDeliveryState.SENT for r in rows)
    assert calls[0] == "editMessageText"
    assert calls.count("sendMessage") == len(rows) - 1


class _UncertainIndicatorAdapter(_ActivitySpy):
    """The indicator post times out after sending: it may be in the chat."""

    def __init__(self):
        super().__init__()
        self.posts = 0

    async def post_message(self, *, connection, locator, content, idempotency_key):
        import httpx

        self.posts += 1
        raise httpx.ReadTimeout("read timed out")


@pytest.mark.asyncio
async def test_progress_never_posts_a_second_bubble_after_an_uncertain_indicator():
    channels_dao = FakeChannelsDAO()
    records_dao = FakeRecordsDAO()
    adapter = _UncertainIndicatorAdapter()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    _, thread = await _seed_connection_and_thread(channels_dao, "sess-uncertain-ind")

    await worker.on_turn_started(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id="turn-ui",
        session_id="sess-uncertain-ind",
    )
    _seed_answer(records_dao, "sess-uncertain-ind", "turn-ui", "partial")
    await asyncio.sleep(0.05)
    await worker.stop_progress("turn-ui")

    assert adapter.posts == 1  # the indicator only; no tick posted a new message


class _GatedClaimDAO(FakeChannelsDAO):
    """Commits the claim, then holds the call open until the test opens the
    gate: a cancel lands after the row is claimed, before the caller knows."""

    def __init__(self):
        super().__init__()
        self.in_claim = asyncio.Event()
        self.gate = asyncio.Event()
        self.hold = False

    async def claim_outbox_delivery(self, **kwargs):
        claimed = await super().claim_outbox_delivery(**kwargs)
        if self.hold:
            self.in_claim.set()
            await self.gate.wait()
        return claimed


@pytest.mark.asyncio
async def test_a_cancel_during_the_claim_never_leaves_the_row_claimed():
    channels_dao = _GatedClaimDAO()
    records_dao = FakeRecordsDAO()
    adapter = WellBehavedFakeAdapter()
    worker = _progress_worker(channels_dao, records_dao, adapter)
    connection, thread = await _seed_connection_and_thread(channels_dao, "sess-cc")
    await worker.on_turn_started(
        project_id=PROJECT_ID, thread=thread, turn_id="turn-cc", session_id="sess-cc"
    )
    await worker.stop_progress("turn-cc")
    capabilities = await worker.channels_service.fetch_capabilities(
        channel=connection.channel, connection=connection
    )
    row = next(iter(channels_dao.outbox.values()))

    from oss.src.core.channels.render.render import render_progress

    channels_dao.hold = True
    task = asyncio.create_task(
        worker._send(
            project_id=PROJECT_ID,
            event=row,
            connection=connection,
            capabilities=capabilities,
            item=render_progress(capabilities=capabilities, text="partial"),
            thread=thread,
            wait_for_claim=False,
        )
    )
    await channels_dao.in_claim.wait()
    task.cancel()
    await asyncio.sleep(0)
    channels_dao.gate.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert channels_dao.outbox[row.key].status.code == "sent"
