from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.catalog.service import CatalogService
from oss.src.core.gateway.connections.service import ConnectionsService

from oss.src.core.tools.dtos import (
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogIntegration,
    ToolCatalogProvider,
    ToolConnection,
    ToolConnectionCreate,
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
        catalog_service: CatalogService,
        adapter_registry: ToolsGatewayRegistry,
    ):
        self.connections_service = connections_service
        self.catalog_service = catalog_service
        self.adapter_registry = adapter_registry

    # -----------------------------------------------------------------------
    # Catalog browse — providers + integrations come from the SHARED gateway
    # catalog service; this layer narrows them to the tools subclass DTOs so the
    # router only ever sees tools-domain types. Actions are the tools-specific
    # leaf (via the tools adapter).
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[ToolCatalogProvider]:
        providers = await self.catalog_service.list_providers()
        return [ToolCatalogProvider.model_validate(p.model_dump()) for p in providers]

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[ToolCatalogProvider]:
        provider = await self.catalog_service.get_provider(provider_key=provider_key)
        if not provider:
            return None
        return ToolCatalogProvider.model_validate(provider.model_dump())

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
        integrations, next_cursor, total = await self.catalog_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = [
            ToolCatalogIntegration.model_validate(i.model_dump()) for i in integrations
        ]
        return items, next_cursor, total

    async def get_integration(
        self,
        *,
        provider_key: str,
        integration_key: str,
    ) -> Optional[ToolCatalogIntegration]:
        integration = await self.catalog_service.get_integration(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        if not integration:
            return None
        return ToolCatalogIntegration.model_validate(integration.model_dump())

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

    @staticmethod
    def _as_tool_connection(conn) -> Optional[ToolConnection]:
        return ToolConnection.model_validate(conn.model_dump()) if conn else None

    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[ToolConnection]:
        conns = await self.connections_service.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=is_active,
        )
        return [ToolConnection.model_validate(c.model_dump()) for c in conns]

    async def list_connections(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> List[ToolConnection]:
        conns = await self.connections_service.list_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
        )
        return [ToolConnection.model_validate(c.model_dump()) for c in conns]

    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ToolConnection]:
        conn = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        return self._as_tool_connection(conn)

    async def find_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
    ) -> Optional[ToolConnection]:
        conn = await self.connections_service.find_connection_by_provider_connection_id(
            provider_connection_id=provider_connection_id,
        )
        return self._as_tool_connection(conn)

    async def activate_connection_by_provider_connection_id(
        self,
        *,
        provider_connection_id: str,
        project_id: Optional[UUID] = None,
    ) -> Optional[ToolConnection]:
        conn = await self.connections_service.activate_connection_by_provider_connection_id(
            provider_connection_id=provider_connection_id,
            project_id=project_id,
        )
        return self._as_tool_connection(conn)

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: ToolConnectionCreate,
    ) -> ToolConnection:
        conn = await self.connections_service.initiate_connection(
            project_id=project_id,
            user_id=user_id,
            #
            connection_create=connection_create,
        )
        return ToolConnection.model_validate(conn.model_dump())

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
    ) -> ToolConnection:
        conn = await self.connections_service.revoke_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        return ToolConnection.model_validate(conn.model_dump())

    async def refresh_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        force: bool = False,
    ) -> ToolConnection:
        conn = await self.connections_service.refresh_connection(
            project_id=project_id,
            connection_id=connection_id,
            force=force,
        )
        return ToolConnection.model_validate(conn.model_dump())

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
