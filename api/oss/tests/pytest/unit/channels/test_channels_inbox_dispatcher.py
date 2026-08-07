"""Unit tests for the channels inbox dispatcher (WP4, `specs-wp4.md`).

Stubs `ChannelsService` and the invoke path (no DB, no broker, no runner) and
pins the chain's branches: unconfigured space, unaddressed message, grant
refusal, the happy path (STARTED before invoke, exact `turn_id` echoed),
retry-on-refusal, concurrent-claim loss, and two-agents independence.
"""

from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelEffectivePolicy,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelInboxTriggerFlags,
    ChannelPolicyLevel,
    ChannelResolution,
    ChannelSessionScope,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceFlags,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
    ChannelTriggerKind,
    ChannelTriggerState,
    ChannelTurnInput,
)
import oss.src.tasks.asyncio.channels.inbox as inbox_module
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher, TurnRefused


def _make_event(*, event_id=None, connection_id=None):
    return ChannelInboxEvent(
        id=event_id or uuid4(),
        connection_id=connection_id or uuid4(),
        external_id="evt-1",
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        space_id=None,
        data=ChannelInboxEventData(
            external_locator={"team": "T1", "channel": "C1"},
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": "~triage do it"}],
                sender={"id": "U1"},
            ),
        ),
    )


def _make_resolution(*, agent_id=None, thread_id=None, space_id=None):
    agent_id = agent_id or uuid4()
    space_id = space_id or uuid4()
    return ChannelResolution(
        space=ChannelSpace(
            id=space_id,
            connection_id=uuid4(),
            kind=ChannelSpaceKind.GROUP,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator={"team": "T1", "channel": "C1"}),
            flags=ChannelSpaceFlags(is_backfilled=True),
        ),
        agent=ChannelAgent(
            id=agent_id,
            slug="triage",
            connection_id=uuid4(),
            created_by_id=uuid4(),
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid4())}}
            ),
            flags=ChannelAgentFlags(),
        ),
        thread=ChannelThread(
            id=thread_id or uuid4(),
            space_id=space_id,
            agent_id=agent_id,
            external_key=uuid4(),
            session_id="sess-1",
            data=ChannelThreadData(),
            flags=ChannelThreadFlags(),
        ),
        policy=ChannelEffectivePolicy(
            triggers={ChannelTriggerKind.MENTION},
            session_scope=ChannelSessionScope.THREAD,
            backfill=True,
            forwardfill=True,
            decided_by={
                "triggers": ChannelPolicyLevel.CHANNEL,
                "session_scope": ChannelPolicyLevel.CHANNEL,
                "backfill": ChannelPolicyLevel.CHANNEL,
                "forwardfill": ChannelPolicyLevel.CHANNEL,
            },
        ),
    )


def _make_trigger(*, trigger_id=None, thread_id=None, event_id=None, turn_id="t-1"):
    return ChannelInboxTrigger(
        id=trigger_id or uuid4(),
        thread_id=thread_id or uuid4(),
        event_id=event_id or uuid4(),
        turn_id=turn_id,
        state=ChannelTriggerState.STARTED,
        flags=ChannelInboxTriggerFlags(),
    )


def _make_channels_service(
    *,
    resolution=None,
    turn_input=None,
    trigger=None,
    query_inbox_events_result=None,
):
    service = MagicMock()
    service.query_inbox_events = AsyncMock(return_value=query_inbox_events_result or [])
    service.resolve = AsyncMock(return_value=resolution)
    service.compose_input = AsyncMock(
        return_value=turn_input or ChannelTurnInput(content=[])
    )
    service.open_turn = AsyncMock(return_value=trigger)
    service.settle_turn = AsyncMock()
    return service


class TestRouting:
    async def test_unconfigured_space_writes_nothing_beyond_the_log(self):
        """`resolve` returning None (default-deny, per WP1) — no compose_input,
        no open_turn, no invoke call."""

        event = _make_event()
        channels_service = _make_channels_service(resolution=None)
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.compose_input.assert_not_called()
        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()

    async def test_unaddressed_message_writes_nothing_beyond_the_log(self):
        """No sigil, no default grant, no default agent -> resolve() returns
        None (entities.md §8) — same code path as the unconfigured-space case
        from the worker's point of view, which is the point (D9)."""

        event = _make_event()
        channels_service = _make_channels_service(resolution=None)
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()

    async def test_grant_refusal_is_silent_no_trigger_row(self):
        """`resolve` refuses identically for grants-not-among-them as for no
        agent at all (D17) — the worker cannot and must not distinguish."""

        event = _make_event()
        channels_service = _make_channels_service(resolution=None)
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()


