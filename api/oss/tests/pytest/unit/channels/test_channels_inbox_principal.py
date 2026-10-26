"""A channel turn runs as the installation (the binding), with the linked user's role
when the sender is linked, else the binding creator's (today's authority, M2)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from oss.src.core.access.dtos import PrincipalKind
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from .turn_harness import InMemoryChannels
from oss.tests.pytest.utils.sharing import NoopRunAdmission


class _Recorder:
    def __init__(self):
        self.calls = []

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        return kwargs["turn_id"]


async def _turn(*, linked_user, external_key="slack:T1:U1"):
    channels = InMemoryChannels()
    recorder = _Recorder()
    dispatcher = InboxDispatcher(
        run_admission=NoopRunAdmission(),
        channels_service=channels.service,
        invoke_fn=recorder.invoke,
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(linked_user, external_key))
    event = channels.store("hello", addressed=True)
    await dispatcher.dispatch_event(
        project_id=channels.project_id,
        connection_id=channels.connection.id,
        event=channels.fetch(event.id),
    )
    return channels, recorder.calls[0]


async def test_linked_slack_user():
    vic = uuid4()
    channels, call = await _turn(linked_user=vic)
    envelope = call["envelope"]
    assert envelope.authority.principal.kind == PrincipalKind.INSTALLATION
    assert envelope.authority.linked_user_id == vic
    assert envelope.authority.project_id == channels.project_id
    assert envelope.sender.user_id == vic
    assert envelope.sender.external_key == "slack:T1:U1"
    assert envelope.context.origin.value == "installation"
    assert envelope.context.origin_id == str(envelope.authority.principal.id)
    assert envelope.context.run_id == call["turn_id"]
    # The acting user passed to the invoke stays the linked user, as today.
    assert call["user_id"] == vic


async def test_unlinked_uses_binding_creator_role():
    channels, call = await _turn(linked_user=None, external_key="slack:T1:U9")
    envelope = call["envelope"]
    # No linked user: the role is the binding creator's (decide reads the record).
    assert envelope.authority.linked_user_id is None
    assert envelope.sender.user_id is None
    assert envelope.sender.external_key == "slack:T1:U9"
    assert "user_id" not in call  # the invoke falls back to the binding creator


async def test_channel_answer_records_installation_approver():
    respond = AsyncMock()
    linked = uuid4()
    binding = uuid4()
    service = SimpleNamespace(
        mark_event_consumed=AsyncMock(),
        set_pending_choice=AsyncMock(),
        dismiss_approval_choices=AsyncMock(),
    )
    dispatcher = InboxDispatcher(
        run_admission=NoopRunAdmission(),
        channels_service=service,
        respond_interaction_fn=respond,
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(linked, "slack:T1:U1"))
    resolution = SimpleNamespace(
        answered_interaction_id=str(uuid4()),
        resolved_token="interaction:approve",
        thread=SimpleNamespace(id=uuid4()),
        agent=SimpleNamespace(id=binding, created_by_id=uuid4()),
    )
    await dispatcher._answer_interaction(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=SimpleNamespace(id=uuid4()),
        resolution=resolution,
    )
    approval = respond.await_args.kwargs["approved_by"]
    assert approval.principal.kind == PrincipalKind.INSTALLATION
    assert approval.principal.id == binding
    assert approval.user_id == linked
    assert approval.external_key == "slack:T1:U1"


async def _admitted_turn(*, admission, monkeypatch):
    """A turn through the real `_invoke_via_workflows_service` (no injected
    invoke_fn), with an allowing recheck and `admission` as the `RunAdmission`."""

    from oss.tests.pytest.utils.principals import register_allowing_access_service

    register_allowing_access_service(monkeypatch)
    channels = InMemoryChannels()
    workflows = SimpleNamespace(
        invoke_workflow_detached=AsyncMock(
            side_effect=lambda **kwargs: SimpleNamespace(run_id=kwargs["run_id"])
        )
    )
    dispatcher = InboxDispatcher(
        run_admission=admission,
        channels_service=channels.service,
        workflows_service=workflows,
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(None, "slack:T1:U1"))
    dispatcher._notify_not_started = AsyncMock()
    settled = []
    original = channels.service.settle_turn

    async def _settle(**kwargs):
        settled.append(kwargs)
        return await original(**kwargs)

    channels.service.settle_turn = _settle
    event = channels.store("hello", addressed=True)
    await dispatcher.dispatch_event(
        project_id=channels.project_id,
        connection_id=channels.connection.id,
        event=channels.fetch(event.id),
    )
    return SimpleNamespace(
        channels=channels,
        workflows=workflows,
        dispatcher=dispatcher,
        settled=settled,
    )


async def test_channel_turn_is_admitted_and_runs_the_admitted_request(monkeypatch):
    from oss.tests.pytest.utils.sharing import RecordingRunAdmission

    admission = RecordingRunAdmission()
    turn = await _admitted_turn(admission=admission, monkeypatch=monkeypatch)

    assert admission.methods() == ["admit_request"]
    admitted = admission.calls[0][1]
    assert admitted["boundary"] == "channel_turn"
    # A channel session is project-visible: only the agent is checked.
    assert admitted["session_id"] is None
    assert admitted["project_id"] == turn.channels.project_id
    assert admitted["envelope"].authority.principal.kind == PrincipalKind.INSTALLATION
    invoked = turn.workflows.invoke_workflow_detached.await_args.kwargs
    assert invoked["request"] is admitted["request"]


async def test_channel_turn_checks_the_resolved_agent(monkeypatch):
    """The bound agent is private: the admission refuses, the trigger settles failed
    with `access_denied`, the chat gets the failed-start reply, nothing is invoked
    and nothing is retried."""

    from oss.src.core.channels.render.render import render_failed_start
    from oss.src.core.access.dtos import Decision, DecisionReason
    from oss.src.core.channels.dtos import ChannelTriggerState
    from oss.src.core.sharing.types import AdmissionDenied
    from oss.tests.pytest.utils.sharing import RecordingRunAdmission

    admission = RecordingRunAdmission(
        refuse=lambda method, kwargs: AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            readable=False,
            boundary=kwargs["boundary"],
        )
    )
    turn = await _admitted_turn(admission=admission, monkeypatch=monkeypatch)

    turn.workflows.invoke_workflow_detached.assert_not_awaited()
    assert len(admission.calls) == 1  # not retried
    assert [s["state"] for s in turn.settled] == [ChannelTriggerState.FAILED]
    assert turn.settled[0]["status"].code == "access_denied"
    assert turn.settled[0]["status"].message == "resource_denied"
    notice = turn.dispatcher._notify_not_started.await_args.kwargs
    assert notice["render"] is render_failed_start
