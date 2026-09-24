"""Unit tests for the channels inbox dispatcher.

Stubs `ChannelsService` and the invoke path (no DB, no broker, no runner) and
pins the chain's branches: unconfigured space, unaddressed message, grant
refusal, the happy path (STARTED before invoke, exact `turn_id` echoed),
retry-on-refusal, concurrent-claim loss, and two-agents independence.
"""

from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelCapabilities,
    ChannelConnection,
    ChannelDeliveryState,
    ChannelEffectivePolicy,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelInboxTriggerFlags,
    ChannelOutboxEvent,
    ChannelOutboxEventData,
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
from oss.src.core.channels.render.render import FAILED_START_TEXT
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


def _make_connection(*, channel="mock"):
    return ChannelConnection(
        id=uuid4(), slug="c", channel=channel, external_key=uuid4()
    )


def _make_outbox_event(
    *,
    thread_id,
    connection_id,
    state=ChannelDeliveryState.CREATED,
):
    return ChannelOutboxEvent(
        id=uuid4(),
        connection_id=connection_id,
        thread_id=thread_id,
        turn_id="t-1",
        key=uuid4(),
        state=state,
        data=ChannelOutboxEventData(),
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
    capabilities=None,
):
    service = MagicMock()
    service.query_inbox_events = AsyncMock(return_value=query_inbox_events_result or [])
    service.resolve = AsyncMock(return_value=resolution)
    service.fetch_connection = AsyncMock(return_value=_make_connection())
    # No command sigil, no backfill support: the no-command/no-backfill
    # branches these tests were written against stay a no-op by default.
    service.fetch_capabilities = AsyncMock(
        return_value=capabilities or ChannelCapabilities(channel="mock")
    )
    service.compose_input = AsyncMock(
        return_value=turn_input or ChannelTurnInput(content=[])
    )
    service.open_turn = AsyncMock(return_value=trigger)
    service.settle_turn = AsyncMock()
    return service


