import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.sessions.models import PendingInputAdmissionRequest
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
from oss.src.core.sessions.inputs.dtos import (
    PendingInput,
    PendingInputAdmission,
    PendingInputState,
)


class _Inputs:
    def __init__(self, *, project_id, events):
        self.events = events
        self.item = PendingInput(
            id=uuid4(),
            project_id=project_id,
            session_id="session-1",
            content={"message": "steer now"},
            position=0,
            state=PendingInputState.pending,
            policy="steer",
            idempotency_key="steer-1",
            request_fingerprint="a" * 64,
            created_by_id=uuid4(),
        )

    async def admit(self, **_kwargs):
        self.events.append("saved")
        return PendingInputAdmission(
            action="pending",
            input=self.item,
            execution_id="execution-1",
        )


class _FailedStop:
    def __init__(self, events):
        self.events = events

    async def request_cancel(self, **kwargs):
        self.events.append("stop")
        assert kwargs["steer_input_id"] is not None
        raise RuntimeError("runner unavailable")


@pytest.mark.asyncio
async def test_steer_is_saved_before_stop_and_stays_visible_when_stop_fails(
    monkeypatch,
):
    project_id = uuid4()
    user_id = uuid4()
    events = []
    inputs = _Inputs(project_id=project_id, events=events)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        lambda **_kwargs: _allowed(),
    )
    router = SessionControlRouter(
        commands_service=_FailedStop(events),
        inputs_service=inputs,
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=project_id, user_id=user_id),
        headers={"Idempotency-Key": "steer-1"},
    )

    response = await router.admit_session_input(
        request,
        PendingInputAdmissionRequest(
            session_id="session-1",
            content={"message": "steer now"},
            on_busy="steer",
        ),
    )

    assert events == ["saved", "stop"]
    assert response.status_code == 202
    assert json.loads(response.body)["input"]["id"] == str(inputs.item.id)
    assert inputs.item.state == PendingInputState.pending


async def _allowed():
    return True
