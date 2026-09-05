"""The ingest guard that keeps one execution to one ending.

RFC "Required behavior / Execution" item 3: after an execution reaches its terminal outcome,
later non-terminal output for it is rejected or quarantined. `RecordsService.append_many` is
where that is enforced, because ingest is the only place the watchdog and the runner meet.

The case these tests pin was caught live. A runner wedges past the watchdog's stale-heartbeat
threshold, the watchdog writes the turn's `error` and `done` on its behalf, and the runner
then thaws and submits everything it had buffered: a tool call, its result, a `usage`, and a
second `done`. The reader was left with a failure notice followed by the work the agent went
on to do, and with two endings for one turn.

Every test here drives the service against a stub DAO, so they run with no Postgres. The
DAO-level half — that a quarantined row is invisible to `get_records` and does not answer
`settled_turns` — lives in `test_late_record_quarantine_dao.py` against a real database.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID, uuid4

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SETTLED_BY_WATCHDOG,
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)
from oss.src.utils.env import env


_PROJECT = UUID("00000000-0000-0000-0000-0000000000aa")
_SESSION = "sess-late-tail"
_TURN = "turn-abc"


class _StubDAO(RecordsDAOInterface):
    """Answers `settled_turns` from a fixed set and remembers what `append_many` was given.

    The settled sets belong to `project`, and the real DAO scopes its query the same way, so a
    key from another project is never a hit however it is spelled.
    """

    def __init__(
        self,
        *,
        watchdog_settled: Optional[Set[Tuple[str, str]]] = None,
        any_settled: Optional[Set[Tuple[str, str]]] = None,
        project: UUID = _PROJECT,
        raises: bool = False,
    ):
        self.watchdog_settled = watchdog_settled or set()
        self.any_settled = any_settled or set()
        self.project = project
        self.raises = raises
        self.appended: List[SessionRecordEvent] = []
        self.lookups: List[Dict] = []

    async def settled_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        settled_by: Optional[str] = None,
    ) -> Set[Tuple[str, str]]:
        self.lookups.append({"project_id": project_id, "settled_by": settled_by})
        if self.raises:
            raise RuntimeError("tracing database is unreachable")
        if project_id != self.project:
            return set()
        source = (
            self.watchdog_settled
            if settled_by == SETTLED_BY_WATCHDOG
            else self.any_settled
        )
        return {key for key in keys if key in source}

    async def append_many(
        self, *, events: List[SessionRecordEvent]
    ) -> List[SessionRecord]:
        self.appended.extend(events)
        return [
            SessionRecord(
                record_id=event.record_id or uuid4(),
                session_id=event.session_id,
                project_id=event.project_id,
                record_index=event.record_index,
                record_type=event.record_type,
                record_source=event.record_source,
                attributes=event.attributes,
                turn_id=event.turn_id,
                quarantined_at=event.quarantined_at,
            )
            for event in events
        ]


class _ExecutionSettlements:
    def __init__(self, *, raises: bool = False, mark_raises: bool = False):
        self.rows: Dict[Tuple[str, str], SessionExecutionSettlement] = {}
        self.raises = raises
        self.mark_raises = mark_raises

    async def settle(
        self,
        *,
        project_id,
        session_id,
        execution_id,
        terminal_outcome,
        settled_by,
        settled_at=None,
    ):
        key = (session_id, execution_id)
        if key in self.rows:
            if self.rows[key].terminal_outcome is None:
                self.rows[key] = self.rows[key].model_copy(
                    update={
                        "state": "terminal",
                        "terminal_outcome": terminal_outcome,
                        "settled_by": settled_by,
                        "settled_at": settled_at or datetime.now(timezone.utc),
                    }
                )
                return SessionExecutionSettlementResult(
                    settlement=self.rows[key], won=True
                )
            return SessionExecutionSettlementResult(
                settlement=self.rows[key], won=False
            )
        row = SessionExecutionSettlement(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
            terminal_outcome=terminal_outcome,
            settled_by=settled_by,
            settled_at=settled_at or datetime.now(timezone.utc),
        )
        self.rows[key] = row
        return SessionExecutionSettlementResult(settlement=row, won=True)

    async def fetch_execution(self, *, project_id, session_id, execution_id):
        if self.raises:
            raise RuntimeError("core database is unreachable")
        return self.rows.get((session_id, execution_id))

    async def query_settled(self, *, project_id, keys):
        if self.raises:
            raise RuntimeError("core database is unreachable")
        return {key: self.rows[key] for key in keys if key in self.rows}

    async def mark_endings_written(self, *, project_id, keys, written_at=None):
        if self.raises or self.mark_raises:
            raise RuntimeError("core database is unreachable")
        for key in keys:
            if key in self.rows and self.rows[key].ending_written_at is None:
                self.rows[key] = self.rows[key].model_copy(
                    update={
                        "ending_written_at": written_at or datetime.now(timezone.utc)
                    }
                )


def _event(record_type: str, **over) -> SessionRecordEvent:
    base = {
        "project_id": _PROJECT,
        "session_id": _SESSION,
        "record_id": uuid4(),
        "record_type": record_type,
        "record_source": "agent",
        "attributes": {"type": record_type},
        "turn_id": _TURN,
    }
    base.update(over)
    return SessionRecordEvent(**base)


def _watchdog_event(record_type: str, **over) -> SessionRecordEvent:
    """What `orphan_sweep._lost_turn_records` puts on the stream."""
    event = _event(record_type, **over)
    event.attributes = {
        **(event.attributes or {}),
        RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG,
    }
    return event


def _quarantined(dao: _StubDAO) -> List[SessionRecordEvent]:
    return [event for event in dao.appended if event.quarantined_at is not None]


# --------------------------------------------------------------------------- #
# The tail: output produced before termination, delivered after it
# --------------------------------------------------------------------------- #


async def test_a_thawed_runners_tail_is_quarantined_with_durable_stop_off(
    monkeypatch,
):
    """The live defect, in one test: four records land after the watchdog's ending."""
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", False)
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(
        records_dao=dao,
        executions_dao=_ExecutionSettlements(),
    )

    tail = [
        _event("tool_call"),
        _event("tool_result"),
        _event("usage"),
        _event("done", attributes={"type": "done", "stopReason": "cancelled"}),
    ]
    results = await service.append_many(events=tail)

    # Every record is still written — quarantine keeps the evidence — and every one of them
    # is marked, so no read that rebuilds the transcript will show it.
    assert len(results) == 4
    assert len(_quarantined(dao)) == 4
    assert all(row.quarantined_at is not None for row in results)