class TestRouting:
    async def test_unconfigured_space_writes_nothing_beyond_the_log(self):
        """`resolve` returning None (default-deny) — no compose_input,
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
        None — same code path as the unconfigured-space case from the
        worker's point of view, which is the point."""

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
        agent at all — the worker cannot and must not distinguish."""

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

    async def test_action_kind_event_dispatches_exactly_like_a_message(self):
        """No special-case branch for ACTION anywhere in the dispatcher --
        it is an ordinary addressing event, same as MESSAGE."""

        event = _make_event()
        event.kind = ChannelEventKind.ACTION
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )

        invoked = {}

        async def fake_invoke(*, project_id, resolution, turn_input, turn_id):
            invoked["called"] = True
            return turn_id

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=fake_invoke
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert invoked.get("called") is True
        channels_service.settle_turn.assert_awaited_once()

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

    async def test_capabilities_are_fetched_for_the_event_s_own_connection(self):
        """A per-connection capability override is only reachable if the
        fetched connection travels with the call, not just its channel key."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )
        connection = _make_connection(channel="slack")
        channels_service.fetch_connection = AsyncMock(return_value=connection)

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.fetch_capabilities.assert_any_await(
            channel="slack", connection=connection
        )


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
        channels_service.fetch_connection = AsyncMock(return_value=_make_connection())
        channels_service.fetch_capabilities = AsyncMock(
            return_value=ChannelCapabilities(channel="mock")
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


def _command_capabilities(*, sigil="!", commands=None):
    from oss.src.core.channels.dtos import ChannelCapabilities

    return ChannelCapabilities.model_validate(
        {
            "channel": "mock",
            "addressing": {
                "sigils": {"agent": "~", "command": sigil},
                "commands": {"native": True, "in_conversation": False},
            },
            "commands": commands if commands is not None else ["new", "sessions"],
        }
    )


class TestCommandWiring:
    """`dispatch_event` parses the command sigil after `resolve()` (which
    already ran the agent sigil) and, on a match, never opens a turn."""

    async def test_matched_command_dispatches_and_opens_no_turn(self):
        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "~triage !sessions"}]
        resolution = _make_resolution()

        channels_service = _make_channels_service(
            resolution=resolution, capabilities=_command_capabilities()
        )
        channels_service.query_threads = AsyncMock(return_value=[resolution.thread])
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.query_threads.assert_awaited_once()
        channels_service.compose_input.assert_not_called()
        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()

    async def test_agent_sigil_resolves_thread_before_command_sigil_is_read(self):
        """`~triage !stop` — the agent sigil already picked the thread inside
        resolve() (stubbed here), and the command sigil is read from the same
        message afterwards; both reach their own handler off one event."""

        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "~triage !new"}]
        resolution = _make_resolution()

        channels_service = _make_channels_service(
            resolution=resolution, capabilities=_command_capabilities()
        )
        channels_service.close_thread = AsyncMock(return_value=resolution.thread)

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock()
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        # resolve() (the agent-sigil parse) ran; close_thread (the
        # command-sigil handler) ran after it, against that same resolution.
        channels_service.resolve.assert_awaited_once()
        channels_service.close_thread.assert_awaited_once()
        _, close_kwargs = channels_service.close_thread.call_args
        assert close_kwargs["thread_id"] == resolution.thread.id

    async def test_undeclared_command_name_is_not_parsed_and_falls_through_to_a_turn(
        self,
    ):
        """`capabilities.commands` omits `sessions`: `parse_command` itself
        never matches an undeclared command name, so this event carries no
        parsed command as far as the worker sees, and the message runs as an
        ordinary turn instead of vanishing."""

        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "~triage !sessions"}]
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        channels_service = _make_channels_service(
            resolution=resolution,
            trigger=trigger,
            capabilities=_command_capabilities(commands=["new"]),
        )
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.open_turn.assert_awaited_once()
        invoke_fn.assert_awaited_once()  # no command matched -> ordinary turn

    async def test_no_command_sigil_falls_through_to_the_ordinary_turn(self):
        event = _make_event()  # "~triage do it" — no "!" anywhere
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        channels_service = _make_channels_service(
            resolution=resolution,
            trigger=trigger,
            capabilities=_command_capabilities(),
        )
        invoke_fn = AsyncMock(return_value="run-1")

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.open_turn.assert_awaited_once()
        invoke_fn.assert_awaited_once()

    async def test_a_rejected_command_is_logged_not_a_turn_and_not_silent(self, caplog):
        """`!use` with a malformed id: `dispatch_command` raises
        `CommandArgumentInvalid` — caught, logged (the addressing event's own
        row is the record of the attempt), and no turn opens."""

        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "~triage !use:nope"}]
        resolution = _make_resolution()

        channels_service = _make_channels_service(
            resolution=resolution,
            capabilities=_command_capabilities(commands=["use"]),
        )
        invoke_fn = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        with caplog.at_level("INFO"):
            await dispatcher.dispatch_event(
                project_id=uuid4(), connection_id=event.connection_id, event=event
            )

        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()
        assert any("rejected" in record.message for record in caplog.records)


