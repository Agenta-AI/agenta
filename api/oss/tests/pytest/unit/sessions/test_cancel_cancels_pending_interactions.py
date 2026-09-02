"""Stop cancels the stopped turn's pending interactions.

`requirements.md:149` asks for it and only KILL did it (`delete_session_stream` calls
`cancel_session_pending`). The CANCEL branch did not, so a stopped session kept an approval card
whose buttons answered a turn that no longer existed (#6315).

These pin the router wiring: CANCEL cancels pending gates for the turns it ended, SEND / STEER /
ATTACH do not, and a cancel that ended no turn falls back to the whole session (nothing holds
it, so nothing can ever answer those gates — the same reasoning as kill).
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
)


_SESSION = "session_stop-gates"


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/streams/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool):
    return patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


# The route derives the mode from the PAYLOAD, not from the service's answer, because it must know
# whether this is a cancel before it runs the concurrency check. So each payload below is the real
# inputs x force combination for its mode, not a stub of one.
_CANCEL = SessionStreamCommandRequest(session_id=_SESSION)
_ATTACH = SessionStreamCommandRequest(session_id=_SESSION, force=True)
_SEND = SessionStreamCommandRequest(
    session_id=_SESSION,
    data={"inputs": {"messages": [{"role": "user", "content": "go"}]}},
)
_STEER = SessionStreamCommandRequest(
    session_id=_SESSION,
    force=True,
    data={"inputs": {"messages": [{"role": "user", "content": "go"}]}},
)


async def _post(response: SessionStreamCommandResponse, payload):
    """Drive the route with a stubbed service that returns `response`."""
    service = AsyncMock()
    service.command.return_value = response
    interactions = AsyncMock()
    interactions.cancel_session_pending.return_value = 1
    router = SessionStreamsRouter(service=service, interactions_service=interactions)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(True):
        result = await router.set_session_stream(request=request, payload=payload)
    return result, interactions, project_id, service


@pytest.mark.asyncio
async def test_cancel_cancels_pending_gates_of_the_cancelled_turn():
    result, interactions, project_id, _ = await _post(
        SessionStreamCommandResponse(
            mode=CommandMode.cancel,
            session_id=_SESSION,
            turn_id="turn-1",
            cancelled_turn_ids=["turn-1"],
            detached=True,
        ),
        _CANCEL,
    )

    assert result.mode == CommandMode.cancel
    interactions.cancel_session_pending.assert_awaited_once()
    kwargs = interactions.cancel_session_pending.await_args.kwargs
    assert kwargs["project_id"] == project_id
    assert kwargs["session_id"] == _SESSION
    assert kwargs["only_turn_id"] == "turn-1"


@pytest.mark.asyncio
async def test_cancel_that_ended_no_turn_cancels_every_pending_gate():
    _, interactions, _, _ = await _post(
        SessionStreamCommandResponse(
            mode=CommandMode.cancel,
            session_id=_SESSION,
            cancelled_turn_ids=[],
            detached=True,
        ),
        _CANCEL,
    )

    interactions.cancel_session_pending.assert_awaited_once()
    assert "only_turn_id" not in interactions.cancel_session_pending.await_args.kwargs


@pytest.mark.asyncio
async def test_cancel_scopes_each_call_to_one_turn():
    """`alive` and `running` can be held by different turns during a handover; both die."""
    _, interactions, _, _ = await _post(
        SessionStreamCommandResponse(
            mode=CommandMode.cancel,
            session_id=_SESSION,
            turn_id="turn-1",
            cancelled_turn_ids=["turn-1", "turn-2"],
            detached=True,
        ),
        _CANCEL,
    )

    assert interactions.cancel_session_pending.await_count == 2
    targeted = [
        call.kwargs["only_turn_id"]
        for call in interactions.cancel_session_pending.await_args_list
    ]
    assert targeted == ["turn-1", "turn-2"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode,payload",
    [
        (CommandMode.send, _SEND),
        (CommandMode.steer, _STEER),
        (CommandMode.attach, _ATTACH),
    ],
)
async def test_non_cancel_modes_leave_pending_gates_alone(mode, payload):
    """A steer's own turn-start sweep owns the prior turn's gates. Stop must not duplicate it."""
    _, interactions, _, _ = await _post(
        SessionStreamCommandResponse(
            mode=mode, session_id=_SESSION, turn_id="turn-9", detached=False
        ),
        payload,
    )

    interactions.cancel_session_pending.assert_not_awaited()


# --------------------------------------------------------------------------- #
# The concurrency limit must not refuse a Stop
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_cancel_skips_the_concurrency_limit():
    """A project at its limit must still be able to stop the runs that hold the limit."""
    _, _, _, service = await _post(
        SessionStreamCommandResponse(
            mode=CommandMode.cancel,
            session_id=_SESSION,
            turn_id="turn-1",
            cancelled_turn_ids=["turn-1"],
            detached=True,
        ),
        _CANCEL,
    )

    service.check_runner_concurrency_limit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [_SEND, _STEER, _ATTACH])
async def test_every_other_mode_still_checks_the_concurrency_limit(payload):
    _, _, _, service = await _post(
        SessionStreamCommandResponse(
            mode=CommandMode.send, session_id=_SESSION, turn_id="turn-1"
        ),
        payload,
    )

    service.check_runner_concurrency_limit.assert_awaited_once()
