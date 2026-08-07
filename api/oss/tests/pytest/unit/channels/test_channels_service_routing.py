"""Unit tests for `ChannelsService.resolve`/`compose_input`/`open_turn`/
`settle_turn` (WP4, `specs-wp4.md`) — the four routing method bodies WP1 left
raising `NotImplementedError` for "the owning package" to fill in
(`tasks-wp1.md`). No DB: a fake DAO stands in for persistence, and the
contract suite's `WellBehavedFakeAdapter` (read-only import, owned by WP2)
stands in for the adapter port so capabilities come from a real declaration
shape rather than a hand-rolled one.
"""

from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelGrant,
    ChannelGrantData,
    ChannelGrantFlags,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelInboxTriggerFlags,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelPolicy,
    ChannelSessionScope,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceFlags,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
    ChannelTriggerState,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.gateway.connections.dtos import Connection, ConnectionProviderKind

from .contract.fakes import WellBehavedFakeAdapter


_LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


def _make_fake_dao():
    dao = MagicMock()
    dao.fetch_space_by_key = AsyncMock(return_value=None)
    dao.fetch_agent_by_slug = AsyncMock(return_value=None)
    dao.fetch_default_grant = AsyncMock(return_value=None)
    dao.fetch_default_agent = AsyncMock(return_value=None)
    dao.fetch_agent = AsyncMock(return_value=None)
    dao.fetch_grant = AsyncMock(return_value=None)
    dao.count_grants = AsyncMock(return_value=0)
    dao.fetch_current_thread = AsyncMock(return_value=None)
    dao.create_thread = AsyncMock()
    dao.fetch_latest_trigger = AsyncMock(return_value=None)
    dao.query_events_since = AsyncMock(return_value=[])
    dao.record_inbox_trigger = AsyncMock()
    dao.transition_inbox_trigger = AsyncMock()
    return dao


def _make_service(*, dao, adapter):
    registry = ChannelAdapterRegistry(adapters={"agenta": adapter})

    connections_service = MagicMock()
    connection = Connection(
        id=uuid4(),
        slug="conn-1",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="T1",
    )
    connections_service.get_connection = AsyncMock(return_value=connection)

    return ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
        connections_service=connections_service,
    )


def _make_event(*, event_id=None, text="~triage do it"):
    return ChannelInboxEvent(
        id=event_id or uuid4(),
        connection_id=uuid4(),
        external_id="evt-1",
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        space_id=None,
        data=ChannelInboxEventData(
            external_locator=_LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": text}],
                sender={"id": "U1"},
            ),
        ),
    )


def _make_space(*, capabilities):
    external_key = compose_external_key(capabilities, ChannelKeyGrain.SPACE, _LOCATOR)
    return ChannelSpace(
        id=uuid4(),
        connection_id=uuid4(),
        kind=ChannelSpaceKind.GROUP,
        external_key=external_key,
        data=ChannelSpaceData(external_locator=_LOCATOR),
        flags=ChannelSpaceFlags(is_backfilled=True),
    )


def _make_agent(*, slug="triage", policy=None):
    return ChannelAgent(
        id=uuid4(),
        slug=slug,
        connection_id=uuid4(),
        created_by_id=uuid4(),
        data=ChannelAgentData(
            references={"workflow_revision": {"id": str(uuid4())}},
            policy=policy,
        ),
        flags=ChannelAgentFlags(),
    )


