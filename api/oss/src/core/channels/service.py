import re
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelConnectionQuery,
    ChannelEffectivePolicy,
    ChannelEventKind,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantEdit,
    ChannelGrantEffect,
    ChannelGrantQuery,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxTrigger,
    ChannelInboxTriggerCreate,
    ChannelKeyGrain,
    ChannelPendingChoice,
    ChannelResolution,
    ChannelSessionScope,
    ChannelSetup,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceEdit,
    ChannelSpaceKind,
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
    ChannelGrantRuleInvalid,
    ChannelsError,
    ChannelSpaceNotFound,
    ChannelThreadNotFound,
)
from oss.src.core.channels.utils import compose_external_key, evaluate_grant_effect
from oss.src.core.secrets.dtos import (
    ChannelSecretDTO,
    ChannelSecretSettingsDTO,
    CreateSecretDTO,
    SecretDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import ChannelSecretKind, SecretKind
from oss.src.core.shared.dtos import Header, Status, Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
    from oss.src.core.secrets.services import VaultService

log = get_module_logger(__name__)


class ChannelsService:
    """Owns the channels domain: configuration, policy, routing, delivery."""

    def __init__(
        self,
        *,
        channels_dao: ChannelsDAOInterface,
        adapter_registry: "ChannelAdapterRegistry",
        vault_service: Optional["VaultService"] = None,
    ) -> None:
        self.channels_dao = channels_dao
        self.adapter_registry = adapter_registry
        # Optional so every existing composition site that predates the
        # write path keeps constructing: only create/edit-with-credentials
        # and archive-cascade need it.
        self.vault_service = vault_service

    # --- connections ---------------------------------------------------------- #

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection: ChannelConnectionCreate,
    ) -> ChannelConnection:
        """Verify, then store. A failed verification writes nothing.

        `connection.external_key` is always derived here, never taken from
        the caller -- same discipline as `create_space`. The declared
        `data` and whatever `verify_connection` discovers are merged into one
        locator; the identity-key subset of that locator is what gets
        recorded under `data["connection_locator"]`, which is the only place
        the ingress seam (`_connection_owns_identity`) looks.
        """

        adapter = self.adapter_registry.get(connection.channel)
        capabilities = await adapter.fetch_capabilities(connection=None)

        discovered = await adapter.verify_connection(
            connection=connection,
            credentials=connection.credentials or {},
        )
        # reaching here IS the verification: a refusal raises above this line
        connection.flags.is_verified = True

        locator_input = {**(connection.data or {}), **discovered}
        # a channel whose identity includes the project takes it from the scope
        # this call is already in, never from the caller: the credential proves
        # the project, so restating it would be a claim rather than a fact
        if "project" in (
            capabilities.identity.keys.get(ChannelKeyGrain.CONNECTION) or []
        ):
            locator_input["project"] = str(project_id)
        connection.external_key = compose_external_key(
            capabilities, ChannelKeyGrain.CONNECTION, locator_input
        )

        credential_secret_id = None
        if connection.credentials:
            secret = await self._write_credential_secret(
                project_id=project_id,
                channel=connection.channel,
                slug=connection.slug,
                credentials=connection.credentials,
            )
            credential_secret_id = secret.id

        connection.data = _compose_connection_data(
            capabilities=capabilities,
            locator_input=locator_input,
            credential_secret_id=credential_secret_id,
        )
        connection.credentials = None

        try:
            return await self.channels_dao.create_connection(
                project_id=project_id,
                user_id=user_id,
                #
                connection=connection,
            )
        except IntegrityError as e:
            raise _connection_conflict(
                channel=connection.channel, slug=connection.slug, error=e
            ) from e

    async def fetch_connection(
        self,
        *,
        project_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        """The only connection read every adapter-facing caller must use --
        `data` comes back with the credential reference resolved into the
        flat fields adapters already read (`bot_token`, `signing_secret`,
        ...). Never call `channels_dao.fetch_connection` directly from a path
        that hands the result to an adapter."""

        connection = await self.channels_dao.fetch_connection(
            project_id=project_id,
            #
            connection_id=connection_id,
        )
        return await self._hydrate_connection(
            project_id=project_id, connection=connection
        )

    async def _hydrate_connection(
        self,
        *,
        project_id: UUID,
        connection: Optional[ChannelConnection],
    ) -> Optional[ChannelConnection]:
        """Resolves `data["credential_secret_id"]` into the adapter-shaped
        fields the vault secret carries. A no-op when there is nothing to
        resolve -- no reference at all (agenta, mock, most fixtures) is the
        common case, not an error.

        This is a runtime value, never a persisted one: nothing downstream of
        this call may serialise the returned connection into a response body.
        """

        if connection is None:
            return None

        data = connection.data if isinstance(connection.data, dict) else None
        secret_id = data.get("credential_secret_id") if data else None
        if not secret_id:
            return connection

        if self.vault_service is None:
            raise ChannelsError(
                "ChannelsService needs a vault_service to resolve channel credentials"
            )

        secret = await self.vault_service.get_secret_by_id(
            secret_id=UUID(secret_id),
            project_id=project_id,
        )
        if secret is None or not isinstance(secret.data, ChannelSecretDTO):
            # the reference is stale (deleted secret) or the wrong kind --
            # degrade to the unhydrated connection rather than fail routing
            return connection

        credential_fields = secret.data.channel.model_dump(exclude_none=True)
        return connection.model_copy(update={"data": {**data, **credential_fields}})

    async def edit_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection: ChannelConnectionEdit,
    ) -> Optional[ChannelConnection]:
        """Rename, re-slug, rotate credentials. `channel`/`external_key`
        never move -- rotation re-verifies but leaves the identity alone."""

        existing = await self.channels_dao.fetch_connection(
            project_id=project_id,
            connection_id=connection.id,
        )
        if existing is None:
            return None

        if connection.credentials:
            adapter = self.adapter_registry.get(existing.channel)
            verify_target = ChannelConnectionCreate(
                channel=existing.channel,
                external_key=existing.external_key,
                slug=existing.slug,
                data=existing.data,
            )
            # re-verified before it replaces the old one -- same rule as create
            await adapter.verify_connection(
                connection=verify_target,
                credentials=connection.credentials,
            )

            existing_data = existing.data if isinstance(existing.data, dict) else {}
            existing_secret_id = existing_data.get("credential_secret_id")
            secret = await self._rotate_credential_secret(
                project_id=project_id,
                channel=existing.channel,
                slug=existing.slug,
                credentials=connection.credentials,
                existing_secret_id=(
                    UUID(existing_secret_id) if existing_secret_id else None
                ),
            )

            data = (
                dict(connection.data)
                if connection.data is not None
                else dict(existing_data)
            )
            data["credential_secret_id"] = str(secret.id)
            connection.data = data

        connection.credentials = None

        try:
            return await self.channels_dao.edit_connection(
                project_id=project_id,
                user_id=user_id,
                #
                connection=connection,
            )
        except IntegrityError as e:
            raise _connection_conflict(
                channel=existing.channel, slug=connection.slug, error=e
            ) from e

    async def archive_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        """Archive, never delete. Cascades to the connection's own
        `channel_agents` rows; leaves spaces, grants, threads and the event
        log untouched -- the transcript stays readable in web because
        sessions are never touched at all."""

        return await self.channels_dao.archive_connection(
            project_id=project_id,
            user_id=user_id,
            #
            connection_id=connection_id,
        )

    async def unarchive_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        return await self.channels_dao.unarchive_connection(
            project_id=project_id,
            user_id=user_id,
            #
            connection_id=connection_id,
        )

    async def delete_connection(
        self,
        *,
        project_id: UUID,
        #
        connection_id: UUID,
    ) -> bool:
        return await self.channels_dao.delete_connection(
            project_id=project_id,
            #
            connection_id=connection_id,
        )

    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        connection: Optional[ChannelConnectionQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelConnection]:
        return await self.channels_dao.query_connections(
            project_id=project_id,
            #
            connection=connection,
            #
            windowing=windowing,
        )

    async def get_connection_setup(
        self,
        *,
        project_id: UUID,
        #
        connection_id: UUID,
        request_url: str,
    ) -> ChannelSetup:
        """The declaration, plus the generated document. `instructions` and
        `fields` come straight off the capability declaration; `document` is
        rebuilt every call since it is request-url-dependent."""

        connection = await self.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        adapter = self.adapter_registry.get(connection.channel)
        capabilities = await adapter.fetch_capabilities(connection=connection)
        document = await adapter.build_setup_document(request_url=request_url)

        return ChannelSetup(
            instructions=capabilities.setup.instructions,
            fields=capabilities.setup.fields,
            document=document,
        )

    # --- connections: credentials ------------------------------------------ #

    def _channel_secret_kind(self, channel: str) -> ChannelSecretKind:
        try:
            return ChannelSecretKind(channel)
        except ValueError as e:
            raise ChannelsError(
                f"Channel {channel} declares no CHANNEL_SECRET kind"
            ) from e

    async def _write_credential_secret(
        self,
        *,
        project_id: UUID,
        channel: str,
        slug: Optional[str],
        credentials: Dict[str, Any],
    ):
        if self.vault_service is None:
            raise ChannelsError(
                "ChannelsService needs a vault_service to store channel credentials"
            )

        return await self.vault_service.create_secret(
            project_id=project_id,
            create_secret_dto=CreateSecretDTO(
                header=Header(
                    name=f"channel-{channel}-{slug or 'connection'}",
                    description="Channel credential",
                ),
                secret=SecretDTO(
                    kind=SecretKind.CHANNEL_SECRET,
                    data=ChannelSecretDTO(
                        kind=self._channel_secret_kind(channel),
                        channel=ChannelSecretSettingsDTO(**credentials),
                    ),
                ),
            ),
        )

    async def _rotate_credential_secret(
        self,
        *,
        project_id: UUID,
        channel: str,
        slug: Optional[str],
        credentials: Dict[str, Any],
        existing_secret_id: Optional[UUID],
    ):
        if self.vault_service is None:
            raise ChannelsError(
                "ChannelsService needs a vault_service to store channel credentials"
            )

        channel_secret = SecretDTO(
            kind=SecretKind.CHANNEL_SECRET,
            data=ChannelSecretDTO(
                kind=self._channel_secret_kind(channel),
                channel=ChannelSecretSettingsDTO(**credentials),
            ),
        )

        if existing_secret_id is not None:
            updated = await self.vault_service.update_secret(
                secret_id=existing_secret_id,
                project_id=project_id,
                update_secret_dto=UpdateSecretDTO(secret=channel_secret),
            )
            if updated is not None:
                return updated

        return await self.vault_service.create_secret(
            project_id=project_id,
            create_secret_dto=CreateSecretDTO(
                header=Header(
                    name=f"channel-{channel}-{slug or 'connection'}",
                    description="Channel credential",
                ),
                secret=channel_secret,
            ),
        )

    # --- agents ------------------------------------------------------------- #

    async def create_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentCreate,
    ) -> ChannelAgent:
        connection = await self.fetch_connection(
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
        connection = await self.fetch_connection(
            project_id=project_id,
            connection_id=space.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=space.connection_id)

        # external_key is always derived — never taken from the caller.
        capabilities = await self.fetch_capabilities(
            channel=connection.channel, connection=connection
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

        connection = await self.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        adapter = self.adapter_registry.get(connection.channel)
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
        # effect is immutable (it is part of the row's identity in the
        # partial unique indexes), so it never rides the edit payload -- but
        # a DENY row picking up is_default via this edit still needs catching.
        if grant.flags.is_default:
            existing_grants = await self.channels_dao.query_grants(
                project_id=project_id
            )
            existing = next((g for g in existing_grants if g.id == grant.id), None)
            if existing is not None and existing.effect is ChannelGrantEffect.DENY:
                raise ChannelGrantRuleInvalid(grant_id=grant.id)

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

        connection = await self.fetch_connection(
            project_id=project_id,
            connection_id=agent.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=agent.connection_id)

        adapter = self.adapter_registry.get(connection.channel)
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

    async def get_project_and_connection_by_external_key(
        self,
        *,
        channel: str,
        external_key: UUID,
    ) -> Optional[Tuple[UUID, UUID]]:
        """Unscoped by necessity: an inbound platform event carries no tenant."""

        return await self.channels_dao.get_project_and_connection_by_external_key(
            channel=channel,
            external_key=external_key,
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

        A never-seen space is created on first contact rather than refused —
        the row's existence stopped being what authorises an agent to answer
        there; the grant is. `None` on a DENY, on no addressed agent, or on
        no matching ALLOW for an agent that is not otherwise unrestricted —
        all read identically to the worker, which is the point.
        """

        connection = await self.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        # refused before a space is provisioned: nothing should be created
        # against a connection that is archived, switched off, or unverified
        if (
            connection.deleted_at is not None
            or not connection.flags.is_active
            or not connection.flags.is_verified
        ):
            return None

        capabilities = await self.fetch_capabilities(
            channel=connection.channel, connection=connection
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
            space = await self.channels_dao.get_or_create_space(
                project_id=project_id,
                user_id=None,
                space=ChannelSpaceCreate(
                    connection_id=connection_id,
                    kind=event.data.space_kind or ChannelSpaceKind.GROUP,
                    external_key=space_key,
                    data=ChannelSpaceData(external_locator=event.data.external_locator),
                ),
            )

        # the ingress wrote this row before any space existed; attach it before
        # the refusal paths, so an unanswered message still belongs to its space
        await self.channels_dao.attach_event_to_space(
            project_id=project_id,
            event_id=event.id,
            space_id=space.id,
        )

        if space.deleted_at is not None or not space.flags.is_active:
            return None

        agent = await self._addressed_agent(
            project_id=project_id,
            connection_id=connection_id,
            space=space,
            event=event,
            capabilities=capabilities,
        )
        # archiving a connection cascades deleted_at onto its agents; without
        # this an archived bot stays off the configuration surface but keeps
        # answering. A deactivated agent refuses exactly like an absent one.
        if agent is None or agent.deleted_at is not None or not agent.flags.is_active:
            return None

        matching_grants = await self.channels_dao.query_matching_grants(
            project_id=project_id,
            agent_id=agent.id,
            space_id=space.id,
            kind=space.kind,
        )
        effect = evaluate_grant_effect(matching_grants)

        grant = None
        if effect is ChannelGrantEffect.DENY:
            return None
        elif effect is ChannelGrantEffect.ALLOW:
            grant = _admitting_grant(matching_grants, space_id=space.id)
        else:
            # no rule names this space or this kind for this agent
            has_any_grant = await self.channels_dao.count_grants(
                project_id=project_id,
                agent_id=agent.id,
            )
            if has_any_grant:
                # refuse silently and identically to "no such agent"
                return None
            # zero grants anywhere for this agent: unrestricted

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

        # A click and a numbered reply converge here: both carry a candidate
        # string, and resolve_pending_choice treats them identically. A click
        # that fails to resolve is ignored outright — there is no thread
        # continuity yet to fall back to as an ordinary message.
        pending_choice = (
            thread.data.pending_choice
            if thread is not None and thread.flags.is_active
            else None
        )
        resolved_token = resolve_pending_choice(
            pending_choice=pending_choice,
            candidate=_first_text(event.data.processed.content),
        )

        if event.kind is ChannelEventKind.ACTION and resolved_token is None:
            log.info(
                "[CHANNELS] action token unresolved (stale, superseded, or "
                "unknown) for event=%s — ignored, nothing posted",
                event.id,
            )
            return None

        # the label, not the token: the agent gets back its own words, never
        # the internal id it never issued and the user never saw
        resolved_choice = None
        if resolved_token is not None and pending_choice is not None:
            resolved_choice = next(
                (
                    choice.label
                    for choice in pending_choice.choices
                    if choice.token == resolved_token
                ),
                None,
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
            resolved_choice=resolved_choice,
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
            if stored.id == event_id and resolution.resolved_choice is not None:
                # the resolved label stands in for the raw arrival here only
                # -- the logged row itself was never rewritten
                content.append({"type": "text", "text": resolution.resolved_choice})
            else:
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


def _compose_connection_data(
    *,
    capabilities: ChannelCapabilities,
    locator_input: Dict[str, Any],
    credential_secret_id: Optional[UUID],
) -> Dict[str, Any]:
    """The identity-key subset goes under `connection_locator`, nested --
    the only place `_connection_owns_identity` looks. Everything else
    discovered or declared (Slack's `bot_user_id`) stays flat."""

    key_fields = set(capabilities.identity.keys.get(ChannelKeyGrain.CONNECTION) or [])
    connection_locator = {field: locator_input[field] for field in key_fields}
    extra = {
        key: value for key, value in locator_input.items() if key not in key_fields
    }

    data: Dict[str, Any] = {"connection_locator": connection_locator, **extra}
    if credential_secret_id is not None:
        data["credential_secret_id"] = str(credential_secret_id)

    return data


def _connection_conflict(
    *,
    channel: str,
    slug: Optional[str],
    error: IntegrityError,
) -> EntityCreationConflict:
    """Two projects creating the same installation collide on
    `uq_channel_connections_external_key`; two connections in one project
    collide on slug -- either way a clean domain error, not a 500."""

    text = str(getattr(error, "orig", None) or error)

    if "uq_channel_connections_external_key" in text:
        return EntityCreationConflict(
            entity="ChannelConnection",
            message=f"A {channel} connection for this installation already exists.",
            conflict={"channel": channel},
        )

    if "uq_channel_connections_project_channel_slug" in text:
        return EntityCreationConflict(
            entity="ChannelConnection",
            message=f"A {channel} connection with slug '{slug}' already exists.",
            conflict={"channel": channel, "slug": slug},
        )

    return EntityCreationConflict(
        entity="ChannelConnection",
        message="Connection already exists.",
    )


def _canonical_locator(locator: Optional[dict]) -> str:
    from oss.src.core.channels.utils import canonical_json

    return canonical_json(locator or {})


def _admitting_grant(
    grants: List[ChannelGrant], *, space_id: UUID
) -> Optional[ChannelGrant]:
    """Which ALLOW row's policy feeds the intersection when more than one
    matched — the id-specific grant over the kind-level one, since that is
    the same specificity order the deny-first evaluation already applies to
    permission."""

    allows = [g for g in grants if g.effect is ChannelGrantEffect.ALLOW]
    by_space = next((g for g in allows if g.space_id == space_id), None)
    return by_space or (allows[0] if allows else None)


def resolve_pending_choice(
    *,
    pending_choice: Optional[ChannelPendingChoice],
    candidate: str,
) -> Optional[str]:
    """A click's token and a numbered reply's position resolve through this
    one function to the same token — that equality is the whole mechanism.

    Tried in order: exact token match (a click, or Agenta's token-as-message),
    then a 1-based index into the current choice list (a numbered reply).
    `None` covers every non-answer uniformly: no pending choice at all, a
    superseded one (it was overwritten wholesale, so its tokens are simply
    gone), an unknown token, or ordinary text that never meant to answer
    anything.
    """

    if pending_choice is None:
        return None

    candidate = (candidate or "").strip()
    if not candidate:
        return None

    for choice in pending_choice.choices:
        if choice.token == candidate:
            return choice.token

    if candidate.isdigit():
        index = int(candidate) - 1
        if 0 <= index < len(pending_choice.choices):
            return pending_choice.choices[index].token

    return None


def _first_text(content: List[dict]) -> str:
    for part in content:
        if isinstance(part, dict) and part.get("type") == "text":
            return part.get("text") or ""
    return ""


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
    from oss.src.core.channels.dtos import ChannelPolicy, ChannelSessionScope

    # `conversation.default` is a grain (connection|space|thread); session scope
    # is thread|message. Only THREAD carries over; every other grain means the
    # platform has no threads, and MESSAGE is always available.
    session_scope = (
        ChannelSessionScope.THREAD
        if capabilities.conversation.default is ChannelKeyGrain.THREAD
        else ChannelSessionScope.MESSAGE
    )

    return ChannelPolicy(
        session_scope=session_scope,
        backfill=capabilities.fill.backfill.supported,
        forwardfill=capabilities.fill.forwardfill.supported,
    )