async def test_reject_policy_drops_a_late_tail(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "late_output", "reject")
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    results = await service.append_many(events=[_event("tool_result"), _event("usage")])

    assert results == []
    assert dao.appended == []


async def test_watchdog_winner_quarantines_the_runners_records(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements()
    winner = await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="lost",
        settled_by="watchdog",
    )
    assert winner.won is True
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    await service.append_many(
        events=[
            _event("usage"),
            _event("done", attributes={"type": "done", "stopReason": "cancelled"}),
        ]
    )

    assert [event.record_type for event in _quarantined(dao)] == ["usage", "done"]


async def test_watchdog_winner_rejects_the_runners_records_when_configured(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(env.agenta.sessions, "late_output", "reject")
    executions = _ExecutionSettlements()
    await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="lost",
        settled_by="watchdog",
    )
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    results = await service.append_many(events=[_event("usage"), _event("done")])

    assert results == []
    assert dao.appended == []


async def test_runner_winner_quarantines_the_watchdogs_records(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements()
    winner = await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="stopped",
        settled_by="runner",
    )
    assert winner.won is True
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    await service.append_many(
        events=[_watchdog_event("error"), _watchdog_event("done")]
    )

    assert [event.record_type for event in _quarantined(dao)] == ["error", "done"]