class TestCommandAcknowledgment:
    """Live QA 2026-09-23: `!new` closed the thread and posted nothing, and in
    a channel thread the user's next unmentioned message was then ignored."""

    def _wired(self, *, resolution, capabilities):
        channels_service = _make_channels_service(
            resolution=resolution, capabilities=capabilities
        )
        channels_service.close_thread = AsyncMock(return_value=resolution.thread)
        channels_service.query_threads = AsyncMock(return_value=[resolution.thread])
        dao = MagicMock()
        dao.create_thread = AsyncMock()
        dao.fetch_outbox_event_by_key = AsyncMock(return_value=None)
        dao.record_outbox_event = AsyncMock(
            side_effect=lambda *, project_id, event: _make_outbox_event(
                thread_id=event.thread_id, connection_id=event.connection_id
            )
        )
        dao.transition_outbox_event = AsyncMock()
        channels_service.channels_dao = dao
        adapter = MagicMock()
        adapter.post_message = AsyncMock(return_value={"channel": "C1", "ts": "1.2"})
        channels_service.adapter_registry.get = MagicMock(return_value=adapter)
        return channels_service, dao, adapter

    async def test_new_opens_a_fresh_active_thread_and_acknowledges(self):
        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "!new"}]
        resolution = _make_resolution()
        channels_service, dao, adapter = self._wired(
            resolution=resolution, capabilities=_command_capabilities()
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock()
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.close_thread.assert_awaited_once()
        dao.create_thread.assert_awaited_once()
        created = dao.create_thread.call_args.kwargs["thread"]
        assert created.space_id == resolution.thread.space_id
        assert created.agent_id == resolution.thread.agent_id
        assert created.external_key == resolution.thread.external_key
        assert created.session_id != resolution.thread.session_id
        assert created.flags.is_active is True
        adapter.post_message.assert_awaited_once()
        posted = adapter.post_message.call_args.kwargs["content"]
        assert posted[0]["text"] == "Started a new conversation."
        channels_service.open_turn.assert_not_called()

    async def test_rejected_command_is_answered_not_silent(self):
        event = _make_event()
        event.data.processed.content = [{"type": "text", "text": "!use:nope"}]
        resolution = _make_resolution()
        channels_service, _, adapter = self._wired(
            resolution=resolution,
            capabilities=_command_capabilities(commands=["use"]),
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock()
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        posted = adapter.post_message.call_args.kwargs["content"]
        assert "!use:<id>" in posted[0]["text"]
        channels_service.open_turn.assert_not_called()


class TestBackfillWiring:
    """`dispatch_event` runs backfill after `resolve()` and before
    `compose_input`, guarded by the space's own flag."""

    async def test_already_backfilled_space_skips_backfill_entirely(self):
        event = _make_event()
        resolution = _make_resolution()  # is_backfilled=True by default
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )
        channels_service.fetch_connection = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        # called once for the capability fetch; backfill's own fetch never runs
        channels_service.fetch_connection.assert_awaited_once()

    async def test_unbackfilled_space_runs_backfill_before_compose_input(self):
        event = _make_event()
        resolution = _make_resolution()
        resolution.space.flags.is_backfilled = False
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        calls = []

        channels_service = _make_channels_service(
            resolution=resolution,
            trigger=trigger,
            capabilities=ChannelCapabilities.model_validate(
                {"channel": "mock", "fill": {"backfill": {"supported": True}}}
            ),
        )

        async def _compose_input(**kwargs):
            calls.append("compose_input")
            return ChannelTurnInput(content=[])

        channels_service.compose_input = AsyncMock(side_effect=_compose_input)

        connection = _make_connection(channel="mock")
        channels_service.fetch_connection = AsyncMock(return_value=connection)

        adapter = MagicMock()

        async def _fetch_history(**kwargs):
            calls.append("fetch_history")
            return []

        adapter.fetch_history = AsyncMock(side_effect=_fetch_history)
        channels_service.adapter_registry = MagicMock()
        channels_service.adapter_registry.get = MagicMock(return_value=adapter)
        channels_service.channels_dao = MagicMock()
        channels_service.channels_dao.mark_space_backfilled = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert calls == ["fetch_history", "compose_input"]
        channels_service.channels_dao.mark_space_backfilled.assert_awaited_once()
        # an empty-but-answered fetch still sets the flag the dispatcher reads
        assert resolution.space.flags.is_backfilled is True

    async def test_backfill_refusal_leaves_the_flag_false_and_the_turn_proceeds(self):
        """A refusal is a per-space capability fact, not this turn's outcome:
        it never reaches the trigger row (none exists yet), and the turn is
        still composed and invoked from whatever the live event carries."""

        event = _make_event()
        resolution = _make_resolution()
        resolution.space.flags.is_backfilled = False
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        channels_service = _make_channels_service(
            resolution=resolution,
            trigger=trigger,
            capabilities=ChannelCapabilities.model_validate(
                {"channel": "mock", "fill": {"backfill": {"supported": True}}}
            ),
        )

        connection = _make_connection(channel="mock")
        channels_service.fetch_connection = AsyncMock(return_value=connection)

        adapter = MagicMock()
        adapter.fetch_history = AsyncMock(side_effect=Exception("denied"))
        channels_service.adapter_registry = MagicMock()
        channels_service.adapter_registry.get = MagicMock(return_value=adapter)
        channels_service.channels_dao = MagicMock()
        channels_service.channels_dao.mark_space_backfilled = AsyncMock()

        invoke_fn = AsyncMock(return_value="r-1")
        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.channels_dao.mark_space_backfilled.assert_not_called()
        assert resolution.space.flags.is_backfilled is False
        # the live message still gets answered despite the refused backfill
        channels_service.open_turn.assert_awaited_once()
        invoke_fn.assert_awaited_once()

    async def test_backfill_not_supported_is_never_attempted(self):
        event = _make_event()
        resolution = _make_resolution()
        resolution.space.flags.is_backfilled = False
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)

        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )  # default capabilities: fill.backfill.supported == False
        channels_service.fetch_connection = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        # called once for the capability fetch; backfill's own fetch never runs
        channels_service.fetch_connection.assert_awaited_once()
        assert resolution.space.flags.is_backfilled is False
        channels_service.settle_turn.assert_awaited_once()  # the ordinary turn still runs


