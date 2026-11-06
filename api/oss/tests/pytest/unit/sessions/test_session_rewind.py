"""A rewind reaches every place that holds a removed turn, in the order that keeps it retryable."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from oss.src.core.sessions.records.dtos import REWIND_RECORD_TYPE, SessionRecordEvent
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.rewind import SessionRewindBusy, SessionRewindService

_SESSION = "session-rewind"
_PROJECT = uuid4()
_USER = uuid4()


def _service(*, running=False, continuation=False, turn_exists=True, calls=None):
    calls = calls if calls is not None else []

    def step(name, result=None):
        async def run(**_kwargs):
            calls.append(name)
            return result

        return run

    streams = MagicMock()
    streams.is_running = AsyncMock(return_value=running)
    records = MagicMock()
    records.has_active_continuation = AsyncMock(return_value=continuation)
    records.has_turn = AsyncMock(return_value=turn_exists)
    records.rewind_from_turn = AsyncMock(side_effect=step("records", 7))
    turns = MagicMock()
    turns.forget_native_sessions = AsyncMock(side_effect=step("turns"))
    interactions = MagicMock()
    interactions.cancel_session_pending = AsyncMock(side_effect=step("interactions", 0))
    service = SessionRewindService(
        streams_service=streams,
        records_service=records,
        turns_service=turns,
        interactions_service=interactions,
    )
    return service, records, turns, interactions


async def _rewind(service):
    return await service.rewind(
        project_id=_PROJECT, session_id=_SESSION, turn_id="turn-2", user_id=_USER
    )


@pytest.mark.asyncio
async def test_the_records_go_last_so_a_failure_can_be_retried():
    calls = []
    service, *_ = _service(calls=calls)

    async def kill(**_kwargs):
        calls.append("sandbox")
        return True

    with patch("oss.src.core.sessions.rewind.kill_runner_sandbox", kill):
        removed = await _rewind(service)

    assert removed == 7
    assert calls == ["interactions", "turns", "sandbox", "records"]


@pytest.mark.asyncio
async def test_a_running_turn_refuses_and_changes_nothing():
    service, records, turns, interactions = _service(running=True)
    kill = AsyncMock()

    with patch("oss.src.core.sessions.rewind.kill_runner_sandbox", kill):
        with pytest.raises(SessionRewindBusy):
            await _rewind(service)

    kill.assert_not_awaited()
    records.rewind_from_turn.assert_not_awaited()
    turns.forget_native_sessions.assert_not_awaited()
    interactions.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_saved_continuation_refuses_and_changes_nothing():
    service, records, *_ = _service(continuation=True)
    kill = AsyncMock()

    with patch("oss.src.core.sessions.rewind.kill_runner_sandbox", kill):
        with pytest.raises(SessionRewindBusy):
            await _rewind(service)

    kill.assert_not_awaited()
    records.rewind_from_turn.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_turn_the_log_no_longer_holds_touches_nothing():
    service, records, turns, interactions = _service(turn_exists=False)
    kill = AsyncMock()

    with patch("oss.src.core.sessions.rewind.kill_runner_sandbox", kill):
        assert await _rewind(service) == 0

    kill.assert_not_awaited()
    records.rewind_from_turn.assert_not_awaited()
    turns.forget_native_sessions.assert_not_awaited()
    interactions.cancel_session_pending.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_unreachable_runner_does_not_stop_the_rewind():
    service, records, *_ = _service()

    with patch(
        "oss.src.core.sessions.rewind.kill_runner_sandbox",
        AsyncMock(return_value=False),
    ):
        assert await _rewind(service) == 7

    records.rewind_from_turn.assert_awaited_once()


@pytest.mark.asyncio
async def test_removing_records_logs_one_rewind_record():
    dao = MagicMock()
    dao.rewind_from_turn = AsyncMock(return_value=5)
    dao.append = AsyncMock()

    removed = await RecordsService(records_dao=dao).rewind_from_turn(
        project_id=_PROJECT, session_id=_SESSION, turn_id="turn-2", user_id=_USER
    )

    assert removed == 5
    event = dao.append.await_args.kwargs["event"]
    assert event.record_type == REWIND_RECORD_TYPE
    assert event.attributes == {"type": REWIND_RECORD_TYPE, "turnId": "turn-2"}
    assert event.turn_id is None


@pytest.mark.asyncio
async def test_a_second_rewind_of_the_same_turn_logs_nothing():
    dao = MagicMock()
    dao.rewind_from_turn = AsyncMock(return_value=0)
    dao.append = AsyncMock()

    removed = await RecordsService(records_dao=dao).rewind_from_turn(
        project_id=_PROJECT, session_id=_SESSION, turn_id="turn-2", user_id=_USER
    )

    assert removed == 0
    dao.append.assert_not_awaited()


def _late_event(turn_id):
    return SessionRecordEvent(
        project_id=_PROJECT,
        session_id=_SESSION,
        record_id=uuid4(),
        record_type="message",
        record_source="agent",
        attributes={"type": "message", "text": "tail"},
        turn_id=turn_id,
    )


@pytest.mark.asyncio
async def test_a_removed_turns_late_tail_is_quarantined():
    dao = MagicMock()
    dao.rewound_turns = AsyncMock(return_value={(_SESSION, "turn-2")})
    dao.append_many = AsyncMock(return_value=[])

    await RecordsService(records_dao=dao).append_many(
        events=[_late_event("turn-2"), _late_event("turn-4")]
    )

    written = dao.append_many.await_args.kwargs["events"]
    assert [event.quarantined_at is not None for event in written] == [True, False]


@pytest.mark.asyncio
async def test_a_failed_lookup_keeps_the_batch():
    dao = MagicMock()
    dao.rewound_turns = AsyncMock(side_effect=RuntimeError("down"))
    dao.append_many = AsyncMock(return_value=[])

    await RecordsService(records_dao=dao).append_many(events=[_late_event("turn-2")])

    written = dao.append_many.await_args.kwargs["events"]
    assert written[0].quarantined_at is None
