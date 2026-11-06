"""A rewind reaches every place that holds a removed turn, in the order that keeps it retryable."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from oss.src.core.sessions.records.dtos import REWIND_RECORD_TYPE
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.rewind import SessionRewindBusy, SessionRewindService

_SESSION = "session-rewind"
_PROJECT = uuid4()
_USER = uuid4()


def _service(*, running=False, calls=None):
    calls = calls if calls is not None else []

    def step(name, result=None):
        async def run(**_kwargs):
            calls.append(name)
            return result

        return run

    streams = MagicMock()
    streams.is_running = AsyncMock(return_value=running)
    records = MagicMock()
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