class TestIdentityAttribution:
    """Identity links are wired into the invoke: the credential is the
    invoking user's, not the agent's creator. These pin that the linked
    account wins, and that the fallback survives when identity is absent or
    the sender is unlinked.
    """

    @staticmethod
    def _capabilities():
        from oss.src.core.channels.dtos import (
            ChannelCapabilities,
            ChannelIdentity,
            ChannelKeyGrain,
        )

        return ChannelCapabilities(
            channel="slack",
            identity=ChannelIdentity(
                scope="workspace",
                stable=True,
                keys={
                    ChannelKeyGrain.SPACE: ["team", "channel"],
                    ChannelKeyGrain.THREAD: ["team", "channel", "thread_ts"],
                },
            ),
        )

    def _wire(self, *, link, resolution, trigger):
        channels_service = _make_channels_service(
            resolution=resolution, trigger=trigger
        )
        channels_service.fetch_connection = AsyncMock(
            return_value=_make_connection(channel="slack")
        )
        channels_service.fetch_capabilities = AsyncMock(
            return_value=self._capabilities()
        )
        identity_service = MagicMock()
        identity_service.resolve_link = AsyncMock(return_value=link)
        return channels_service, identity_service

    async def test_linked_sender_runs_as_the_linked_account(self):
        resolution = _make_resolution()
        trigger = _make_trigger()
        linked_user_id = uuid4()
        link = MagicMock()
        link.user_id = linked_user_id

        channels_service, identity_service = self._wire(
            link=link, resolution=resolution, trigger=trigger
        )
        invoke_fn = AsyncMock()
        event = _make_event()

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            identity_service=identity_service,
            invoke_fn=invoke_fn,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert invoke_fn.await_args.kwargs["user_id"] == linked_user_id
        assert linked_user_id != resolution.agent.created_by_id

    async def test_identity_lookup_fetches_capabilities_for_the_connection(self):
        """The identity lookup's own capability fetch must carry the same
        connection the identity link is resolved against, not just its
        channel key."""

        resolution = _make_resolution()
        link = MagicMock()
        link.user_id = uuid4()
        channels_service, identity_service = self._wire(
            link=link, resolution=resolution, trigger=_make_trigger()
        )
        connection = await channels_service.fetch_connection(
            project_id=uuid4(), connection_id=uuid4()
        )
        event = _make_event()

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            identity_service=identity_service,
            invoke_fn=AsyncMock(),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.fetch_capabilities.assert_any_await(
            channel="slack", connection=connection
        )

    async def test_scope_id_comes_from_the_declared_space_key_not_the_scope_name(self):
        """Slack declares scope "workspace" but locates by "team": composing
        the key off the scope's own name would silently key on None."""

        resolution = _make_resolution()
        link = MagicMock()
        link.user_id = uuid4()
        channels_service, identity_service = self._wire(
            link=link, resolution=resolution, trigger=_make_trigger()
        )
        event = _make_event()

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            identity_service=identity_service,
            invoke_fn=AsyncMock(),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        composed_key = identity_service.resolve_link.await_args.kwargs[
            "external_user_key"
        ]
        assert "T1" in composed_key  # the team id, from locator["team"]
        assert "U1" in composed_key  # the platform user

    async def test_unlinked_sender_falls_back_to_the_agent_creator(self):
        resolution = _make_resolution()
        channels_service, identity_service = self._wire(
            link=None, resolution=resolution, trigger=_make_trigger()
        )
        invoke_fn = AsyncMock()
        event = _make_event()

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            identity_service=identity_service,
            invoke_fn=invoke_fn,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        # no user_id kwarg at all: the invoke path applies its own fallback
        assert "user_id" not in invoke_fn.await_args.kwargs

    async def test_no_identity_service_keeps_the_pre_c2_signature(self):
        """A dispatcher built without identity must not pass user_id — every
        injected invoke_fn predating C2 takes exactly four arguments."""

        channels_service = _make_channels_service(
            resolution=_make_resolution(), trigger=_make_trigger()
        )
        invoke_fn = AsyncMock()
        event = _make_event()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert "user_id" not in invoke_fn.await_args.kwargs


