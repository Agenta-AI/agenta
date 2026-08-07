from typing import TYPE_CHECKING, List, Optional, Tuple
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelCapabilities,
    ChannelEffectivePolicy,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantEdit,
    ChannelGrantQuery,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceEdit,
    ChannelSpaceQuery,
    ChannelThread,
    ChannelThreadQuery,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.channels.types import (
    ChannelAgentNotFound,
    ChannelConnectionNotFound,
    ChannelSpaceNotFound,
    ChannelThreadNotFound,
)
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.shared.dtos import Windowing

if TYPE_CHECKING:
    # WP2 owns registry.py; imported for typing only so WP1 does not depend on
    # a module that does not exist yet in this worktree.
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.gateway.connections.service import ConnectionsService


class ChannelsService:
    """Owns the channels domain: configuration, policy, routing, delivery.

    WP1 implements configuration (agents/spaces/grants/threads) and the
    capability/policy reads. Routing (`resolve`, `compose_input`, `open_turn`,
    `settle_turn`) and delivery (`enqueue_output`, `deliver`) are declared here
    per the frozen §8 surface but implemented by WP3/WP4/WP5.
    """

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
        # external_key is always derived (§2.2) — never taken from the caller.
        capabilities = await self.fetch_capabilities(
            channel=await self._resolve_channel(
                project_id=project_id, connection_id=space.connection_id
            )
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
        # append-only (D12): flips is_active on THIS row, never inserts a new one.
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

    async def fetch_capabilities(self, *, channel: str) -> ChannelCapabilities:
        adapter = self.adapter_registry.get(channel)
        return await adapter.fetch_capabilities()

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
        capabilities = await adapter.fetch_capabilities()
        channel_defaults = _channel_defaults(capabilities)

        return resolve_policy(
            capabilities,
            channel_defaults,
            agent.data.policy,
            space.data.policy,
            grant.data.policy if grant else None,
        )

    # --- routing: the inbound path (§2.1, §2.4) — WP3/WP4 fill these ------ #

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

    async def resolve(self, *, project_id, connection_id, event):
        raise NotImplementedError

    async def compose_input(self, *, project_id, resolution):
        raise NotImplementedError

    async def open_turn(self, *, project_id, resolution, turn_id):
        raise NotImplementedError

    async def settle_turn(self, *, project_id, trigger_id, state, status=None) -> None:
        raise NotImplementedError

    # --- delivery: the outbound path (§2.6, §2.7) — WP5 fills these ------- #

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


def _channel_defaults(capabilities: ChannelCapabilities):
    from oss.src.core.channels.dtos import ChannelPolicy

    return ChannelPolicy(
        session_scope=capabilities.conversation.default,
        backfill=capabilities.fill.backfill.supported,
        forwardfill=capabilities.fill.forwardfill.supported,
    )
