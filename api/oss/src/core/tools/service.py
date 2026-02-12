from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Windowing

from oss.src.core.tools.dtos import (
    ActionQuery,
    CatalogAction,
    CatalogIntegration,
    CatalogProvider,
    ConnectResult,
    Connection,
    ConnectionCreate,
    Tags,
    ToolQuery,
)
from oss.src.core.tools.interfaces import (
    ToolsDAOInterface,
)
from oss.src.core.tools.adapters.registry import GatewayAdapterRegistry
from oss.src.core.tools.exceptions import (
    ConnectionNotFoundError,
)


log = get_module_logger(__name__)


class ToolsService:
    def __init__(
        self,
        *,
        tools_dao: ToolsDAOInterface,
        adapter_registry: GatewayAdapterRegistry,
    ):
        self.tools_dao = tools_dao
        self.adapter_registry = adapter_registry

    # -----------------------------------------------------------------------
    # Catalog browse
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[CatalogProvider]:
        results: List[CatalogProvider] = []
        for _key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[CatalogProvider]:
        adapter = self.adapter_registry.get(provider_key)
        providers = await adapter.list_providers()
        for p in providers:
            if p.key == provider_key:
                return p
        return None

    async def list_integrations(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        #
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogIntegration]:
        adapter = self.adapter_registry.get(provider_key)
        integrations = await adapter.list_integrations(
            search=search,
            limit=limit,
        )

        # Enrich with local connection counts
        connections = await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
        )
        counts = _count_by_integration(connections)
        for integration in integrations:
            integration.connections_count = counts.get(integration.key, 0)

        return integrations

    async def get_integration(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> Optional[CatalogIntegration]:
        adapter = self.adapter_registry.get(provider_key)
        integrations = await adapter.list_integrations()
        target = None
        for i in integrations:
            if i.key == integration_key:
                target = i
                break

        if not target:
            return None

        # Enrich with connection count
        connections = await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
        )
        target.connections_count = len(connections)

        return target

    async def list_actions(
        self,
        *,
        provider_key: str,
        integration_key: str,
        #
        search: Optional[str] = None,
        tags: Optional[Tags] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogAction]:
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.list_actions(
            integration_key=integration_key,
            search=search,
            tags=tags,
            important=important,
            limit=limit,
        )

    async def get_action(
        self,
        *,
        provider_key: str,
        integration_key: str,
        action_key: str,
    ) -> Optional[CatalogAction]:
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_action(
            integration_key=integration_key,
            action_key=action_key,
        )

    # -----------------------------------------------------------------------
    # Catalog query
    # -----------------------------------------------------------------------

    async def query_catalog(
        self,
        *,
        action_query: Optional[ActionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[CatalogAction]:
        query = action_query or ActionQuery()

        # Determine which providers to query
        provider_keys = (
            [query.provider_key] if query.provider_key else self.adapter_registry.keys()
        )

        all_actions: List[CatalogAction] = []
        for pk in provider_keys:
            adapter = self.adapter_registry.get(pk)

            if query.integration_key:
                actions = await adapter.list_actions(
                    integration_key=query.integration_key,
                    search=query.name,
                    tags=query.tags,
                )
                all_actions.extend(actions)
            else:
                # No integration filter — fetch all integrations first
                integrations = await adapter.list_integrations()
                for integ in integrations:
                    actions = await adapter.list_actions(
                        integration_key=integ.key,
                        search=query.name,
                        tags=query.tags,
                    )
                    all_actions.extend(actions)

        # Apply windowing (in-memory for now)
        if windowing and windowing.limit:
            all_actions = all_actions[: windowing.limit]

        return all_actions

    # -----------------------------------------------------------------------
    # Tool query (action × connection join)
    # -----------------------------------------------------------------------

    async def query_tools(
        self,
        *,
        project_id: UUID,
        #
        tool_query: Optional[ToolQuery] = None,
        #
        include_connections: Optional[bool] = True,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Returns (tools, count) where each tool is a dict matching the Tool response model."""
        query = tool_query or ToolQuery()

        # Determine which providers to query
        provider_keys = (
            [query.provider_key] if query.provider_key else self.adapter_registry.keys()
        )

        # 1. Fetch actions from adapters
        all_actions: List[Tuple[str, CatalogAction, CatalogIntegration]] = []
        for pk in provider_keys:
            adapter = self.adapter_registry.get(pk)

            if query.integration_key:
                integration_keys = [query.integration_key]
            else:
                integrations = await adapter.list_integrations()
                integration_keys = [i.key for i in integrations]

            integrations_map: Dict[str, CatalogIntegration] = {}
            for ik in integration_keys:
                integ_list = await adapter.list_integrations()
                for i in integ_list:
                    if i.key == ik:
                        integrations_map[ik] = i
                        break

                actions = await adapter.list_actions(
                    integration_key=ik,
                    search=query.name,
                    tags=query.tags,
                )
                for action in actions:
                    integ = integrations_map.get(ik)
                    if integ:
                        all_actions.append((pk, action, integ))

        # 2. Fetch connections from DAO
        connections = await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=query.provider_key,
            integration_key=query.integration_key,
        )
        connections_by_key = _group_by_provider_integration(connections)

        # 3. Expand: action × connection → tools
        tools: List[Dict[str, Any]] = []
        for provider_key, action, integ in all_actions:
            conn_key = (provider_key, integ.key)
            conns = connections_by_key.get(conn_key, [])

            if conns:
                for conn in conns:
                    tools.append(
                        _make_tool(
                            provider_key=provider_key,
                            action=action,
                            integration=integ,
                            connection=conn if include_connections else None,
                            connection_slug=conn.slug,
                        )
                    )
            else:
                tools.append(
                    _make_tool(
                        provider_key=provider_key,
                        action=action,
                        integration=integ,
                        connection=None,
                        connection_slug=None,
                    )
                )

        # 4. Apply flags filter
        if query.flags and query.flags.is_connected is not None:
            if query.flags.is_connected:
                tools = [t for t in tools if t.get("connection") is not None]
            else:
                tools = [t for t in tools if t.get("connection") is None]

        # 5. Apply windowing
        if windowing and windowing.limit:
            tools = tools[: windowing.limit]

        return tools, len(tools)

    # -----------------------------------------------------------------------
    # Connection management
    # -----------------------------------------------------------------------

    async def list_connections(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> List[Connection]:
        return await self.tools_dao.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
        )

    async def get_connection(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> Optional[Connection]:
        conn = await self.tools_dao.get_connection(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

        if not conn:
            return None

        # If not yet valid, poll the adapter for updated status
        if not conn.is_valid and conn.provider_connection_id:
            adapter = self.adapter_registry.get(provider_key)
            status_info = await adapter.get_connection_status(
                provider_connection_id=conn.provider_connection_id,
            )

            if status_info.get("is_valid") and not conn.is_valid:
                conn = await self.tools_dao.update_connection(
                    project_id=project_id,
                    provider_key=provider_key,
                    integration_key=integration_key,
                    connection_slug=connection_slug,
                    is_valid=True,
                    status=status_info.get("status"),
                )

        return conn

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        provider_key: str,
        integration_key: str,
        #
        connection_create: ConnectionCreate,
    ) -> ConnectResult:
        adapter = self.adapter_registry.get(provider_key)

        # Initiate with provider
        provider_result = await adapter.initiate_connection(
            entity_id=f"project_{project_id}",
            integration_key=integration_key,
            callback_url=connection_create.callback_url,
        )

        provider_connection_id = provider_result.get("id")
        auth_config_id = provider_result.get("auth_config_id")
        redirect_url = provider_result.get("redirect_url")

        # Persist locally
        connection = await self.tools_dao.create_connection(
            project_id=project_id,
            user_id=user_id,
            #
            provider_key=provider_key,
            integration_key=integration_key,
            #
            connection_create=connection_create,
            #
            provider_connection_id=provider_connection_id,
            auth_config_id=auth_config_id,
        )

        return ConnectResult(
            connection=connection,
            redirect_url=redirect_url,
        )

    async def delete_connection(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ) -> bool:
        # Look up provider_connection_id
        conn = await self.tools_dao.get_connection(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

        if not conn:
            raise ConnectionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                connection_slug=connection_slug,
            )

        # Revoke provider-side
        if conn.provider_connection_id:
            adapter = self.adapter_registry.get(provider_key)
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
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

    async def refresh_connection(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
        #
        force: bool = False,
    ) -> ConnectResult:
        conn = await self.tools_dao.get_connection(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

        if not conn:
            raise ConnectionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                connection_slug=connection_slug,
            )

        if not conn.provider_connection_id:
            raise ConnectionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                connection_slug=connection_slug,
            )

        adapter = self.adapter_registry.get(provider_key)
        result = await adapter.refresh_connection(
            provider_connection_id=conn.provider_connection_id,
            force=force,
        )

        updated = await self.tools_dao.update_connection(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
            is_valid=result.get("is_valid", conn.is_valid),
            status=result.get("status"),
        )

        return ConnectResult(
            connection=updated or conn,
            redirect_url=result.get("redirect_url"),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _count_by_integration(connections: List[Connection]) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for conn in connections:
        counts[conn.integration_key] += 1
    return dict(counts)


def _group_by_provider_integration(
    connections: List[Connection],
) -> Dict[Tuple[str, str], List[Connection]]:
    groups: Dict[Tuple[str, str], List[Connection]] = defaultdict(list)
    for conn in connections:
        groups[(conn.provider_key, conn.integration_key)].append(conn)
    return dict(groups)


def _make_tool(
    *,
    provider_key: str,
    action: CatalogAction,
    integration: CatalogIntegration,
    connection: Optional[Connection],
    connection_slug: Optional[str],
) -> Dict[str, Any]:
    slug_parts = ["tools", provider_key, integration.key, action.key]
    if connection_slug:
        slug_parts.append(connection_slug)

    tool: Dict[str, Any] = {
        "slug": ".".join(slug_parts),
        "action_key": action.key,
        "name": action.name,
        "description": action.description,
        "tags": action.tags,
        "provider_key": provider_key,
        "integration_key": integration.key,
        "integration_name": integration.name,
        "integration_logo": integration.logo,
        "connection": None,
    }

    if connection:
        tool["connection"] = {
            "slug": connection.slug,
            "name": connection.name,
            "is_active": connection.is_active,
            "is_valid": connection.is_valid,
        }

    return tool
