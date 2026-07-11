from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionRequest,
    Usage,
)
from oss.src.core.gateway.connections.interfaces import ConnectionsDAOInterface
from oss.src.core.gateway.connections.registry import ConnectionsGatewayRegistry
from oss.src.core.gateway.connections.exceptions import (
    ConnectionInactiveError,
    ConnectionNotFoundError,
)
from oss.src.core.gateway.connections.utils import make_oauth_state


log = get_module_logger(__name__)

# The OAuth callback stays on the /tools router so the public contract is
# unchanged even though the connection now lives in its own domain.
_CALLBACK_PATH = "/tools/connections/callback"


class ConnectionsService:
    """Project-scoped service that owns gateway_connections.

    Returns domain ``Connection`` DTOs. Downstream domains (tools, triggers)
    consume this service; it never imports from them.
    """

    def __init__(
        self,
        *,
        connections_dao: ConnectionsDAOInterface,
        adapter_registry: ConnectionsGatewayRegistry,
    ):
        self.connections_dao = connections_dao
        self.adapter_registry = adapter_registry

    # -----------------------------------------------------------------------
    # Reads
    # -----------------------------------------------------------------------

    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[Connection]:
        """Query connections with optional filtering. Defaults to active-only."""
        return await self.connections_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=is_active,
        )

    async def list_connections(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> List[Connection]:
        """List connections for a specific integration (catalog enrichment)."""
        return await self.connections_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
        )

    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[Connection]:
        """Return a single connection by ID scoped to the project, or None."""
        # Read-only by design: do not mutate local state during GET.
        return await self.connections_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def find_connection_by_provider_connection_id(
        self,
        *,
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[Connection]:
        """Find a project's connection by its provider-side ID (for OAuth callbacks)."""
        return await self.connections_dao.find_connection_by_provider_id(
            project_id=project_id,
            provider_connection_id=provider_connection_id,
        )

    async def activate_connection_by_provider_connection_id(
        self,
        *,
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[Connection]:
        """Mark a connection valid+active after OAuth completes."""
        return await self.connections_dao.activate_connection_by_provider_id(
            project_id=project_id,
            provider_connection_id=provider_connection_id,
        )

    async def usage(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Usage:
        """Report cross-domain usage of a connection (C7).

        The seam for "used by tools / N subs". Tools and triggers read the same
        shared row, so this is a read-only count of consumers. Subscriptions are
        not yet a consumer in this WP, so the count is the seam (0).
        """
        conn = await self.connections_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if not conn:
            raise ConnectionNotFoundError(connection_id=str(connection_id))

        return Usage(
            tools=True,
            subscriptions=0,
        )

    # -----------------------------------------------------------------------
    # Writes
    # -----------------------------------------------------------------------

    async def initiate_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ConnectionCreate,
    ) -> Connection:
        """Initiate a provider connection and persist it locally in pending state."""
        provider_key = connection_create.provider_key.value
        integration_key = connection_create.integration_key

        adapter = self.adapter_registry.get(provider_key)

        # Callback URL is server-owned. Do not trust/require client-provided values.
        # Embed a signed state token so the callback can scope the activation.
        state = make_oauth_state(
            project_id=project_id,
            user_id=user_id,
            secret_key=env.agenta.crypt_key,
            slug=connection_create.slug,
            integration_key=integration_key,
        )
        callback_url = f"{env.agenta.api_url}{_CALLBACK_PATH}?state={state}"

        # Initiate with provider
        connection_create_data = connection_create.data
        provider_result = await adapter.initiate_connection(
            request=ConnectionRequest(
                user_id=str(project_id),
                integration_key=integration_key,
                auth_scheme=connection_create_data.auth_scheme.value
                if connection_create_data and connection_create_data.auth_scheme
                else None,
                callback_url=callback_url,
            ),
        )

        # Effective auth scheme is a durable fact about the connection; persist it.
        auth_scheme = (
            connection_create_data.auth_scheme.value
            if connection_create_data and connection_create_data.auth_scheme
            else None
        )

        # Merge provider-returned connection_data with service-level project_id.
        # The adapter owns provider-specific field names; the service adds project scope.
        data: Dict[str, Any] = dict(provider_result.connection_data)
        data["project_id"] = str(project_id)
        data["auth_scheme"] = auth_scheme
        connection_create.data = data

        # Validity is server-owned, never client-supplied. An auth-backed connection is
        # not valid until its OAuth callback flips is_valid; a no-auth toolkit has no
        # flow, so the server marks it valid up front (only after the adapter confirmed
        # no-auth via connection_data). Drop client flags so a caller can't mark a
        # pending OAuth connection valid.
        connection_create.flags = {
            "is_active": True,
            "is_valid": bool(data.get("no_auth")),
        }

        # Persist locally
        return await self.connections_dao.create_connection(
            project_id=project_id,
            user_id=user_id,
            #
            connection_create=connection_create,
        )

    async def delete_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> bool:
        """Revoke provider-side connection and delete locally. Raises ConnectionNotFoundError if missing."""
        conn = await self.connections_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

        if not conn:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

        # Revoke provider-side
        if conn.provider_connection_id:
            adapter = self.adapter_registry.get(conn.provider_key.value)
            try:
                await adapter.revoke_connection(
                    provider_connection_id=conn.provider_connection_id,
                )
            except Exception:
                log.warning(
                    "Failed to revoke provider connection %s, proceeding with local delete",
                    conn.provider_connection_id,
                )

        # Delete locally
        return await self.connections_dao.delete_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def revoke_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Connection:
        """Mark a connection invalid locally without touching the provider.

        Local-only by design (C7/B3): flipping ``is_valid=False`` on the shared
        gateway_connections row is the cross-domain effect — tools and triggers
        read the same row, so everyone sees the revocation without a provider
        call or cascade.
        """
        conn = await self.connections_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

        if not conn:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

        updated = await self.connections_dao.update_connection(
            project_id=project_id,
            connection_id=connection_id,
            is_valid=False,
        )

        return updated or conn

    async def refresh_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        force: bool = False,
    ) -> Connection:
        conn = await self.connections_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

        if not conn:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

        # A no-auth connection has no provider-side authorization to re-link, so refresh
        # is a no-op. Return it unchanged rather than reporting it missing.
        if not conn.has_auth:
            return conn

        if not conn.provider_connection_id:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

        if not conn.is_active:
            raise ConnectionInactiveError(
                connection_id=str(connection_id),
                detail="Cannot refresh an inactive connection. Create a new connection to re-establish authorization.",
            )

        # Callback URL is server-owned with a signed state token.
        state = make_oauth_state(
            project_id=project_id,
            user_id=project_id,  # refresh has no user_id; use project_id as entity
            secret_key=env.agenta.crypt_key,
            slug=conn.slug,
            integration_key=conn.integration_key,
        )
        callback_url = f"{env.agenta.api_url}{_CALLBACK_PATH}?state={state}"

        adapter = self.adapter_registry.get(conn.provider_key.value)

        # Delegate provider-specific refresh logic to the adapter.
        # For OAuth providers (e.g. Composio), the adapter re-initiates the link.
        provider_connection_id = conn.provider_connection_id
        result = await adapter.refresh_connection(
            provider_connection_id=conn.provider_connection_id,
            force=force,
            callback_url=callback_url,
            integration_key=conn.integration_key,
            user_id=str(project_id),
        )
        provider_connection_id = result.id or provider_connection_id
        auth_config_id = result.auth_config_id
        is_valid = result.is_valid if result.is_valid is not None else conn.is_valid

        redirect_url = result.redirect_url
        # Always overwrite redirect_url so FE doesn't reuse stale links from prior flows.
        data_update = {"redirect_url": redirect_url}
        if auth_config_id:
            data_update["auth_config_id"] = auth_config_id

        updated = await self.connections_dao.update_connection(
            project_id=project_id,
            connection_id=connection_id,
            is_valid=is_valid,
            provider_connection_id=provider_connection_id,
            data_update=data_update,
        )

        return updated or conn
