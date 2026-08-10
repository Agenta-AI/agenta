import re
from typing import TYPE_CHECKING, List, Optional, Tuple
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelCapabilities,
    ChannelConnection,
    ChannelEffectivePolicy,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantEdit,
    ChannelGrantQuery,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxTrigger,
    ChannelInboxTriggerCreate,
    ChannelResolution,
    ChannelSessionScope,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceEdit,
    ChannelSpaceQuery,
    ChannelThread,
    ChannelThreadCreate,
    ChannelThreadData,
    ChannelThreadQuery,
    ChannelTriggerState,
    ChannelTurnInput,
)
from oss.src.core.channels.fill import select_forwardfill_range
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.channels.types import (
    ChannelAgentNotFound,
    ChannelConnectionNotFound,
    ChannelSpaceNotFound,
    ChannelThreadNotFound,
)
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.shared.dtos import Status, Windowing

if TYPE_CHECKING:
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.gateway.connections.service import ConnectionsService


class ChannelsService:
    """Owns the channels domain: configuration, policy, routing, delivery."""

    def __init__(
        self,
        *,
        channels_dao: ChannelsDAOInterface,
        adapter_registry: "ChannelAdapterRegistry",
        connections_service: "ConnectionsService",
    ) -> None:
        self.channels_dao = channels_dao
        self.adapter_registry = adapter_registry
        self.connections_service = connections_service

    # --- agents ------------------------------------------------------------- #

    async def create_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentCreate,
    ) -> ChannelAgent:
        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=agent.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=agent.connection_id)

        return await self.channels_dao.create_agent(
            project_id=project_id,
            user_id=user_id,
            #
            agent=agent,
        )

    async def fetch_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> Optional[ChannelAgent]:
        return await self.channels_dao.fetch_agent(
            project_id=project_id,
            #
            agent_id=agent_id,
        )

    async def edit_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentEdit,
    ) -> Optional[ChannelAgent]:
        return await self.channels_dao.edit_agent(
            project_id=project_id,
            user_id=user_id,
            #
            agent=agent,
        )

    async def delete_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> bool:
        return await self.channels_dao.delete_agent(
            project_id=project_id,
            #
            agent_id=agent_id,
        )

    async def query_agents(
        self,
        *,
        project_id: UUID,
        #
        agent: Optional[ChannelAgentQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelAgent]:
        return await self.channels_dao.query_agents(
            project_id=project_id,
            #
            agent=agent,
            #
            windowing=windowing,
        )

    async def set_agent_default(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent_id: UUID,
    ) -> ChannelAgent:
        agent = await self.channels_dao.fetch_agent(
            project_id=project_id,
            agent_id=agent_id,
        )
        if agent is None:
            raise ChannelAgentNotFound(agent_id=agent_id)

        current_default = await self.channels_dao.fetch_default_agent(
            project_id=project_id,
            connection_id=agent.connection_id,
        )
        if current_default is not None and current_default.id != agent_id:
            current_default.flags.is_default = False
            await self.channels_dao.edit_agent(
                project_id=project_id,
                user_id=user_id,
                #
                agent=ChannelAgentEdit(
                    id=current_default.id,
                    name=current_default.name,
                    description=current_default.description,
                    tags=current_default.tags,
                    meta=current_default.meta,
                    data=current_default.data,
                    flags=current_default.flags,
                ),
            )

        agent.flags.is_default = True
        updated = await self.channels_dao.edit_agent(
            project_id=project_id,
            user_id=user_id,
            #
            agent=ChannelAgentEdit(
                id=agent.id,
                name=agent.name,
                description=agent.description,
                tags=agent.tags,
                meta=agent.meta,
                data=agent.data,
                flags=agent.flags,
            ),
        )
        return updated

    # --- spaces --------------------------------------------------------- #

    async def create_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceCreate,
    ) -> ChannelSpace:
        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=space.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=space.connection_id)

        # external_key is always derived — never taken from the caller.
        capabilities = await self.fetch_capabilities(
            channel=connection.provider_key, connection=connection
        )
        space.external_key = compose_external_key(
            capabilities,
            ChannelKeyGrain.SPACE,
            space.data.external_locator,
        )

        return await self.channels_dao.create_space(
            project_id=project_id,
            user_id=user_id,
            #
            space=space,
        )

    async def fetch_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]:
        return await self.channels_dao.fetch_space(
            project_id=project_id,
            #
            space_id=space_id,
        )

    async def edit_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceEdit,
    ) -> Optional[ChannelSpace]:
        return await self.channels_dao.edit_space(
            project_id=project_id,
            user_id=user_id,
            #
            space=space,
        )

    async def delete_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> bool:
        return await self.channels_dao.delete_space(
            project_id=project_id,
            #
            space_id=space_id,
        )

    async def query_spaces(
        self,
        *,
        project_id: UUID,
        #
        space: Optional[ChannelSpaceQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelSpace]:
        return await self.channels_dao.query_spaces(
            project_id=project_id,
            #
            space=space,
            #
            windowing=windowing,
        )

    async def discover_spaces(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> List[ChannelSpaceCandidate]:
        """Ask the adapter which places the app can see. Persists nothing."""

        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        adapter = self.adapter_registry.get(connection.provider_key)
        candidates = await adapter.discover_spaces(connection=connection)

        configured = await self.channels_dao.query_spaces(
            project_id=project_id,
            space=ChannelSpaceQuery(connection_id=connection_id),
        )
        configured_locators = {
            _canonical_locator(space.data.external_locator) for space in configured
        }

        for candidate in candidates:
            candidate.is_configured = (
                _canonical_locator(candidate.external_locator) in configured_locators
            )

        return candidates

    # --- grants ----------------------------------------------------------- #

    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantCreate,
    ) -> ChannelGrant:
        return await self.channels_dao.create_grant(
            project_id=project_id,
            user_id=user_id,
            #
            grant=grant,
        )

    async def edit_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantEdit,
    ) -> Optional[ChannelGrant]:
        return await self.channels_dao.edit_grant(
            project_id=project_id,
            user_id=user_id,
            #
            grant=grant,
        )

    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool:
        return await self.channels_dao.delete_grant(
            project_id=project_id,
            #
            grant_id=grant_id,
        )

    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[ChannelGrantQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelGrant]:
        return await self.channels_dao.query_grants(
            project_id=project_id,
            #
            grant=grant,
            #
            windowing=windowing,
        )

    async def set_grant_default(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant_id: UUID,
    ) -> ChannelGrant:
        grants = await self.channels_dao.query_grants(project_id=project_id)
        grant = next((g for g in grants if g.id == grant_id), None)
        if grant is None:
            raise ChannelAgentNotFound(agent_id=grant_id)

        current_default = await self.channels_dao.fetch_default_grant(
            project_id=project_id,
            space_id=grant.space_id,
        )
        if current_default is not None and current_default.id != grant_id:
            current_default.flags.is_default = False
            await self.channels_dao.edit_grant(
                project_id=project_id,
                user_id=user_id,
                #
                grant=ChannelGrantEdit(
                    id=current_default.id,
                    name=current_default.name,
                    description=current_default.description,
                    tags=current_default.tags,
                    meta=current_default.meta,
                    data=current_default.data,
                    flags=current_default.flags,
                ),
            )

        grant.flags.is_default = True
        updated = await self.channels_dao.edit_grant(
            project_id=project_id,
            user_id=user_id,
            #
            grant=ChannelGrantEdit(
                id=grant.id,
                name=grant.name,
                description=grant.description,
                tags=grant.tags,
                meta=grant.meta,
                data=grant.data,
                flags=grant.flags,
            ),
        )
        return updated

    # --- threads ---------------------------------------------------------- #

    async def query_threads(
        self,
        *,
        project_id: UUID,
        #
        thread: Optional[ChannelThreadQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelThread]:
        return await self.channels_dao.query_threads(
            project_id=project_id,
            #
            thread=thread,
            #
            windowing=windowing,
        )

    async def close_thread(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        thread_id: UUID,
    ) -> ChannelThread:
        # append-only: flips is_active on THIS row, never inserts a new one.
        thread = await self.channels_dao.close_thread(
            project_id=project_id,
            user_id=user_id,
            #
            thread_id=thread_id,
        )
        if thread is None:
            raise ChannelThreadNotFound(thread_id=thread_id)

        return thread

    # --- capability + policy: adapter reads, no persistence --------------- #

    async def fetch_capabilities(
        self,
        *,
        channel: str,
        connection: Optional[ChannelConnection] = None,
    ) -> ChannelCapabilities:
        adapter = self.adapter_registry.get(channel)
        return await adapter.fetch_capabilities(connection=connection)

    async def resolve_effective_policy(
        self,
        *,
        project_id: UUID,
        agent_id: UUID,
        space_id: UUID,
    ) -> ChannelEffectivePolicy:
        from oss.src.core.channels.utils import resolve_policy

        agent = await self.channels_dao.fetch_agent(
            project_id=project_id, agent_id=agent_id
        )
        if agent is None:
            raise ChannelAgentNotFound(agent_id=agent_id)

        space = await self.channels_dao.fetch_space(
            project_id=project_id, space_id=space_id
        )
        if space is None:
            raise ChannelSpaceNotFound(space_id=space_id)

        grant = await self.channels_dao.fetch_grant(
            project_id=project_id, agent_id=agent_id, space_id=space_id
        )

        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=agent.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=agent.connection_id)

        adapter = self.adapter_registry.get(connection.provider_key)
        capabilities = await adapter.fetch_capabilities(connection=connection)
        channel_defaults = _channel_defaults(capabilities)

        return resolve_policy(
            capabilities,
            channel_defaults,
            agent.data.policy,
            space.data.policy,
            grant.data.policy if grant else None,
        )

    # --- routing: the inbound path ----------------------------------------- #

    async def get_project_and_connection_by_external_id(
        self,
        *,
        channel: str,
        external_id: str,
    ) -> Optional[Tuple[UUID, UUID]]:
        """Unscoped by necessity: an inbound platform event carries no tenant."""

        return await self.channels_dao.get_project_and_connection_by_external_id(
            channel=channel,
            external_id=external_id,
        )

    async def record_inbox_event(
        self,
        *,
        project_id: UUID,
        event: ChannelInboxEventCreate,
    ) -> Optional[ChannelInboxEvent]:
        """None means already recorded — the dedup contract, not an error."""

        return await self.channels_dao.record_inbox_event(
            project_id=project_id,
            event=event,
        )

    async def verify_signature(self, *, channel, headers, body) -> UUID:
        raise NotImplementedError

    async def record_event(self, *, channel, envelope):
        raise NotImplementedError

    async def resolve(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
    ) -> Optional[ChannelResolution]:
        """Who runs, and under what policy.

        Default-deny on an unconfigured space; `None` on no addressed agent or
        a silent grant refusal -- both read identically to the worker, which
        is the point.
        """

        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        capabilities = await self.fetch_capabilities(
            channel=connection.provider_key, connection=connection
        )

        space_key = compose_external_key(
            capabilities,
            ChannelKeyGrain.SPACE,
            event.data.external_locator,
        )

        space = await self.channels_dao.fetch_space_by_key(
            project_id=project_id,
            connection_id=connection_id,
            external_key=space_key,
        )
        if space is None:
            # default-deny: no configured space means the agent may not
            # answer here, regardless of addressing.
            return None

        # the ingress wrote this row before any space existed; attach it before
        # the refusal paths, so an unanswered message still belongs to its space
        await self.channels_dao.attach_event_to_space(
            project_id=project_id,
            event_id=event.id,
            space_id=space.id,
        )

        agent = await self._addressed_agent(
            project_id=project_id,
            connection_id=connection_id,
            space=space,
            event=event,
            capabilities=capabilities,
        )
        if agent is None:
            return None

        grant = await self.channels_dao.fetch_grant(
            project_id=project_id,
            agent_id=agent.id,
            space_id=space.id,
        )
        if grant is None:
            has_any_grant = await self.channels_dao.count_grants(
                project_id=project_id,
                agent_id=agent.id,
            )
            if has_any_grant:
                # refuse silently and identically to "no such agent"
                return None

        from oss.src.core.channels.utils import resolve_policy

        channel_defaults = _channel_defaults(capabilities)
        policy = resolve_policy(
            capabilities,
            channel_defaults,
            agent.data.policy,
            space.data.policy,
            grant.data.policy if grant else None,
        )

        # THREAD grain composes to None where the platform declares no thread
        # fields (the no-threads case). MESSAGE scope always mints a fresh
        # thread keyed on this event's own id, since "one session per
        # message" is the point of that scope.
        is_message_scope = policy.session_scope is ChannelSessionScope.MESSAGE

        thread = None
        if is_message_scope:
            thread_key = event.id
        else:
            thread_key = compose_external_key(
                capabilities,
                ChannelKeyGrain.THREAD,
                event.data.external_locator,
            )
            thread = await self.channels_dao.fetch_current_thread(
                project_id=project_id,
                space_id=space.id,
                external_key=thread_key,
                agent_id=agent.id,
            )

        if thread is None or not thread.flags.is_active:
            thread = await self.channels_dao.create_thread(
                project_id=project_id,
                user_id=None,
                thread=ChannelThreadCreate(
                    space_id=space.id,
                    agent_id=agent.id,
                    external_key=thread_key,
                    session_id=str(thread_key or space.external_key),
                    data=ChannelThreadData(
                        external_locator=event.data.external_locator,
                    ),
                ),
            )

        return ChannelResolution(
            space=space,
            agent=agent,
            thread=thread,
            policy=policy,
        )

    async def _addressed_agent(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        space: ChannelSpace,
        event: ChannelInboxEvent,
        capabilities: ChannelCapabilities,
    ) -> Optional[ChannelAgent]:
        """The chain: an explicit sigil names one, else the space's default
        grant, else the connection's default agent."""

        slug = _parse_sigil(
            content=event.data.processed.content,
            sigil=capabilities.addressing.sigils.agent,
        )
        if slug is not None:
            agent = await self.channels_dao.fetch_agent_by_slug(
                project_id=project_id,
                connection_id=connection_id,
                slug=slug,
            )
            return agent

        default_grant = await self.channels_dao.fetch_default_grant(
            project_id=project_id,
            space_id=space.id,
        )
        if default_grant is not None:
            return await self.channels_dao.fetch_agent(
                project_id=project_id,
                agent_id=default_grant.agent_id,
            )

        return await self.channels_dao.fetch_default_agent(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def compose_input(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        event_id: UUID,
    ) -> ChannelTurnInput:
        """What the agent sees.

        ``event_id`` is the addressing event's own id: ``ChannelResolution``
        carries no event reference, and the offset write in ``open_turn``
        needs the exact row, not "whatever is latest" (a second event can
        race in between resolve and open_turn). The worker holds the id
        already, since it is what triggered resolve() in the first place.

        Forwardfill off skips the range read, not the log write.
        """

        events = await select_forwardfill_range(
            project_id=project_id,
            channels_dao=self.channels_dao,
            thread_id=resolution.thread.id,
            space_id=resolution.space.id,
        )

        if not resolution.policy.forwardfill:
            # the turn takes the addressing event alone
            events = [stored for stored in events if stored.id == event_id]

        content: List[dict] = []
        for stored in events:
            content.extend(stored.data.processed.content)

        return ChannelTurnInput(
            content=content,
            is_backfilled=resolution.space.flags.is_backfilled,
        )

    async def open_turn(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_id: str,
        event_id: UUID,
    ) -> Optional[ChannelInboxTrigger]:
        """Writes the offset row at STARTED before invoke runs: nothing holds
        a transaction across the detached call. `None` means a concurrent
        worker already claimed this exact addressing -- the caller must not
        invoke. ``event_id`` -- see the note on `compose_input`.
        """

        return await self.channels_dao.record_inbox_trigger(
            project_id=project_id,
            trigger=ChannelInboxTriggerCreate(
                thread_id=resolution.thread.id,
                event_id=event_id,
                turn_id=turn_id,
                state=ChannelTriggerState.STARTED,
            ),
        )

    async def settle_turn(
        self,
        *,
        project_id: UUID,
        trigger_id: UUID,
        state: ChannelTriggerState,
        status: Optional[Status] = None,
    ) -> None:
        """Records the turn's fate whenever it becomes known -- an in-place
        transition by id, never a fresh insert."""

        await self.channels_dao.transition_inbox_trigger(
            project_id=project_id,
            trigger_id=trigger_id,
            state=state,
            status=status,
        )

    # --- delivery: the outbound path --------------------------------------- #

    async def enqueue_output(self, *, project_id, thread_id, turn_id, items):
        raise NotImplementedError

    async def deliver(self, *, project_id, event_id):
        raise NotImplementedError

    async def query_inbox_events(self, *, project_id, event=None, windowing=None):
        return await self.channels_dao.query_inbox_events(
            project_id=project_id,
            #
            event=event,
            #
            windowing=windowing,
        )

    async def query_outbox_events(self, *, project_id, event=None, windowing=None):
        return await self.channels_dao.query_outbox_events(
            project_id=project_id,
            #
            event=event,
            #
            windowing=windowing,
        )

    # --- helpers ------------------------------------------------------------ #

    async def resolve_channel(self, *, project_id: UUID, connection_id: UUID) -> str:
        """The connection's channel key, for callers that need capabilities."""

        return await self._resolve_channel(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def _resolve_channel(self, *, project_id: UUID, connection_id: UUID) -> str:
        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)
        return connection.provider_key


def _canonical_locator(locator: Optional[dict]) -> str:
    from oss.src.core.channels.utils import canonical_json

    return canonical_json(locator or {})


def _parse_sigil(*, content: list, sigil: Optional[str]) -> Optional[str]:
    """The first `{sigil}{slug}` token across this message's text parts, or
    None. The grammar is universal; the sigil character is per-channel and
    undeclared platforms (`sigil is None`) never match."""

    if not sigil:
        return None

    pattern = re.compile(re.escape(sigil) + r"([A-Za-z0-9_-]+)")

    for part in content:
        if not isinstance(part, dict) or part.get("type") != "text":
            continue

        match = pattern.search(part.get("text") or "")
        if match:
            return match.group(1)

    return None


def _channel_defaults(capabilities: ChannelCapabilities):
    from oss.src.core.channels.dtos import ChannelPolicy

    return ChannelPolicy(
        session_scope=capabilities.conversation.default,
        backfill=capabilities.fill.backfill.supported,
        forwardfill=capabilities.fill.forwardfill.supported,
    )
