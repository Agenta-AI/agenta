import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.sessions.dtos import (
    SessionOrigin,
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.sessions.streams.dtos import SessionStreamEdit, SessionStreamFlags
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import TriggerDeliveryData
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


class _PausedSession:
    def __init__(self, session, *, read_complete, resume):
        self._session = session
        self._read_complete = read_complete
        self._resume = resume
        self._paused = False

    def __getattr__(self, name):
        return getattr(self._session, name)

    async def execute(self, statement, *args, **kwargs):
        result = await self._session.execute(statement, *args, **kwargs)
        if not self._paused:
            self._paused = True
            self._read_complete.set()
            await self._resume.wait()
        return result


class _PauseAfterReadEngine:
    def __init__(self, engine):
        self._engine = engine
        self.read_complete = asyncio.Event()
        self.resume = asyncio.Event()

    @asynccontextmanager
    async def session(self):
        async with self._engine.session() as session:
            yield _PausedSession(
                session,
                read_complete=self.read_complete,
                resume=self.resume,
            )


class _Barrier:
    def __init__(self, parties):
        self._parties = parties
        self._arrived = 0
        self._lock = asyncio.Lock()
        self._ready = asyncio.Event()

    async def wait(self):
        async with self._lock:
            self._arrived += 1
            if self._arrived == self._parties:
                self._ready.set()
        await self._ready.wait()


class _BarrierSession:
    def __init__(self, session, *, barrier):
        self._session = session
        self._barrier = barrier

    def __getattr__(self, name):
        return getattr(self._session, name)

    async def execute(self, statement, *args, **kwargs):
        await self._barrier.wait()
        return await self._session.execute(statement, *args, **kwargs)


class _BarrierBeforeExecuteEngine:
    def __init__(self, engine, *, parties):
        self._engine = engine
        self._barrier = _Barrier(parties)

    @asynccontextmanager
    async def session(self):
        async with self._engine.session() as session:
            yield _BarrierSession(session, barrier=self._barrier)


@pytest_asyncio.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest_asyncio.fixture
async def trigger_project():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    schedule_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "trigger-session-claim-test",
                "email": f"trigger-session-claim-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "trigger-session-claim-org",
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
                "name": "trigger-session-claim-workspace",
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
                "name": "trigger-session-claim-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO trigger_schedules (id, project_id, created_by_id, flags) "
                "VALUES (:id, :project_id, :user_id, CAST(:flags AS jsonb))"
            ),
            {
                "id": schedule_id,
                "project_id": project_id,
                "user_id": user_id,
                "flags": '{"is_active": true}',
            },
        )
        await session.commit()

    yield {
        "project_id": project_id,
        "user_id": user_id,
        "schedule_id": schedule_id,
    }

    async with engine.session() as session:
        for table in ("trigger_deliveries", "session_streams", "trigger_schedules"):
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


