import re
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.catalog.service import CatalogService
from oss.src.core.gateway.connections.service import ConnectionsService

from oss.src.core.tools.dtos import (
    BuiltinTool,
    ComposioTool,
    ResolvedTool,
    ToolCatalogActionDetails,
    ToolCatalogActionsPage,
    ToolCatalogIntegration,
    ToolCatalogIntegrationsPage,
    ToolCatalogProvider,
    ToolConnection,
    ToolConnectionCreate,
    ToolExecutionRequest,
    ToolExecutionResponse,
    ToolProviderKind,
    ToolReference,
    ToolsResolution,
)
from oss.src.core.tools.exceptions import (
    ActionNotFoundError,
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
    ToolSlugInvalidError,
)
from oss.src.core.tools.registry import ToolsGatewayRegistry


log = get_module_logger(__name__)

_SLUG_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9-]+(?:_[a-zA-Z0-9-]+)*$")


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
    ) -> ToolCatalogIntegrationsPage:
        page = await self.catalog_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = [
            ToolCatalogIntegration.model_validate(i.model_dump())
            for i in page.integrations
        ]
        return ToolCatalogIntegrationsPage(
            integrations=items,
            next_cursor=page.next_cursor,
            total=page.total,
        )

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
    ) -> ToolCatalogActionsPage:
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
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[ToolConnection]:
        conn = await self.connections_service.find_connection_by_provider_connection_id(
            project_id=project_id,
            provider_connection_id=provider_connection_id,
        )
        return self._as_tool_connection(conn)

    async def activate_connection_by_provider_connection_id(
        self,
        *,
        project_id: UUID,
        provider_connection_id: str,
    ) -> Optional[ToolConnection]:
        conn = await self.connections_service.activate_connection_by_provider_connection_id(
            project_id=project_id,
            provider_connection_id=provider_connection_id,
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
        provider_connection_id: Optional[str] = None,
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

    # -----------------------------------------------------------------------
    # Tool resolution (references → model-ready specs)
    # -----------------------------------------------------------------------

    async def resolve_connection_by_slug(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> ToolConnection:
        """Resolve a project-scoped connection slug to a usable connection row.

        Raises a domain exception when the connection is missing, inactive, invalid,
        or never finished its provider handshake. Shared by ``call_tool`` (execution)
        and ``resolve_tools`` (up-front validation).
        """
        # Query all (not active-only) so an inactive connection yields a precise
        # "inactive" error instead of an indistinguishable "not found".
        connections = await self.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=None,
        )

        connection = next(
            (c for c in connections if c.slug == connection_slug),
            None,
        )

        if not connection:
            raise ConnectionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                connection_slug=connection_slug,
            )

        if not connection.is_active:
            raise ConnectionInactiveError(connection_id=connection_slug)

        if not connection.is_valid:
            raise ConnectionInvalidError(
                connection_slug=connection_slug,
                detail="Please refresh the connection.",
            )

        # No-auth toolkits have no provider-side connected account; the missing id is
        # expected and execution runs without one.
        if connection.has_auth and not connection.provider_connection_id:
            raise ConnectionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                connection_slug=connection_slug,
            )

        return connection

    async def resolve_tools(
        self,
        *,
        project_id: UUID,
        tools: List[ToolReference],
    ) -> ToolsResolution:
        """Resolve a list of tool references into model-ready specs.

        ``builtin`` references pass through as names. ``composio`` references are
        validated against the project's connections up front and enriched from the
        catalog (description + input schema), so the model never sees a stale schema
        and the invoke fails fast on a missing/invalid connection rather than mid-loop.
        """
        builtins: List[str] = []
        custom: List[ResolvedTool] = []

        for ref in tools:
            if isinstance(ref, BuiltinTool):
                if ref.name:
                    builtins.append(ref.name)
                continue

            if isinstance(ref, ComposioTool):
                custom.append(
                    await self._resolve_composio_tool(
                        project_id=project_id,
                        ref=ref,
                    )
                )

        return ToolsResolution(builtins=builtins, custom=custom)

    async def _resolve_composio_tool(
        self,
        *,
        project_id: UUID,
        ref: ComposioTool,
    ) -> ResolvedTool:
        provider_key = ToolProviderKind.COMPOSIO.value

        for segment in (ref.integration, ref.action, ref.connection):
            if not _SLUG_SEGMENT_RE.match(segment):
                raise ToolSlugInvalidError(
                    slug=f"{provider_key}.{ref.integration}.{ref.action}.{ref.connection}",
                    detail=f"Invalid slug segment: {segment!r}",
                )

        # Fail fast if the connection is missing/inactive/invalid for this project.
        await self.resolve_connection_by_slug(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=ref.integration,
            connection_slug=ref.connection,
        )

        action = await self.get_action(
            provider_key=provider_key,
            integration_key=ref.integration,
            action_key=ref.action,
        )
        if not action:
            raise ActionNotFoundError(
                provider_key=provider_key,
                integration_key=ref.integration,
                action_key=ref.action,
            )

        input_schema = (
            action.schemas.inputs if action.schemas and action.schemas.inputs else None
        )
        name = ref.name or f"{ref.integration}__{ref.action}"
        call_ref = (
            f"tools.{provider_key}.{ref.integration}.{ref.action}.{ref.connection}"
        )

        return ResolvedTool(
            name=name,
            description=action.description,
            input_schema=input_schema,
            call_ref=call_ref,
            read_only=action.read_only,
        )