async def test_output_after_the_runners_own_stop_is_ordinary_history(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements()
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    await service.append_many(events=[_event("usage"), _event("done")])
    await service.append_many(events=[_event("tool_result")])

    assert _quarantined(dao) == []


async def test_an_ordinary_completion_row_does_not_make_trailing_usage_late(
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements()
    await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="completed",
        settled_by="runner",
    )
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    await service.append_many(events=[_event("usage")])

    assert _quarantined(dao) == []


async def test_execution_lookup_failure_appends_the_batch_unguarded(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    dao = _StubDAO()
    service = RecordsService(
        records_dao=dao,
        executions_dao=_ExecutionSettlements(raises=True),
    )
    events = [_event("usage"), _event("done")]

    results = await service.append_many(events=events)

    assert len(results) == 2
    assert dao.appended == events
    assert _quarantined(dao) == []


async def test_runner_done_terminalizes_a_continuation_execution(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    executions = _ExecutionSettlements()
    executions.rows[(_SESSION, _TURN)] = SessionExecutionSettlement(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        state="running",
        source_interaction_id=uuid4(),
    )
    service = RecordsService(records_dao=_StubDAO(), executions_dao=executions)

    await service.append_many(events=[_event("done")])

    execution = executions.rows[(_SESSION, _TURN)]
    assert execution.terminal_outcome == "completed"
    assert execution.settled_by == "runner"


async def test_paused_or_quarantined_done_does_not_complete_a_continuation(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    executions = _ExecutionSettlements()
    executions.rows[(_SESSION, _TURN)] = SessionExecutionSettlement(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        state="running",
        source_interaction_id=uuid4(),
    )
    service = RecordsService(
        records_dao=_StubDAO(watchdog_settled={(_SESSION, _TURN)}),
        executions_dao=executions,
    )

    await service.append_many(
        events=[_event("done", attributes={"type": "done", "stopReason": "paused"})]
    )
    assert executions.rows[(_SESSION, _TURN)].terminal_outcome is None

    await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="lost",
        settled_by="watchdog",
    )
    await service.append_many(events=[_event("done")])

    assert executions.rows[(_SESSION, _TURN)].terminal_outcome == "lost"
    assert _quarantined(service.records_dao)[-1].record_type == "done"


async def test_cancelled_done_arriving_first_leaves_stop_settlement_to_win(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)
    executions = _ExecutionSettlements()
    executions.rows[(_SESSION, _TURN)] = SessionExecutionSettlement(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        state="running",
        source_interaction_id=uuid4(),
    )
    service = RecordsService(records_dao=_StubDAO(), executions_dao=executions)

    await service.append_many(
        events=[_event("done", attributes={"type": "done", "stopReason": "cancelled"})]
    )
    assert executions.rows[(_SESSION, _TURN)].terminal_outcome is None

    result = await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="stopped",
        settled_by="runner",
    )

    assert result.won is True
    assert executions.rows[(_SESSION, _TURN)].terminal_outcome == "stopped"


async def test_ingest_marks_the_runners_terminal_record_written(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements()
    await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="stopped",
        settled_by="runner",
    )
    service = RecordsService(records_dao=_StubDAO(), executions_dao=executions)

    await service.append_many(
        events=[_event("done", attributes={"type": "done", "stopReason": "cancelled"})]
    )

    assert executions.rows[(_SESSION, _TURN)].ending_written_at is not None


async def test_ending_marker_failure_does_not_fail_record_ingest(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    executions = _ExecutionSettlements(mark_raises=True)
    await executions.settle(
        project_id=_PROJECT,
        session_id=_SESSION,
        execution_id=_TURN,
        terminal_outcome="stopped",
        settled_by="runner",
    )
    dao = _StubDAO()
    service = RecordsService(records_dao=dao, executions_dao=executions)

    results = await service.append_many(events=[_event("done")])

    assert len(results) == 1
    assert [event.record_type for event in dao.appended] == ["done"]
    assert executions.rows[(_SESSION, _TURN)].ending_written_at is None


async def test_the_guard_asks_only_about_watchdog_endings():
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(events=[_event("usage")])

    assert [lookup["settled_by"] for lookup in dao.lookups] == [SETTLED_BY_WATCHDOG]


async def test_a_late_terminal_record_is_quarantined_like_the_rest_of_the_tail():
    """One effective ending. The runner's contradicting `done` is kept, but not as history.

    Folding it into the watchdog's ending would rewrite the record the user has already
    read, and would hide that two writers disagreed about how the turn finished.
    """
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(
        events=[_event("done", attributes={"type": "done", "stopReason": "cancelled"})]
    )

    assert len(_quarantined(dao)) == 1
    assert _quarantined(dao)[0].record_type == "done"


# --------------------------------------------------------------------------- #
# What the guard must never touch
# --------------------------------------------------------------------------- #


async def test_an_ordinary_stop_the_watchdog_never_saw_is_untouched():
    """The runner's own honest single ending still lands, unmarked."""
    dao = _StubDAO(watchdog_settled=set())
    service = RecordsService(records_dao=dao)

    ending = [
        _event("usage"),
        _event("done", attributes={"type": "done", "stopReason": "cancelled"}),
    ]
    results = await service.append_many(events=ending)

    assert _quarantined(dao) == []
    assert all(row.quarantined_at is None for row in results)


async def test_a_turn_the_runner_settled_itself_does_not_trigger_the_guard():
    """A terminal record is not enough; it has to be the WATCHDOG's.

    A `usage` that trails its own `done` through the stream is ordinary history, and a turn
    that reached its own ending never lost the argument with the platform.
    """
    dao = _StubDAO(watchdog_settled=set(), any_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(events=[_event("usage")])

    assert _quarantined(dao) == []


async def test_the_watchdogs_own_records_are_never_quarantined():
    """Its `error` is not terminal, so without the exemption a redelivery would mark it."""
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(
        events=[
            _watchdog_event(
                "error", attributes={"type": "error", "code": "execution_lost"}
            ),
            _watchdog_event("done"),
        ]
    )

    assert _quarantined(dao) == []
    # And they are not even looked up: a watchdog record can never be late for its own turn.
    assert dao.lookups == []


async def test_a_record_with_no_turn_id_is_never_quarantined():
    """Nothing to attribute it to. Old records carry no turn key at all."""
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(events=[_event("message", turn_id=None)])

    assert _quarantined(dao) == []


async def test_another_turn_in_the_same_session_is_untouched():
    """The user sent a new message after the failure; that turn is nobody's tail."""
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(
        events=[_event("message", turn_id="turn-next"), _event("usage")]
    )

    assert [event.record_type for event in _quarantined(dao)] == ["usage"]


# --------------------------------------------------------------------------- #
# Batching, redelivery, and failure
# --------------------------------------------------------------------------- #


async def test_a_watchdog_ending_settles_its_turn_for_the_rest_of_its_own_batch():
    """Ingest batches up to fifty messages; the tail can share one with the ending.

    Without this the DB lookup would find nothing — the ending is not committed yet — and the
    tail would be appended as ordinary history.
    """
    dao = _StubDAO(watchdog_settled=set())
    service = RecordsService(records_dao=dao)

    await service.append_many(
        events=[
            _watchdog_event(
                "error", attributes={"type": "error", "code": "execution_lost"}
            ),
            _watchdog_event("done"),
            _event("tool_result"),
            _event("done", attributes={"type": "done", "stopReason": "cancelled"}),
        ]
    )

    assert [event.record_type for event in _quarantined(dao)] == ["tool_result", "done"]


async def test_redelivery_quarantines_the_same_records_again():
    """The stream replays on a consumer-group failure; the outcome must not drift.

    The upsert coalesces `quarantined_at`, so the row keeps the instant it was FIRST marked;
    what this pins is that the guard's own verdict is the same on every delivery.
    """
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    tail = [_event("tool_call"), _event("usage")]
    first = await service.append_many(events=tail)
    second = await service.append_many(events=tail)

    assert [row.record_id for row in first] == [row.record_id for row in second]
    assert all(row.quarantined_at is not None for row in first + second)


async def test_a_failed_lookup_appends_the_batch_rather_than_losing_it():
    """Losing a record is worse than showing one that should have been hidden."""
    dao = _StubDAO(raises=True)
    service = RecordsService(records_dao=dao)

    results = await service.append_many(events=[_event("tool_call"), _event("done")])

    assert len(results) == 2
    assert _quarantined(dao) == []


async def test_an_empty_batch_asks_the_database_nothing():
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    assert await service.append_many(events=[]) == []
    assert dao.lookups == []
    assert dao.appended == []


async def test_each_project_in_a_batch_gets_its_own_lookup():
    """`settled_turns` is project-scoped; a mixed batch must not ask across the boundary."""
    other_project = UUID("00000000-0000-0000-0000-0000000000bb")
    dao = _StubDAO(watchdog_settled={(_SESSION, _TURN)})
    service = RecordsService(records_dao=dao)

    await service.append_many(
        events=[_event("usage"), _event("usage", project_id=other_project)]
    )

    assert sorted(str(lookup["project_id"]) for lookup in dao.lookups) == sorted(
        [str(_PROJECT), str(other_project)]
    )
    # Only the project whose turn the watchdog settled is affected.
    assert [event.project_id for event in _quarantined(dao)] == [_PROJECT]
