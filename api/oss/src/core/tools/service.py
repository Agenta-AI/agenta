from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.core.tools.utils import make_oauth_state

from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogIntegration,
    ToolCatalogProvider,
    ToolConnection,
    ToolConnectionCreate,
    ToolConnectionRequest,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from oss.src.core.tools.interfaces import (
    ToolsDAOInterface,
)
from oss.src.core.tools.registry import ToolsGatewayRegistry
from oss.src.core.tools.exceptions import (
    ConnectionInactiveError,
    ConnectionNotFoundError,
)


log = get_module_logger(__name__)


class ToolsService:
    def __init__(
        self,
        *,
        tools_dao: ToolsDAOInterface,
        adapter_registry: ToolsGatewayRegistry,
    ):
        self.tools_dao = tools_dao
        self.adapter_registry = adapter_registry

    # -----------------------------------------------------------------------
    # Catalog browse
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[ToolCatalogProvider]:
        """Return all providers across registered adapters."""
        results: List[ToolCatalogProvider] = []
        for _key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[ToolCatalogProvider]:
        """Return a single provider by key, or None if not found."""
        adapter = self.adapter_registry.get(provider_key)
        providers = await adapter.list_providers()
        for p in providers:
            if p.key == provider_key:
                return p
        return None

    async def list_integrations(
        self,
        *,
        provider_key: str,
        #
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogIntegration], Optional[str], int]:
        """List integrations for a provider with optional filtering and pagination."""
        adapter = self.adapter_registry.get(provider_key)
        integrations, next_cursor, total = await adapter.list_integrations(
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        return integrations, next_cursor, total

    async def get_integration(
        self,
        *,
        provider_key: str,
        integration_key: str,
    ) -> Optional[ToolCatalogIntegration]:
        """Return a single integration by key, or None if not found."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_integration(integration_key=integration_key)

    async def list_actions(
        self,
        *,
        provider_key: str,
        integration_key: str,
        #
        query: Optional[str] = None,
        categories: Optional[List[str]] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogAction], Optional[str], int]:
        """List actions for an integration with optional search and pagination."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.list_actions(
            integration_key=integration_key,
            query=query,
            categories=categories,
            important=important,
            limit=limit,
            cursor=cursor,
        )

    async def get_action(
        self,
        *,
        provider_key: str,
        integration_key: str,
        action_key: str,
    ) -> Optional[ToolCatalogActionDetails]:
        """Return full action detail including input/output schema, or None if not found."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_action(
            integration_key=integration_key,
            action_key=action_key,
        )

    # -----------------------------------------------------------------------
    # Connection management
    # -----------------------------------------------------------------------

    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[ToolConnection]:
        """Query connections with optional filtering. Defaults to active-only."""
        return await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=is_active,
        )

    async def find_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
    ) -> Optional[ToolConnection]:
        """Find any connection by its provider-side ID (for OAuth callbacks)."""
        return await self.tools_dao.find_connection_by_provider_id(
            provider_connection_id=provider_connection_id,
        )

    async def activate_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
        project_id: Optional[UUID] = None,
    ) -> Optional[ToolConnection]:
        """Mark a connection valid+active after OAuth completes."""
        return await self.tools_dao.activate_connection_by_provider_id(
            provider_connection_id=provider_connection_id,
            project_id=project_id,
        )

    async def list_connections(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> List[ToolConnection]:
        """List connections for a specific integration (catalog enrichment)."""
        return await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
        )

    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ToolConnection]:
        """Return a single connection by ID scoped to the project, or None."""
        # Read-only by design: do not mutate local state during GET.
        return await self.tools_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ToolConnectionCreate,
    ) -> ToolConnection:
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
        )
        callback_url = (
            f"{env.agenta.api_url}/preview/tools/connections/callback?state={state}"
        )

        # Initiate with provider
        connection_create_data = connection_create.data
        provider_result = await adapter.initiate_connection(
            request=ToolConnectionRequest(
                user_id=str(project_id),
                integration_key=integration_key,
                auth_scheme=connection_create_data.auth_scheme.value
                if connection_create_data and connection_create_data.auth_scheme
                else None,
                callback_url=callback_url,
            ),
        )

        # Merge provider-returned connection_data with service-level project_id.
        # The adapter owns provider-specific field names; the service adds project scope.
        data: Dict[str, Any] = dict(provider_result.connection_data)
        data["project_id"] = str(project_id)
        connection_create.data = data  # type: ignore[assignment]

        # Persist locally
        return await self.tools_dao.create_connection(
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
        # Look up connection
        conn = await self.tools_dao.get_connection(
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
        return await self.tools_dao.delete_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def revoke_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> ToolConnection:
        """Mark a connection invalid locally without touching the provider."""
        conn = await self.tools_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

        if not conn:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

        updated = await self.tools_dao.update_connection(
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
    ) -> ToolConnection:
        conn = await self.tools_dao.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

        if not conn:
            raise ConnectionNotFoundError(
                connection_id=str(connection_id),
            )

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
        )
        callback_url = (
            f"{env.agenta.api_url}/preview/tools/connections/callback?state={state}"
        )

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
        provider_connection_id = result.get("id") or provider_connection_id
        auth_config_id = result.get("auth_config_id")
        is_valid = result.get("is_valid", conn.is_valid)

        redirect_url = result.get("redirect_url")
        # Always overwrite redirect_url so FE doesn't reuse stale links from prior flows.
        data_update = {"redirect_url": redirect_url}
        if auth_config_id:
            data_update["auth_config_id"] = auth_config_id

        updated = await self.tools_dao.update_connection(
            project_id=project_id,
            connection_id=connection_id,
            is_valid=is_valid,
            provider_connection_id=provider_connection_id,
            data_update=data_update,
        )

        return updated or conn

    # -----------------------------------------------------------------------
    # Tool execution
    # -----------------------------------------------------------------------

    async def execute_tool(
        self,
        *,
        provider_key: str,
        integration_key: str,
        action_key: str,
        provider_connection_id: str,
        user_id: Optional[str] = None,
        arguments: Dict[str, Any],
    ) -> ToolExecutionResponse:
        """Execute a tool action using the provider adapter."""
        adapter = self.adapter_registry.get(provider_key)

        return await adapter.execute(
            request=ToolExecutionRequest(
                integration_key=integration_key,
                action_key=action_key,
                provider_connection_id=provider_connection_id,
                user_id=user_id,
                arguments=arguments,
            ),
        )
