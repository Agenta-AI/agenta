"""A channel turn runs as the installation (the binding), with the linked user's role
when the sender is linked, else the binding creator's (today's authority, M2)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from oss.src.core.access.dtos import PrincipalKind
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from .turn_harness import InMemoryChannels


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
        channels_service=channels.service, invoke_fn=recorder.invoke
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
        channels_service=service, respond_interaction_fn=respond
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