class TestApprovalAnswer:
    """A resolution that names a parked interaction is an answer, not a prompt."""

    def _answering_resolution(self):
        resolution = _make_resolution()
        return resolution.model_copy(
            update={
                "answered_interaction_id": "11111111-1111-4111-8111-111111111111",
                "resolved_token": "approve",
                "resolved_choice": "Approve",
            }
        )

    @pytest.mark.parametrize(
        "token,approved,label",
        [
            ("approve", True, "Approve"),
            ("11111111-1111-4111-8111-111111111111:approve", True, "Approve"),
            ("deny", False, "Deny"),
            ("11111111-1111-4111-8111-111111111111:deny", False, "Deny"),
        ],
    )
    async def test_the_answer_reaches_the_respond_path_and_opens_no_turn(
        self, token, approved, label
    ):
        event = _make_event()
        resolution = self._answering_resolution().model_copy(
            update={"resolved_token": token, "resolved_choice": label}
        )
        channels_service = _make_channels_service(resolution=resolution)
        channels_service.set_pending_choice = AsyncMock()
        invoke_fn = AsyncMock()
        respond_fn = AsyncMock()
        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=invoke_fn,
            respond_interaction_fn=respond_fn,
        )

        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        respond_fn.assert_awaited_once()
        kwargs = respond_fn.call_args.kwargs
        assert str(kwargs["interaction_id"]) == "11111111-1111-4111-8111-111111111111"
        # the decision only: a `message` would reach the agent as the user
        # saying the button label
        assert kwargs["answer"] == {"approved": approved}
        # answered once: the pending choice is cleared so a second click is inert
        channels_service.set_pending_choice.assert_awaited_once()
        assert (
            channels_service.set_pending_choice.call_args.kwargs["pending_choice"]
            is None
        )
        channels_service.compose_input.assert_not_called()
        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()

    async def test_without_a_respond_path_the_click_is_dropped_not_run(self):
        event = _make_event()
        channels_service = _make_channels_service(
            resolution=self._answering_resolution()
        )
        invoke_fn = AsyncMock()
        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )

        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.open_turn.assert_not_called()
        invoke_fn.assert_not_called()


