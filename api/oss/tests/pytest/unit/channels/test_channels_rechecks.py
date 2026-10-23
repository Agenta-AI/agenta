"""A channel turn is rechecked before it is invoked (M2, flow F8)."""

from unittest.mock import AsyncMock
from uuid import uuid4

import oss.src.core.access.service as access_module
from oss.src.core.access.dtos import DecisionReason
from oss.src.core.channels.dtos import ChannelTriggerState
from oss.src.core.channels.queue import ChannelQueueDecision
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher
from oss.tests.pytest.utils.principals import DenyingAccessService

from .turn_harness import InMemoryChannels


class _Recorder:
    def __init__(self):
        self.calls = []

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        return kwargs["turn_id"]


async def test_archived_binding_stops_with_principal_inactive(monkeypatch):
    denying = DenyingAccessService(reason=DecisionReason.PRINCIPAL_INACTIVE)
    monkeypatch.setattr(access_module, "_access_service", denying)
    channels = InMemoryChannels()
    recorder = _Recorder()
    dispatcher = InboxDispatcher(
        channels_service=channels.service, invoke_fn=recorder.invoke
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(None, "slack:T1:U1"))
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

    assert recorder.calls == []  # nothing invoked
    assert settled[0]["state"] == ChannelTriggerState.FAILED
    assert settled[0]["status"].code == "access_denied"
    assert settled[0]["status"].message == "principal_inactive"
    assert denying.required[0]["envelope"].authority.principal.kind.value == (
        "installation"
    )


async def test_busy_thread_queues_with_envelope():
    queued = []

    class _Queue:
        async def admit(self, **kwargs):
            queued.append(kwargs)
            return ChannelQueueDecision.QUEUED

    channels = InMemoryChannels()
    recorder = _Recorder()
    dispatcher = InboxDispatcher(
        channels_service=channels.service,
        invoke_fn=recorder.invoke,
        session_queue=_Queue(),
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(uuid4(), "slack:T1:U1"))
    event = channels.store("follow-up", addressed=True)
    await dispatcher.dispatch_event(
        project_id=channels.project_id,
        connection_id=channels.connection.id,
        event=channels.fetch(event.id),
    )
    assert len(queued) == 1
    envelope = queued[0]["envelope"]
    assert envelope.authority.principal.kind.value == "installation"
    assert envelope.context.origin.value == "installation"
    assert recorder.calls == []


async def test_a_failed_recheck_settles_the_trigger_failed(monkeypatch):
    """A transient error in the recheck (not a denial) settles the claimed trigger
    FAILED, as an invoke failure does, instead of escaping and losing the mention."""

    from oss.tests.pytest.utils.principals import AllowingAccessService

    class _Broken(AllowingAccessService):
        async def require(self, **kwargs):
            raise RuntimeError("redis down")

    monkeypatch.setattr(access_module, "_access_service", _Broken())
    channels = InMemoryChannels()
    recorder = _Recorder()
    dispatcher = InboxDispatcher(
        channels_service=channels.service, invoke_fn=recorder.invoke
    )
    dispatcher._invoking_identity = AsyncMock(return_value=(None, "slack:T1:U1"))
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

    assert recorder.calls == []
    assert settled and settled[-1]["state"] == ChannelTriggerState.FAILED