class TestResolveRouting:
    async def test_unconfigured_space_returns_none(self):
        """Default-deny (architecture.md §5 step 2): `fetch_space_by_key`
        returns None -> `resolve` returns None, no further DAO reads."""

        dao = _make_fake_dao()
        adapter = WellBehavedFakeAdapter()
        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event()

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is None
        dao.fetch_agent_by_slug.assert_not_called()

    async def test_no_sigil_no_default_grant_no_default_agent_returns_none(self):
        """Nobody addressed: sigil absent, no default grant, no default
        agent — resolve() returns None (D9), same as an unconfigured space
        from the caller's point of view."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        space = _make_space(capabilities=capabilities)

        dao = _make_fake_dao()
        dao.fetch_space_by_key = AsyncMock(return_value=space)

        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event(text="no sigil here")

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is None
        dao.create_thread.assert_not_called()

    async def test_sigil_resolves_named_agent_and_creates_thread(self):
        """An explicit sigil names one agent; grants unrestricted (zero rows)
        -> resolve() returns a Resolution with that agent and a new thread."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        space = _make_space(capabilities=capabilities)
        agent = _make_agent(slug="triage")

        dao = _make_fake_dao()
        dao.fetch_space_by_key = AsyncMock(return_value=space)
        dao.fetch_agent_by_slug = AsyncMock(return_value=agent)
        dao.count_grants = AsyncMock(return_value=0)  # unrestricted (§1)

        created_thread = ChannelThread(
            id=uuid4(),
            space_id=space.id,
            agent_id=agent.id,
            external_key=uuid4(),
            session_id="sess-1",
            data=ChannelThreadData(external_locator=_LOCATOR),
            flags=ChannelThreadFlags(),
        )
        dao.create_thread = AsyncMock(return_value=created_thread)

        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event(text="~triage do the thing")

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is not None
        assert result.agent.id == agent.id
        assert result.space.id == space.id
        assert result.thread.id == created_thread.id
        dao.fetch_agent_by_slug.assert_awaited_once()

    async def test_agent_with_grants_not_among_them_refuses_silently(self):
        """D17: an agent with grants rows, addressed in a space not among
        them, refuses exactly like an unknown agent — resolve() returns
        None either way, and the worker cannot tell the two apart."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        space = _make_space(capabilities=capabilities)
        agent = _make_agent(slug="triage")

        dao = _make_fake_dao()
        dao.fetch_space_by_key = AsyncMock(return_value=space)
        dao.fetch_agent_by_slug = AsyncMock(return_value=agent)
        dao.fetch_grant = AsyncMock(return_value=None)  # not granted here
        dao.count_grants = AsyncMock(return_value=3)  # but has grants elsewhere

        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event(text="~triage do the thing")

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is None
        dao.create_thread.assert_not_called()

    async def test_default_grant_used_when_no_sigil(self):
        """No sigil in the message -> the space's default grant names the
        agent (§2.5)."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        space = _make_space(capabilities=capabilities)
        agent = _make_agent(slug="deploy")

        default_grant = ChannelGrant(
            id=uuid4(),
            agent_id=agent.id,
            space_id=space.id,
            data=ChannelGrantData(),
            flags=ChannelGrantFlags(is_default=True),
        )

        dao = _make_fake_dao()
        dao.fetch_space_by_key = AsyncMock(return_value=space)
        dao.fetch_default_grant = AsyncMock(return_value=default_grant)
        dao.fetch_agent = AsyncMock(return_value=agent)
        dao.fetch_grant = AsyncMock(return_value=default_grant)
        dao.create_thread = AsyncMock(
            return_value=ChannelThread(
                id=uuid4(),
                space_id=space.id,
                agent_id=agent.id,
                external_key=uuid4(),
                session_id="sess-1",
                data=ChannelThreadData(),
                flags=ChannelThreadFlags(),
            )
        )

        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event(text="no sigil, just talk")

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is not None
        assert result.agent.id == agent.id

    async def test_message_scope_mints_a_fresh_thread_per_event(self):
        """A policy resolving to MESSAGE scope keys the thread on the
        event's own id, not the platform thread key — every message gets
        its own session."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        space = _make_space(capabilities=capabilities)
        agent = _make_agent(
            slug="triage",
            policy=ChannelPolicy(session_scope=ChannelSessionScope.MESSAGE),
        )

        dao = _make_fake_dao()
        dao.fetch_space_by_key = AsyncMock(return_value=space)
        dao.fetch_agent_by_slug = AsyncMock(return_value=agent)
        dao.count_grants = AsyncMock(return_value=0)

        created = {}

        async def _create_thread(*, project_id, user_id, thread):
            created["thread"] = thread
            return ChannelThread(
                id=uuid4(),
                space_id=thread.space_id,
                agent_id=thread.agent_id,
                external_key=thread.external_key,
                session_id=thread.session_id,
                data=thread.data,
                flags=thread.flags,
            )

        dao.create_thread = AsyncMock(side_effect=_create_thread)

        service = _make_service(dao=dao, adapter=adapter)
        event = _make_event(text="~triage do it")

        result = await service.resolve(
            project_id=uuid4(), connection_id=uuid4(), event=event
        )

        assert result is not None
        assert created["thread"].external_key == event.id
        dao.fetch_current_thread.assert_not_called()


class TestComposeInput:
    async def _make_resolution(self, *, forwardfill, dao, capabilities):
        space = _make_space(capabilities=capabilities)
        agent = _make_agent()
        thread = ChannelThread(
            id=uuid4(),
            space_id=space.id,
            agent_id=agent.id,
            external_key=uuid4(),
            session_id="sess-1",
            data=ChannelThreadData(),
            flags=ChannelThreadFlags(),
        )
        from oss.src.core.channels.dtos import (
            ChannelEffectivePolicy,
            ChannelPolicyLevel,
            ChannelTriggerKind,
        )

        policy = ChannelEffectivePolicy(
            triggers={ChannelTriggerKind.MENTION},
            session_scope=ChannelSessionScope.THREAD,
            backfill=True,
            forwardfill=forwardfill,
            decided_by={
                "triggers": ChannelPolicyLevel.CHANNEL,
                "session_scope": ChannelPolicyLevel.CHANNEL,
                "backfill": ChannelPolicyLevel.CHANNEL,
                "forwardfill": ChannelPolicyLevel.CHANNEL,
            },
        )
        from oss.src.core.channels.dtos import ChannelResolution

        return ChannelResolution(space=space, agent=agent, thread=thread, policy=policy)

    async def test_no_trigger_yet_reads_whole_log(self):
        """No trigger row yet reads as "from the beginning" — after_event_id
        is None."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        dao = _make_fake_dao()
        service = _make_service(dao=dao, adapter=adapter)

        resolution = await self._make_resolution(
            forwardfill=True, dao=dao, capabilities=capabilities
        )
        event = _make_event()
        dao.query_events_since = AsyncMock(
            return_value=[
                ChannelInboxEvent(
                    id=event.id,
                    connection_id=event.connection_id,
                    external_id="evt-1",
                    kind=ChannelEventKind.MESSAGE,
                    origin=ChannelEventOrigin.PUSHED,
                    space_id=resolution.space.id,
                    data=event.data,
                )
            ]
        )

        await service.compose_input(
            project_id=uuid4(), resolution=resolution, event_id=event.id
        )

        _, kwargs = dao.query_events_since.call_args
        assert kwargs["after_event_id"] is None

    async def test_forwardfill_off_returns_addressing_event_alone(self):
        """Forwardfill off: the turn takes only the addressing event, even
        though the log holds more (the read is skipped, not the write)."""

        adapter = WellBehavedFakeAdapter()
        capabilities = await adapter.fetch_capabilities()
        dao = _make_fake_dao()
        service = _make_service(dao=dao, adapter=adapter)

        resolution = await self._make_resolution(
            forwardfill=False, dao=dao, capabilities=capabilities
        )
        addressing_event = _make_event()
        older_event = _make_event()

        dao.query_events_since = AsyncMock(
            return_value=[
                ChannelInboxEvent(
                    id=older_event.id,
                    connection_id=older_event.connection_id,
                    external_id="evt-older",
                    kind=ChannelEventKind.MESSAGE,
                    origin=ChannelEventOrigin.PUSHED,
                    space_id=resolution.space.id,
                    data=ChannelInboxEventData(
                        external_locator=_LOCATOR,
                        processed=ChannelInboxEventProcessed(
                            content=[{"type": "text", "text": "older, unread"}],
                            sender={"id": "U1"},
                        ),
                    ),
                ),
                ChannelInboxEvent(
                    id=addressing_event.id,
                    connection_id=addressing_event.connection_id,
                    external_id="evt-addr",
                    kind=ChannelEventKind.MESSAGE,
                    origin=ChannelEventOrigin.PUSHED,
                    space_id=resolution.space.id,
                    data=addressing_event.data,
                ),
            ]
        )

        turn_input = await service.compose_input(
            project_id=uuid4(),
            resolution=resolution,
            event_id=addressing_event.id,
        )

        assert turn_input.content == addressing_event.data.processed.content


