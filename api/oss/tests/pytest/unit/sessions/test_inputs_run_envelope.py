"""Queued work runs under its stored envelope and is rechecked at delivery (F5)."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.types import AccessDenied, MissingEnvelope
from oss.src.core.sessions.commands.delivery import deliver_continue_input
from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandState,
)
from oss.tests.pytest.utils.principals import DenyingAccessService, make_envelope


def _command(envelope):
    return SessionCommand(
        id=uuid4(),
        project_id=uuid4(),
        session_id="s1",
        kind=SessionCommandKind.continue_input,
        target_turn_id="exec-1",
        state=SessionCommandState.pending,
        created_by_id=uuid4(),
        data={"request": {"data": {"inputs": {}}}},
        run_envelope=envelope,
    )


async def test_queued_api_send_keeps_api_key(_allowing_access_service):
    envelope = make_envelope(kind="api_key", origin="api", origin_id="k", sender=None)
    workflows = AsyncMock()
    await deliver_continue_input(
        command=_command(envelope), workflows_service=workflows
    )

    required = _allowing_access_service.required[0]
    assert required["envelope"] == envelope
    assert required["action"] == Permission.RUN_SESSIONS
    kwargs = workflows.invoke_workflow_detached.await_args.kwargs
    assert kwargs["envelope"] == envelope and kwargs["run_id"] == "exec-1"


async def test_command_without_envelope_raises_missing_envelope():
    workflows = AsyncMock()
    with pytest.raises(MissingEnvelope):
        await deliver_continue_input(
            command=_command(None), workflows_service=workflows
        )
    workflows.invoke_workflow_detached.assert_not_awaited()


async def test_principal_lost_access_raises_access_denied(monkeypatch):
    monkeypatch.setattr(access_module, "_access_service", DenyingAccessService())
    workflows = AsyncMock()
    with pytest.raises(AccessDenied):
        await deliver_continue_input(
            command=_command(make_envelope()), workflows_service=workflows
        )
    workflows.invoke_workflow_detached.assert_not_awaited()