class TestBacklogAndInvoke:
    async def test_happy_path_invokes_with_minted_turn_id_and_settles(self):
        """A routed event addressing a configured agent produces a running
        turn on the right session, with the exact minted `turn_id` passed to
        invoke — no server-side regeneration."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )

        captured = {}

        async def fake_invoke(*, project_id, resolution, turn_input, turn_id):
            captured["turn_id"] = turn_id
            captured["session_id"] = resolution.thread.session_id
            return turn_id

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=fake_invoke
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        # the id passed to open_turn is the exact one passed to invoke
        _, open_turn_kwargs = channels_service.open_turn.call_args
        assert open_turn_kwargs["turn_id"] == captured["turn_id"]
        assert captured["session_id"] == resolution.thread.session_id

        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED
        assert settle_kwargs["trigger_id"] == trigger.id

    async def test_open_turn_called_before_invoke(self):
        """`open_turn` writes the trigger row at STARTED before invoke is
        called — asserted via a fake invoke that raises before returning and
        a call-order sentinel."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        calls = []

        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )

        async def _open_turn(**kwargs):
            calls.append("open_turn")
            return trigger

        channels_service.open_turn = AsyncMock(side_effect=_open_turn)

        async def failing_invoke(**kwargs):
            calls.append("invoke")
            raise RuntimeError("boom")

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=failing_invoke
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert calls == ["open_turn", "invoke"]
        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.FAILED

    async def test_no_trigger_yet_composes_the_whole_log(self):
        """`compose_input` with no prior trigger reads from the beginning —
        delegated entirely to the service; the worker asserts it is called
        with the resolution and the addressing event's id."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )
        invoke_fn = AsyncMock(return_value="run-1")

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        _, compose_kwargs = channels_service.compose_input.call_args
        assert compose_kwargs["resolution"] is resolution
        assert compose_kwargs["event_id"] == event.id


class TestRetryOnRefusal:
    async def test_refused_turn_is_retried_until_accepted(self, monkeypatch):
        """A burst mention to a running agent is retried on refusal and
        settles SETTLED once accepted — never a second trigger row, since
        `open_turn` is called exactly once per addressing."""

        monkeypatch.setattr(inbox_module, "_RETRY_BACKOFF_SECONDS", 0)

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )

        attempts = {"count": 0}

        async def flaky_invoke(**kwargs):
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise TurnRefused()
            return "run-1"

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=flaky_invoke
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert attempts["count"] == 3
        # open_turn (and therefore record_inbox_trigger) is called exactly
        # once for this addressing regardless of how many invoke attempts.
        channels_service.open_turn.assert_awaited_once()
        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED

    async def test_retry_loop_terminates_and_settles_refused(self, monkeypatch):
        """A refusal that never clears settles REFUSED after the bound —
        the retry loop does not spin forever in the test double."""

        monkeypatch.setattr(inbox_module, "_RETRY_BACKOFF_SECONDS", 0)

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )

        always_refused = AsyncMock(side_effect=TurnRefused())

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=always_refused
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert always_refused.await_count == inbox_module._MAX_INVOKE_ATTEMPTS
        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.REFUSED


class TestConcurrency:
    async def test_lost_trigger_claim_never_invokes(self):
        """Two workers racing the same addressing collide on
        `(thread_id, event_id)` in `record_inbox_trigger` (behind
        `open_turn`); the loser gets `None` back and must not invoke."""

        event = _make_event()
        resolution = _make_resolution()
        channels_service = _make_channels_service(resolution=resolution, trigger=None)
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        invoke_fn.assert_not_called()
        channels_service.settle_turn.assert_not_called()


class TestIndependence:
    async def test_two_agents_addressed_in_sequence_are_independent(self):
        """Mentioning `~triage` then `~deploy` in one thread's space produces
        two independent resolutions; `~deploy`'s turn does not touch
        `~triage`'s trigger row or session."""

        space_id = uuid4()

        triage_event = _make_event()
        deploy_event = _make_event()

        triage_resolution = _make_resolution(space_id=space_id)
        deploy_resolution = _make_resolution(space_id=space_id)

        triage_trigger = _make_trigger(
            thread_id=triage_resolution.thread.id, event_id=triage_event.id
        )
        deploy_trigger = _make_trigger(
            thread_id=deploy_resolution.thread.id, event_id=deploy_event.id
        )

        channels_service = MagicMock()
        channels_service.query_inbox_events = AsyncMock(return_value=[])
        channels_service.resolve = AsyncMock(
            side_effect=[triage_resolution, deploy_resolution]
        )
        channels_service.compose_input = AsyncMock(
            return_value=ChannelTurnInput(content=[])
        )
        channels_service.open_turn = AsyncMock(
            side_effect=[triage_trigger, deploy_trigger]
        )
        channels_service.settle_turn = AsyncMock()

        invoke_fn = AsyncMock(return_value="run-x")

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )

        await dispatcher.dispatch_event(
            project_id=uuid4(),
            connection_id=triage_event.connection_id,
            event=triage_event,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(),
            connection_id=deploy_event.connection_id,
            event=deploy_event,
        )

        assert channels_service.open_turn.await_count == 2
        open_turn_calls = channels_service.open_turn.call_args_list
        first_thread = open_turn_calls[0].kwargs["resolution"].thread.id
        second_thread = open_turn_calls[1].kwargs["resolution"].thread.id
        assert first_thread != second_thread

        settle_calls = channels_service.settle_turn.call_args_list
        assert len(settle_calls) == 2
        trigger_ids = {call.kwargs["trigger_id"] for call in settle_calls}
        assert trigger_ids == {triage_trigger.id, deploy_trigger.id}
