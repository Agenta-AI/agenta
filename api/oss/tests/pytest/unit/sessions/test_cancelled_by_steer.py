"""A turn a Steer cancelled is told apart from a turn the user stopped.

The runner ends both the same way, so the cancel command is the only witness. A Steer's own
cancel carries the key `steer:{input id}`. A Steer that bound to a Stop already open keeps that
Stop's key: the user did press Stop, so that turn still reads as stopped.
"""

from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandState,
)
from oss.src.core.sessions.commands.service import SessionCommandsService

_PROJECT = uuid4()
_SESSION = "session-steer-cause"
_TURN = "turn-resumed"


class _OneCancelDAO:
    def __init__(self, command: Optional[SessionCommand]) -> None:
        self.command = command

    async def fetch_turn_cancel(self, *, project_id, session_id, target_turn_id):
        if self.command and self.command.target_turn_id == target_turn_id:
            return self.command
        return None


def _cancel(*, idempotency_key: Optional[str], data: Optional[dict]) -> SessionCommand:
    return SessionCommand(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        kind=SessionCommandKind.cancel,
        target_turn_id=_TURN,
        state=SessionCommandState.applied,
        idempotency_key=idempotency_key,
        data=data,
    )


def _service(command: Optional[SessionCommand]) -> SessionCommandsService:
    return SessionCommandsService(
        commands_dao=_OneCancelDAO(command),
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=None,
    )


async def _steered(command: Optional[SessionCommand]) -> bool:
    return await _service(command).cancelled_by_steer(
        project_id=_PROJECT, session_id=_SESSION, execution_id=_TURN
    )


@pytest.mark.asyncio
async def test_a_steers_own_cancel_is_a_steer():
    input_id = str(uuid4())
    command = _cancel(
        idempotency_key=f"steer:{input_id}", data={"steer_input_id": input_id}
    )
    assert await _steered(command) is True


@pytest.mark.asyncio
async def test_a_steer_bound_to_an_open_stop_is_still_a_stop():
    command = _cancel(
        idempotency_key="stop-click-1", data={"steer_input_id": str(uuid4())}
    )
    assert await _steered(command) is False


@pytest.mark.asyncio
async def test_a_plain_stop_is_a_stop():
    assert await _steered(_cancel(idempotency_key="stop-click-1", data=None)) is False


@pytest.mark.asyncio
async def test_no_cancel_command_is_not_a_steer():
    assert await _steered(None) is False
