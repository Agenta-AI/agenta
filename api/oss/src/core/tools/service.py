from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.connections.dtos import Connection, ConnectionCreate
from oss.src.core.gateway.connections.service import ConnectionsService

from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogIntegration,
    ToolCatalogProvider,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from oss.src.core.tools.registry import ToolsGatewayRegistry


log = get_module_logger(__name__)


class ToolsService:
    def __init__(
        self,
        *,
        connections_service: ConnectionsService,
        adapter_registry: ToolsGatewayRegistry,
    ):
        self.connections_service = connections_service
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
    # Connection management (delegated to ConnectionsService — one-way dep)
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
        return await self.connections_service.query_connections(
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
        return await self.connections_service.list_connections(
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
        return await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def find_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
    ) -> Optional[Connection]:
        return await self.connections_service.find_connection_by_provider_connection_id(
            provider_connection_id=provider_connection_id,
        )

    async def activate_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
        project_id: Optional[UUID] = None,
    ) -> Optional[Connection]:
        return await self.connections_service.activate_connection_by_provider_connection_id(
            provider_connection_id=provider_connection_id,
            project_id=project_id,
        )

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ConnectionCreate,
    ) -> Connection:
        return await self.connections_service.initiate_connection(
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
        return await self.connections_service.delete_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def revoke_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Connection:
        return await self.connections_service.revoke_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def refresh_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        force: bool = False,
    ) -> Connection:
        return await self.connections_service.refresh_connection(
            project_id=project_id,
            connection_id=connection_id,
            force=force,
        )

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
