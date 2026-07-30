"""The orphaned-gate safety net: no HITL gate may outlive its turn.

A `session_interactions` row is only ever created when a turn PAUSES for a human. So once a
turn reaches its terminal `done` record WITHOUT the pause marker, nothing is holding a gate for
that session and any row still `pending` is unanswerable — yet both inboxes keep offering it
(the live "orphaned gate": a stuck approval that can never be answered).

The records worker is the choke point: it sees every turn's terminal record. Two guards keep a
legitimately parked gate alive:

  * `stopReason: "paused"` on the terminal record means THAT turn is the live park — skip it;
  * the finished turn must be the session's LATEST turn, because this worker can lag arbitrarily
    behind the stream and a later turn may be parked right now.

Cancelling is deliberately a DIFFERENT terminal status from a user's deny: a deny is
`resolved` + `data.resolution.verdict == "denied"`; a superseded gate is `cancelled`, which
already means "the runner abandoned the gate; no one is waiting on the token".
"""

import zlib
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from orjson import dumps

from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.dtos import SessionTurn
from oss.src.tasks.asyncio.sessions.records_worker import (
    RecordsWorker,
    finished_turns_in_batch,
)


PROJECT = uuid4()
SESSION = "sess-orphan"
GATE_TURN = "11111111-1111-4111-8111-111111111111"
RESUME_TURN = "22222222-2222-4222-8222-222222222222"


class _Event:
    """The deserialized stream message shape the worker consumes (`msg.record_event`)."""

    def __init__(self, record_event):
        self.record_event = record_event


class _Record:
    def __init__(self, *, session_id, record_type, turn_id=None, attributes=None):
        self.session_id = session_id
        self.record_type = record_type
        self.turn_id = turn_id
        self.attributes = attributes


def _done(turn_id, *, paused=False, session_id=SESSION):
    attributes = {"type": "done", "traceId": "t"}
    if paused:
        attributes["stopReason"] = "paused"
    return _Event(
        _Record(
            session_id=session_id,
            record_type="done",
            turn_id=turn_id,
            attributes=attributes,
        )
    )


def _turn(turn_id, turn_index):
    return SessionTurn(
        id=uuid4(),
        project_id=PROJECT,
        session_id=SESSION,
        turn_id=turn_id,
        stream_id=uuid4(),
        turn_index=turn_index,
        harness_kind="claude",
    )


def _worker(*, latest_turn=None, interactions=None, turns_wired=True):
    interactions_service = interactions or AsyncMock()
    if interactions is None:
        interactions_service.cancel_session_pending = AsyncMock(return_value=1)
    turns_service = None
    if turns_wired:
        turns_service = AsyncMock()
        turns_service.latest_turn = AsyncMock(return_value=latest_turn)
    return RecordsWorker(
        service=RecordsService(records_dao=AsyncMock()),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        interactions_service=interactions_service,
        turns_service=turns_service,
    )


# --------------------------------------------------------------- the batch predicate


def test_finished_turns_picks_a_completed_turn():
    assert finished_turns_in_batch([_done(RESUME_TURN)]) == {SESSION: RESUME_TURN}


def test_finished_turns_skips_a_paused_turn():
    """The pause marker IS the live park; sweeping on it would cancel the gate the human is
    being asked to answer."""
    assert finished_turns_in_batch([_done(GATE_TURN, paused=True)]) == {}


def test_finished_turns_ignores_non_terminal_records_and_untagged_turns():
    events = [
        _Event(
            _Record(
                session_id=SESSION,
                record_type="message",
                turn_id=RESUME_TURN,
                attributes={"type": "message"},
            )
        ),
        _Event(_Record(session_id=SESSION, record_type="done", attributes={})),
    ]
    assert finished_turns_in_batch(events) == {}


def test_finished_turns_tolerates_a_null_attributes_record():
    events = [
        _Event(_Record(session_id=SESSION, record_type="done", turn_id=RESUME_TURN))
    ]
    assert finished_turns_in_batch(events) == {SESSION: RESUME_TURN}


# --------------------------------------------------------------- the reconciliation


@pytest.mark.asyncio
async def test_a_finished_latest_turn_cancels_the_orphaned_gate():
    """The live bug: turn 1 parks a gate, the resume runs as turn 2 and finishes without ever
    binding to the park, so nothing resolves the row. Turn 2's terminal record must clear it."""
    worker = _worker(latest_turn=_turn(RESUME_TURN, 1))

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(GATE_TURN, paused=True), _done(RESUME_TURN)],
    )

    worker.interactions_service.cancel_session_pending.assert_awaited_once_with(
        project_id=PROJECT,
        session_id=SESSION,
    )


@pytest.mark.asyncio
async def test_a_parked_gate_is_not_cancelled():
    """MUST NOT cancel: the only turn in the batch paused, so its gate is live and awaiting a
    human. This is the regression guard for the whole safety net."""
    worker = _worker(latest_turn=_turn(GATE_TURN, 0))

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(GATE_TURN, paused=True)],
    )

    worker.interactions_service.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_finished_turn_that_is_no_longer_the_latest_defers():
    """Worker lag: turn 2's terminal record is only being consumed now, and turn 3 already
    exists — it may be parked this instant. Defer to turn 3's own terminal record rather than
    cancel a gate underneath it."""
    worker = _worker(latest_turn=_turn("33333333-3333-4333-8333-333333333333", 2))

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )

    worker.interactions_service.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_turn_ledger_row_defers():
    worker = _worker(latest_turn=None)

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )

    worker.interactions_service.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_reconciliation_is_disabled_without_both_services():
    interactions = AsyncMock()
    interactions.cancel_session_pending = AsyncMock(return_value=1)
    worker = _worker(interactions=interactions, turns_wired=False)

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )

    interactions.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_reconciliation_failure_never_propagates():
    """The record append is already committed; a safety-net failure must not re-drive it."""
    interactions = AsyncMock()
    interactions.cancel_session_pending = AsyncMock(side_effect=RuntimeError("db down"))
    worker = _worker(latest_turn=_turn(RESUME_TURN, 1), interactions=interactions)

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )


@pytest.mark.asyncio
async def test_process_batch_reconciles_after_the_append():
    """End-to-end through the stream loop: the cancel runs post-append (so a woken client sees
    the cleared row) and the append still reports its count."""
    journal: list = []
    records_dao = AsyncMock()

    async def _append_many(*, events):
        journal.append("append")
        return [
            SessionRecord(record_id=uuid4(), session_id=SESSION, project_id=PROJECT)
            for _ in events
        ]

    records_dao.append_many = AsyncMock(side_effect=_append_many)

    interactions = AsyncMock()

    async def _cancel(*, project_id, session_id):
        journal.append("cancel")
        return 1

    interactions.cancel_session_pending = AsyncMock(side_effect=_cancel)

    turns = AsyncMock()
    turns.latest_turn = AsyncMock(return_value=_turn(RESUME_TURN, 1))

    worker = RecordsWorker(
        service=RecordsService(records_dao=records_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        interactions_service=interactions,
        turns_service=turns,
    )

    message = {
        "organization_id": None,
        "project_id": str(PROJECT),
        "record_event": {
            "project_id": str(PROJECT),
            "session_id": SESSION,
            "record_index": 0,
            "record_type": "done",
            "turn_id": RESUME_TURN,
            "attributes": {"type": "done"},
        },
    }
    appended, processed = await worker.process_batch(
        [(b"1-1", {b"data": zlib.compress(dumps(message))})]
    )

    assert appended == 1
    assert processed == [b"1-1"]
    assert journal == ["append", "cancel"]
