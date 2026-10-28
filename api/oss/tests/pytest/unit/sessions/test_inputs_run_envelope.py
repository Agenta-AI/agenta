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
from oss.src.core.access.dtos import Decision, DecisionReason
from oss.src.core.sharing.types import AdmissionDenied
from oss.tests.pytest.utils.sharing import NoopRunAdmission, RecordingRunAdmission


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
        run_admission=NoopRunAdmission(),
        command=_command(envelope),
        workflows_service=workflows,
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
            run_admission=NoopRunAdmission(),
            command=_command(None),
            workflows_service=workflows,
        )
    workflows.invoke_workflow_detached.assert_not_awaited()


async def test_principal_lost_access_raises_access_denied(monkeypatch):
    monkeypatch.setattr(access_module, "_access_service", DenyingAccessService())
    workflows = AsyncMock()
    with pytest.raises(AccessDenied):
        await deliver_continue_input(
            run_admission=NoopRunAdmission(),
            command=_command(make_envelope()),
            workflows_service=workflows,
        )
    workflows.invoke_workflow_detached.assert_not_awaited()


async def test_queued_input_is_admitted_on_its_session_and_the_admitted_request_runs(
    _allowing_access_service,
):
    """The queued dispatch admits the command's session and the turn's target
    (`admit_request`) right before the invoke, and invokes the same request object
    (the target it resolved stays on it)."""

    envelope = make_envelope()
    admission = RecordingRunAdmission()
    workflows = AsyncMock()
    command = _command(envelope)
    await deliver_continue_input(
        command=command, workflows_service=workflows, run_admission=admission
    )

    assert admission.methods() == ["admit_request"]
    admitted = admission.calls[0][1]
    assert admitted["boundary"] == "queued_dispatch"
    assert admitted["session_id"] == "s1"
    assert admitted["project_id"] == command.project_id
    assert admitted["envelope"] == envelope
    invoked = workflows.invoke_workflow_detached.await_args.kwargs["request"]
    assert invoked is admitted["request"]


async def test_refused_queued_input_raises_admission_denied_and_runs_nothing(
    _allowing_access_service,
):
    """`AdmissionDenied` is an `AccessDenied`: the transport passes it up and
    `_deliver` settles the command (persisted in
    integration/sharing/test_admission_settlement.py)."""

    admission = RecordingRunAdmission(
        refuse=lambda method, kwargs: AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            readable=True,
            boundary=kwargs["boundary"],
        )
    )
    workflows = AsyncMock()
    with pytest.raises(AccessDenied):
        await deliver_continue_input(
            command=_command(make_envelope()),
            workflows_service=workflows,
            run_admission=admission,
        )
    workflows.invoke_workflow_detached.assert_not_awaited()


async def test_the_delivered_run_uses_the_admitted_session(_allowing_access_service):
    """The stored request body may name another session or none; the run uses the
    session the command was admitted for (M7: the run credential signs it)."""
    command = _command(make_envelope())
    command.data["request"]["session_id"] = "s-other"
    workflows = AsyncMock()
    await deliver_continue_input(
        run_admission=NoopRunAdmission(),
        command=command,
        workflows_service=workflows,
    )
    request = workflows.invoke_workflow_detached.await_args.kwargs["request"]
    assert request.session_id == "s1"