async def test_claim_atomically_merges_tags_flags_and_delivery_data(trigger_project):
    engine = get_transactions_engine()
    streams_dao = SessionStreamsDAO(engine=engine)
    triggers_dao = TriggersDAO(engine=engine)
    project_id = trigger_project["project_id"]
    user_id = trigger_project["user_id"]
    schedule_id = trigger_project["schedule_id"]
    session_id = uuid.uuid4().hex
    turn_id = uuid.uuid4().hex

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO session_streams "
                "(id, project_id, created_by_id, session_id, name, description, "
                "flags, tags, meta, turn_id) VALUES "
                "(:id, :project_id, :user_id, :session_id, :name, :description, "
                "CAST(:flags AS jsonb), CAST(:tags AS jsonb), CAST(:meta AS json), :turn_id)"
            ),
            {
                "id": uuid.uuid4(),
                "project_id": project_id,
                "user_id": user_id,
                "session_id": session_id,
                "name": "Existing session",
                "description": "Keep this header",
                "flags": '{"is_alive": true, "is_running": false, "is_attached": false}',
                "tags": '{"customer": "acme", "ag.private": "keep"}',
                "meta": '{"source": "existing"}',
                "turn_id": turn_id,
            },
        )
        await session.commit()

    attribution = SessionTriggerAttribution(
        configuration_id=schedule_id,
        kind=SessionTriggerKind.schedule,
        delivery_id=uuid.uuid4(),
    )
    paused_engine = _PauseAfterReadEngine(engine)
    heartbeat_dao = SessionStreamsDAO(engine=paused_engine)
    heartbeat = asyncio.create_task(
        heartbeat_dao.update(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            stream=SessionStreamEdit(
                flags=SessionStreamFlags(
                    is_alive=True,
                    is_running=True,
                    is_attached=False,
                ),
                turn_id=turn_id,
            ),
        )
    )
    await paused_engine.read_complete.wait()

    try:
        claimed = await streams_dao.claim_trigger_delivery(
            project_id=project_id,
            user_id=user_id,
            event_id="event-1",
            session_id=session_id,
            attribution=attribution,
        )
    finally:
        paused_engine.resume.set()
        heartbeat_result = await heartbeat

    assert claimed is True
    assert heartbeat_result is not None
    assert heartbeat_result.delivery is not None
    assert heartbeat_result.delivery.id == attribution.delivery_id

    stream = await streams_dao.get_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert stream is not None
    assert stream.name == "Existing session"
    assert stream.description == "Keep this header"
    assert stream.turn_id == turn_id
    assert stream.meta == {"source": "existing"}
    assert stream.flags.is_running is True
    # Reserved attribution keys are stripped at the DTO mapping chokepoint (P1-6) —
    # only caller-owned tags survive on `stream.tags`. The typed fields carry the
    # attribution instead.
    assert stream.tags == {
        "customer": "acme",
        "ag.private": "keep",
    }
    assert stream.origin == SessionOrigin.trigger
    assert stream.trigger is not None
    assert stream.trigger.id == schedule_id
    assert stream.trigger.kind == SessionTriggerKind.schedule
    assert stream.delivery is not None
    assert stream.delivery.id == attribution.delivery_id

    # The raw row still carries the full merged tag set — the origin predicate
    # (and the orphan-sweep/list filters) read the SQL column directly, never the
    # sanitized DTO.
    async with engine.session() as session:
        raw_tags = await session.scalar(
            text(
                "SELECT tags FROM session_streams "
                "WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {"project_id": project_id, "session_id": session_id},
        )
    assert raw_tags == {
        "customer": "acme",
        "ag.private": "keep",
        "ag.origin": "trigger",
        "ag.trigger.id": str(schedule_id),
        "ag.trigger.kind": "schedule",
        "ag.trigger.delivery_id": str(attribution.delivery_id),
    }

    delivery = await triggers_dao.fetch_delivery(
        project_id=project_id, delivery_id=attribution.delivery_id
    )
    assert delivery is not None
    assert delivery.data.session_id == session_id
    assert delivery.status.code == "102"
    assert delivery.status.message == "claimed"
    assert delivery.status.timestamp is not None

    await triggers_dao.update_delivery(
        project_id=project_id,
        delivery_id=attribution.delivery_id,
        status=Status(code="200", message="success"),
        data=TriggerDeliveryData(result={"outputs": {"ok": True}}),
    )
    completed = await triggers_dao.fetch_delivery(
        project_id=project_id, delivery_id=attribution.delivery_id
    )
    assert completed is not None
    assert completed.data.session_id == session_id
    assert completed.data.result == {"outputs": {"ok": True}}


async def test_duplicate_claims_race_as_separate_operations(trigger_project):
    engine = get_transactions_engine()
    barrier_engine = _BarrierBeforeExecuteEngine(engine, parties=2)
    claims_dao = SessionStreamsDAO(engine=barrier_engine)
    streams_dao = SessionStreamsDAO(engine=engine)
    triggers_dao = TriggersDAO(engine=engine)
    project_id = trigger_project["project_id"]
    user_id = trigger_project["user_id"]
    schedule_id = trigger_project["schedule_id"]
    pairs = [
        (
            uuid.uuid4().hex,
            SessionTriggerAttribution(
                configuration_id=schedule_id,
                kind=SessionTriggerKind.schedule,
                delivery_id=uuid.uuid4(),
            ),
        )
        for _ in range(2)
    ]

    async def claim(session_id, attribution):
        return await claims_dao.claim_trigger_delivery(
            project_id=project_id,
            user_id=user_id,
            event_id="duplicate-event",
            session_id=session_id,
            attribution=attribution,
        )

    results = await asyncio.gather(
        *(claim(session_id, attribution) for session_id, attribution in pairs)
    )
    assert sorted(results) == [False, True]

    winner = results.index(True)
    loser = 1 - winner
    winning_session_id, winning_attribution = pairs[winner]
    losing_session_id, losing_attribution = pairs[loser]
    delivery = await triggers_dao.fetch_delivery(
        project_id=project_id,
        delivery_id=winning_attribution.delivery_id,
    )
    assert delivery is not None
    assert delivery.data.session_id == winning_session_id
    assert (
        await triggers_dao.fetch_delivery(
            project_id=project_id,
            delivery_id=losing_attribution.delivery_id,
        )
        is None
    )
    assert (
        await streams_dao.get_by_session_id(
            project_id=project_id, session_id=winning_session_id
        )
        is not None
    )
    assert (
        await streams_dao.get_by_session_id(
            project_id=project_id, session_id=losing_session_id
        )
        is None
    )


async def test_different_events_create_distinct_delivery_session_pairs(trigger_project):
    engine = get_transactions_engine()
    barrier_engine = _BarrierBeforeExecuteEngine(engine, parties=2)
    claims_dao = SessionStreamsDAO(engine=barrier_engine)
    streams_dao = SessionStreamsDAO(engine=engine)
    triggers_dao = TriggersDAO(engine=engine)
    project_id = trigger_project["project_id"]
    user_id = trigger_project["user_id"]
    schedule_id = trigger_project["schedule_id"]
    pairs = [
        (
            f"event-{index}",
            uuid.uuid4().hex,
            SessionTriggerAttribution(
                configuration_id=schedule_id,
                kind=SessionTriggerKind.schedule,
                delivery_id=uuid.uuid4(),
            ),
        )
        for index in range(2)
    ]

    async def claim(event_id, session_id, attribution):
        return await claims_dao.claim_trigger_delivery(
            project_id=project_id,
            user_id=user_id,
            event_id=event_id,
            session_id=session_id,
            attribution=attribution,
        )

    results = await asyncio.gather(
        *(
            claim(event_id, session_id, attribution)
            for event_id, session_id, attribution in pairs
        )
    )
    assert results == [True, True]
    assert pairs[0][1] != pairs[1][1]
    assert pairs[0][2].delivery_id != pairs[1][2].delivery_id

    for event_id, session_id, attribution in pairs:
        delivery = await triggers_dao.fetch_delivery(
            project_id=project_id,
            delivery_id=attribution.delivery_id,
        )
        stream = await streams_dao.get_by_session_id(
            project_id=project_id, session_id=session_id
        )
        assert delivery is not None
        assert delivery.event_id == event_id
        assert delivery.data.session_id == session_id
        assert stream is not None
        assert stream.delivery is not None
        assert stream.delivery.id == attribution.delivery_id


async def test_attribution_failure_rolls_back_claim_and_allows_retry(trigger_project):
    engine = get_transactions_engine()
    streams_dao = SessionStreamsDAO(engine=engine)
    project_id = trigger_project["project_id"]
    attribution = SessionTriggerAttribution(
        configuration_id=trigger_project["schedule_id"],
        kind=SessionTriggerKind.schedule,
        delivery_id=uuid.uuid4(),
    )

    with pytest.raises(IntegrityError):
        await streams_dao.claim_trigger_delivery(
            project_id=project_id,
            user_id=trigger_project["user_id"],
            event_id="retryable-event",
            session_id=None,
            attribution=attribution,
        )

    async with engine.session() as session:
        delivery_count = await session.scalar(
            text(
                "SELECT count(*) FROM trigger_deliveries "
                "WHERE project_id = :project_id AND event_id = 'retryable-event'"
            ),
            {"project_id": project_id},
        )
    assert delivery_count == 0

    retried = await streams_dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=trigger_project["user_id"],
        event_id="retryable-event",
        session_id=uuid.uuid4().hex,
        attribution=attribution,
    )
    assert retried is True


