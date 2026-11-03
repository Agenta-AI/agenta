"""Turn-started/turn-ended publish is additive: `append_turn`/`complete_turn`
must return their existing value regardless of publish outcome, and no other
`SessionTurnsService` method may publish anything.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnComplete,
    SessionTurnCreate,
)
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.turns.types import SessionTurnNotFound


def _turn(
    *, project_id, session_id, turn_id, turn_index=0, end_time=None
) -> SessionTurn:
    return SessionTurn(
        id=uuid4(),
        project_id=project_id,
        session_id=session_id,
        turn_id=turn_id,
        stream_id=uuid4(),
        turn_index=turn_index,
        harness_kind=HarnessKind.CLAUDE,
        end_time=end_time,
    )


@pytest.mark.asyncio
async def test_append_turn_returns_dao_result_even_when_publish_raises():
    project_id = uuid4()
    turn_id = uuid4()
    appended = _turn(project_id=project_id, session_id="session-1", turn_id=turn_id)

    dao = AsyncMock()
    dao.append.return_value = appended
    service = SessionTurnsService(turns_dao=dao)

    with patch(
        "oss.src.core.sessions.turns.service.publish_turn_started",
        new_callable=AsyncMock,
        side_effect=RuntimeError("redis down"),
    ) as publish_mock:
        result = await service.append_turn(
            project_id=project_id,
            user_id=None,
            turn=SessionTurnCreate(
                session_id="session-1",
                stream_id=uuid4(),
                turn_index=0,
                harness_kind=HarnessKind.CLAUDE,
            ),
        )

    assert result is appended
    publish_mock.assert_awaited_once()
    assert publish_mock.await_args.kwargs == {
        "project_id": project_id,
        "session_id": "session-1",
        "turn_id": str(turn_id),
    }


@pytest.mark.asyncio
async def test_complete_turn_still_raises_not_found_independent_of_publish():
    project_id = uuid4()
    dao = AsyncMock()
    dao.complete.return_value = None
    service = SessionTurnsService(turns_dao=dao)

    with patch(
        "oss.src.core.sessions.turns.service.publish_turn_ended",
        new_callable=AsyncMock,
    ) as publish_mock:
        with pytest.raises(SessionTurnNotFound):
            await service.complete_turn(
                project_id=project_id,
                turn=SessionTurnComplete(
                    session_id="missing-session",
                    turn_index=7,
                    end_time=datetime.now(timezone.utc),
                ),
            )

    publish_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_complete_turn_returns_dao_result_even_when_publish_raises():
    project_id = uuid4()
    turn_id = uuid4()
    completed = _turn(
        project_id=project_id,
        session_id="session-1",
        turn_id=turn_id,
        end_time=datetime.now(timezone.utc),
    )

    dao = AsyncMock()
    dao.complete.return_value = completed
    service = SessionTurnsService(turns_dao=dao)

    with patch(
        "oss.src.core.sessions.turns.service.publish_turn_ended",
        new_callable=AsyncMock,
        side_effect=RuntimeError("redis down"),
    ) as publish_mock:
        result = await service.complete_turn(
            project_id=project_id,
            turn=SessionTurnComplete(
                session_id="session-1",
                turn_index=0,
                end_time=datetime.now(timezone.utc),
            ),
        )

    assert result is completed
    publish_mock.assert_awaited_once()
    assert publish_mock.await_args.kwargs == {
        "project_id": project_id,
        "session_id": "session-1",
        "turn_id": str(turn_id),
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method, kwargs",
    [
        ("fetch_turn", {"turn_id": uuid4()}),
        ("query_turns", {}),
        ("latest_turn", {"session_id": "session-1"}),
        (
            "latest_turn_per_harness_kind",
            {"session_id": "session-1", "harness_kind": HarnessKind.CLAUDE},
        ),
        ("delete_by_session_id", {"session_id": "session-1"}),
    ],
)
async def test_other_dao_calls_never_publish(method, kwargs):
    project_id = uuid4()
    dao = AsyncMock()
    dao.fetch_turn.return_value = None
    dao.query_turns.return_value = []
    dao.latest_turn.return_value = None
    dao.latest_turn_per_harness_kind.return_value = None
    dao.delete_by_session_id.return_value = 0
    service = SessionTurnsService(turns_dao=dao)

    with (
        patch(
            "oss.src.core.sessions.turns.service.publish_turn_started",
            new_callable=AsyncMock,
        ) as started_mock,
        patch(
            "oss.src.core.sessions.turns.service.publish_turn_ended",
            new_callable=AsyncMock,
        ) as ended_mock,
    ):
        await getattr(service, method)(project_id=project_id, **kwargs)

    started_mock.assert_not_awaited()
    ended_mock.assert_not_awaited()