class TestOpenTurnAndSettleTurn:
    async def test_open_turn_writes_started_row(self):
        dao = _make_fake_dao()
        adapter = WellBehavedFakeAdapter()
        service = _make_service(dao=dao, adapter=adapter)

        thread_id = uuid4()
        event_id = uuid4()

        written = ChannelInboxTrigger(
            id=uuid4(),
            thread_id=thread_id,
            event_id=event_id,
            turn_id="turn-1",
            state=ChannelTriggerState.STARTED,
            flags=ChannelInboxTriggerFlags(),
        )
        dao.record_inbox_trigger = AsyncMock(return_value=written)

        from oss.src.core.channels.dtos import (
            ChannelEffectivePolicy,
            ChannelPolicyLevel,
            ChannelResolution,
            ChannelTriggerKind,
        )

        resolution = ChannelResolution(
            space=_make_space(capabilities=await adapter.fetch_capabilities()),
            agent=_make_agent(),
            thread=ChannelThread(
                id=thread_id,
                space_id=uuid4(),
                agent_id=uuid4(),
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

        result = await service.open_turn(
            project_id=uuid4(),
            resolution=resolution,
            turn_id="turn-1",
            event_id=event_id,
        )

        assert result is written
        _, kwargs = dao.record_inbox_trigger.call_args
        assert kwargs["trigger"].state == ChannelTriggerState.STARTED
        assert kwargs["trigger"].event_id == event_id
        assert kwargs["trigger"].thread_id == thread_id
        assert kwargs["trigger"].turn_id == "turn-1"

    async def test_open_turn_returns_none_on_concurrent_claim_loss(self):
        """Two workers racing the same addressing collide on
        `(thread_id, event_id)`; the DAO's `ON CONFLICT DO NOTHING` returns
        None and `open_turn` propagates it unchanged."""

        dao = _make_fake_dao()
        dao.record_inbox_trigger = AsyncMock(return_value=None)
        adapter = WellBehavedFakeAdapter()
        service = _make_service(dao=dao, adapter=adapter)

        from oss.src.core.channels.dtos import (
            ChannelEffectivePolicy,
            ChannelPolicyLevel,
            ChannelResolution,
            ChannelTriggerKind,
        )

        resolution = ChannelResolution(
            space=_make_space(capabilities=await adapter.fetch_capabilities()),
            agent=_make_agent(),
            thread=ChannelThread(
                id=uuid4(),
                space_id=uuid4(),
                agent_id=uuid4(),
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

        result = await service.open_turn(
            project_id=uuid4(),
            resolution=resolution,
            turn_id="turn-1",
            event_id=uuid4(),
        )

        assert result is None

    async def test_settle_turn_transitions_in_place(self):
        dao = _make_fake_dao()
        adapter = WellBehavedFakeAdapter()
        service = _make_service(dao=dao, adapter=adapter)

        trigger_id = uuid4()
        await service.settle_turn(
            project_id=uuid4(),
            trigger_id=trigger_id,
            state=ChannelTriggerState.SETTLED,
        )

        dao.transition_inbox_trigger.assert_awaited_once()
        _, kwargs = dao.transition_inbox_trigger.call_args
        assert kwargs["trigger_id"] == trigger_id
        assert kwargs["state"] == ChannelTriggerState.SETTLED