async def test_abandon_claimed_session_soft_deletes_the_phantom_row(trigger_project):
    """P0-3: a claim followed by a pre-invoke dispatch failure must not leave a
    permanent, un-sweepable phantom session. `abandon_claimed_session` is the
    dispatcher's cleanup call for that path — verify it actually soft-deletes the
    row the claim inserted (flags=NULL, so nothing else can end it)."""
    engine = get_transactions_engine()
    streams_dao = SessionStreamsDAO(engine=engine)
    project_id = trigger_project["project_id"]
    user_id = trigger_project["user_id"]
    schedule_id = trigger_project["schedule_id"]
    session_id = uuid.uuid4().hex

    claimed = await streams_dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=user_id,
        event_id="phantom-event",
        session_id=session_id,
        attribution=SessionTriggerAttribution(
            configuration_id=schedule_id,
            kind=SessionTriggerKind.schedule,
            delivery_id=uuid.uuid4(),
        ),
    )
    assert claimed is True

    claimed_stream = await streams_dao.get_by_session_id(
        project_id=project_id, session_id=session_id
    )
    assert claimed_stream is not None
    assert claimed_stream.flags.is_alive is False  # flags=NULL decodes to all-False

    abandoned = await streams_dao.abandon_claimed_session(
        project_id=project_id, session_id=session_id
    )
    assert abandoned is True

    # Soft-deleted: gone from the default (non-deleted) read, matching a killed
    # session's tombstone semantics — not a permanent, visible phantom.
    assert (
        await streams_dao.get_by_session_id(
            project_id=project_id, session_id=session_id
        )
        is None
    )
    tombstoned = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id, session_id=session_id
    )
    assert tombstoned is not None
    assert tombstoned.deleted_at is not None