class TestFailedStartNotification:
    """QA finding (2026-09-22): an invoke that failed before any session event
    settled the trigger FAILED and told the chat nothing — the sessions outbox
    only renders failures for turns that started. The dispatcher now posts a
    fixed failed-start notice itself, idempotent on the turn's outbox key."""

    def _service_with_delivery(self, *, resolution, trigger, existing_event=None):
        service = _make_channels_service(resolution=resolution, trigger=trigger)
        service.channels_dao.fetch_outbox_event_by_key = AsyncMock(
            return_value=existing_event
        )
        created = _make_outbox_event(
            thread_id=resolution.thread.id,
            connection_id=resolution.space.connection_id,
        )
        service.channels_dao.record_outbox_event = AsyncMock(return_value=created)
        service.channels_dao.transition_outbox_event = AsyncMock()
        self.adapter = MagicMock()
        self.adapter.post_message = AsyncMock(return_value={"chat": "1", "ts": "9.9"})
        service.adapter_registry.get = MagicMock(return_value=self.adapter)
        return service

    async def test_invoke_failure_posts_a_failed_start_notice(self):
        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=RuntimeError("boom")),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        self.adapter.post_message.assert_awaited_once()
        _, post_kwargs = self.adapter.post_message.call_args
        assert post_kwargs["content"][0]["text"] == FAILED_START_TEXT
        # never the exception text
        assert "boom" not in post_kwargs["content"][0]["text"]

        channels_service.channels_dao.transition_outbox_event.assert_awaited_once()
        _, tr_kwargs = channels_service.channels_dao.transition_outbox_event.call_args
        assert tr_kwargs["state"] is ChannelDeliveryState.SENT

    async def test_notice_is_deduplicated_on_redelivery(self):
        """A row already SENT for this turn's item 0 means the notice (or the
        turn's own indicator) went out — a redelivered task posts nothing."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        sent = _make_outbox_event(
            thread_id=resolution.thread.id,
            connection_id=resolution.space.connection_id,
            state=ChannelDeliveryState.SENT,
        )
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger, existing_event=sent
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=RuntimeError("boom")),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        self.adapter.post_message.assert_not_called()
        channels_service.channels_dao.record_outbox_event.assert_not_called()

    async def test_notice_delivery_failure_never_raises(self):
        """The trigger is already settled FAILED; a notice that cannot be
        delivered is logged, never re-raised into the task (which would
        re-invoke the turn)."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )
        self.adapter.post_message = AsyncMock(side_effect=RuntimeError("slack down"))

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=RuntimeError("boom")),
        )
        # must not raise
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.FAILED

    async def test_successful_invoke_posts_no_notice(self):
        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(return_value="run-1"),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        self.adapter.post_message.assert_not_called()

    async def test_a_redelivered_event_posts_the_notice_once(self):
        """A retried task finds the trigger already claimed (open_turn -> None)
        and neither re-invokes nor posts: one failed trigger, one notice."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )
        channels_service.open_turn = AsyncMock(side_effect=[trigger, None])
        invoke_fn = AsyncMock(side_effect=RuntimeError("boom"))

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=invoke_fn
        )
        for _ in range(2):
            await dispatcher.dispatch_event(
                project_id=uuid4(), connection_id=event.connection_id, event=event
            )

        invoke_fn.assert_awaited_once()
        self.adapter.post_message.assert_awaited_once()

    async def test_a_turn_whose_indicator_landed_gets_no_notice(self):
        """A row with a receipt belongs to a turn that did start: the sessions
        outbox owns it and tells the chat how the turn ended."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        indicator = _make_outbox_event(
            thread_id=resolution.thread.id,
            connection_id=resolution.space.connection_id,
            state=ChannelDeliveryState.FAILED,
        )
        indicator.data = ChannelOutboxEventData(external_locator={"ts": "1.1"})
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger, existing_event=indicator
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=RuntimeError("boom")),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        self.adapter.post_message.assert_not_called()

    @pytest.mark.parametrize("channel", ["slack", "telegram", "agenta"])
    async def test_the_notice_reaches_every_channel_in_its_thread(self, channel):
        """Channel-agnostic: the notice goes through the connection's own
        adapter, to the thread's locator, with the same fixed text."""

        event = _make_event()
        resolution = _make_resolution()
        resolution.thread.data.external_locator = {"chat": "42"}
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )
        channels_service.fetch_connection = AsyncMock(
            return_value=_make_connection(channel=channel)
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=RuntimeError("secret detail")),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.adapter_registry.get.assert_called_with(channel)
        _, post_kwargs = self.adapter.post_message.call_args
        assert post_kwargs["locator"] == {"chat": "42"}
        assert [part["text"] for part in post_kwargs["content"]] == [FAILED_START_TEXT]

    async def test_the_default_invoke_treats_an_error_first_frame_as_a_failed_start(
        self,
    ):
        """The workflows call runs in strict-start mode, so an explicit error
        as the first frame raises (and so notifies) instead of settling a run
        that will never emit a turn event."""

        event = _make_event()
        resolution = _make_resolution()
        trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
        channels_service = self._service_with_delivery(
            resolution=resolution, trigger=trigger
        )
        workflows_service = MagicMock()
        workflows_service.invoke_workflow_detached = AsyncMock(
            side_effect=RuntimeError("Workflow service rejected detached start")
        )

        dispatcher = InboxDispatcher(
            channels_service=channels_service, workflows_service=workflows_service
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        _, invoke_kwargs = workflows_service.invoke_workflow_detached.call_args
        assert invoke_kwargs["strict_start"] is True
        self.adapter.post_message.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.FAILED
