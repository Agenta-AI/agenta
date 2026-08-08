"""Unit tests for the channels inbox dispatcher.

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
    ChannelCapabilities,
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
    capabilities=None,
):
    service = MagicMock()
    service.query_inbox_events = AsyncMock(return_value=query_inbox_events_result or [])
    service.resolve = AsyncMock(return_value=resolution)
    service.resolve_channel = AsyncMock(return_value="mock")
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
        channels_service.resolve_channel = AsyncMock(return_value="mock")
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
        channels_service.connections_service = MagicMock()
        channels_service.connections_service.get_connection = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.connections_service.get_connection.assert_not_called()

    async def test_unbackfilled_space_runs_backfill_before_compose_input(self):
        from oss.src.core.gateway.connections.dtos import Connection

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

        connection = Connection.model_construct(
            id=uuid4(), slug="c", provider_key="mock", integration_key="mock"
        )
        channels_service.connections_service = MagicMock()
        channels_service.connections_service.get_connection = AsyncMock(
            return_value=connection
        )

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

        from oss.src.core.gateway.connections.dtos import Connection

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

        connection = Connection.model_construct(
            id=uuid4(), slug="c", provider_key="mock", integration_key="mock"
        )
        channels_service.connections_service = MagicMock()
        channels_service.connections_service.get_connection = AsyncMock(
            return_value=connection
        )

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
        channels_service.connections_service = MagicMock()
        channels_service.connections_service.get_connection = AsyncMock()

        dispatcher = InboxDispatcher(
            channels_service=channels_service, invoke_fn=AsyncMock(return_value="r-1")
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        channels_service.connections_service.get_connection.assert_not_called()
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
        channels_service.resolve_channel = AsyncMock(return_value="slack")
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
