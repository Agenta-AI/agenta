"""The orphaned-gate safety net: no HITL gate may outlive its turn.

A `session_interactions` row is only ever created when a turn PAUSES for a human. So once a
turn reaches its terminal `done` record WITHOUT the pause marker, nothing is holding a gate for
that session and any row still `pending` is unanswerable — yet both inboxes keep offering it
(the live "orphaned gate": a stuck approval that can never be answered).

The records worker is the choke point: it sees every turn's terminal record. Two guards keep a
legitimately parked gate alive:

  * `stopReason: "paused"` on the terminal record means THAT turn is the live park — skip it;
  * the cancel is scoped to the finished turn's OWN gates, so a newer turn's park is out of
    range by construction. This worker can lag arbitrarily far behind the stream without ever
    cancelling underneath a turn that is parked right now — no ordering, no ledger read, and so
    no window between checking and cancelling. Prior turns' leftovers belong to the runner's
    turn-start sweep (`/sessions/interactions/cancel-stale`), not to this one.

Cancelling is deliberately a DIFFERENT terminal status from a user's deny: a deny is
`resolved` + `data.resolution.verdict == "denied"`; a superseded gate is `cancelled`, which
already means "the runner abandoned the gate; no one is waiting on the token".
"""

import zlib
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from orjson import dumps

from oss.src.core.sessions.records.dtos import SessionRecord, SessionRecordsAppendResult
from oss.src.core.sessions.records.service import RecordsService
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


def _worker(*, interactions=None, interactions_wired=True):
    interactions_service = None
    if interactions_wired:
        interactions_service = interactions or AsyncMock()
        if interactions is None:
            interactions_service.cancel_session_pending = AsyncMock(return_value=1)
    return RecordsWorker(
        service=RecordsService(records_dao=AsyncMock()),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        interactions_service=interactions_service,
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
async def test_a_finished_turn_cancels_the_gate_it_orphaned():
    """The live bug: turn 1 parks a gate, the resume runs as turn 2 and finishes without ever
    binding to the park, so nothing resolves the row. Turn 2's terminal record must clear it."""
    worker = _worker()

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(GATE_TURN, paused=True), _done(RESUME_TURN)],
    )

    worker.interactions_service.cancel_session_pending.assert_awaited_once_with(
        project_id=PROJECT,
        session_id=SESSION,
        only_turn_id=RESUME_TURN,
    )


@pytest.mark.asyncio
async def test_a_parked_gate_is_not_cancelled():
    """MUST NOT cancel: the only turn in the batch paused, so its gate is live and awaiting a
    human. This is the regression guard for the whole safety net."""
    worker = _worker()

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(GATE_TURN, paused=True)],
    )

    worker.interactions_service.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_newer_turns_park_is_out_of_range_however_late_this_runs():
    """Worker lag, which used to be guarded by re-reading the turns ledger — a read that could
    go stale before the cancel landed, taking a just-parked turn's gate with it. The scope makes
    the question moot: whatever turn 3 is doing right now, only turn 2's rows are addressed."""
    worker = _worker()

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )

    _, kwargs = worker.interactions_service.cancel_session_pending.await_args
    assert kwargs["only_turn_id"] == RESUME_TURN, (
        "an unscoped cancel takes every pending row in the session, including the gate a "
        "newer turn parked while this batch was queued"
    )


@pytest.mark.asyncio
async def test_reconciliation_is_disabled_without_the_interactions_service():
    worker = _worker(interactions_wired=False)

    await worker.reconcile_orphaned_gates(
        project_id=PROJECT,
        events=[_done(RESUME_TURN)],
    )


@pytest.mark.asyncio
async def test_a_reconciliation_failure_never_propagates():
    """The record append is already committed; a safety-net failure must not re-drive it."""
    interactions = AsyncMock()
    interactions.cancel_session_pending = AsyncMock(side_effect=RuntimeError("db down"))
    worker = _worker(interactions=interactions)

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
        return SessionRecordsAppendResult(
            records=[
                SessionRecord(record_id=uuid4(), session_id=SESSION, project_id=PROJECT)
                for _ in events
            ]
        )

    records_dao.append_many = AsyncMock(side_effect=_append_many)

    interactions = AsyncMock()

    async def _cancel(*, project_id, session_id, only_turn_id):
        journal.append("cancel")
        return 1

    interactions.cancel_session_pending = AsyncMock(side_effect=_cancel)

    worker = RecordsWorker(
        service=RecordsService(records_dao=records_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        interactions_service=interactions,
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
