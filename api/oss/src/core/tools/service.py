import asyncio
import re
from difflib import get_close_matches
from time import perf_counter
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.catalog.service import CatalogService
from oss.src.core.gateway.connections.service import ConnectionsService

from oss.src.core.tools.dtos import (
    BuiltinTool,
    CapabilitiesResult,
    ComposioTool,
    ConnectAffordance,
    ConnectionRequirement,
    GatewayConnectionTool,
    GatewaySearchResult,
    ResolvedGatewayConnection,
    ResolvedGatewayTool,
    ResolvedTool,
    ToolAuthScheme,
    ToolCatalogActionDetails,
    ToolCatalogActionsPage,
    ToolCatalogCategory,
    ToolCatalogEntry,
    ToolCatalogIntegration,
    ToolCatalogIntegrationsPage,
    ToolCatalogProvider,
    ToolConnection,
    ToolConnectionCreate,
    ToolConnectionState,
    ToolExecutionRequest,
    ToolExecutionResponse,
    ToolProviderKind,
    ToolReference,
    ToolsResolution,
)
from oss.src.core.tools.discovery import (
    is_object_schema,
    looks_like_trigger,
    referenced_integrations,
    split_composio_slug,
    translate_runtime_search,
    translate_search_result,
)
from oss.src.core.tools.exceptions import (
    ActionNotFoundError,
    AdapterError,
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
    ToolKeyNotFoundError,
    ToolNotInIntegrationError,
    ToolsError,
    ToolSlugInvalidError,
)
from oss.src.core.tools.providers.composio.dtos import ComposioSearchResult
from oss.src.core.tools.registry import ToolsGatewayRegistry
from oss.src.utils.caching import get_cache, set_cache


log = get_module_logger(__name__)

_SLUG_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9-]+(?:_[a-zA-Z0-9-]+)*$")


def _validate_slug_segments(provider_key: str, segments: Iterable[str]) -> None:
    """Refuse a routing segment outside the safe allowlist before it reaches a provider."""
    segments = list(segments)
    for segment in segments:
        if not _SLUG_SEGMENT_RE.match(segment):
            raise ToolSlugInvalidError(
                slug=".".join([provider_key, *segments]),
                detail=f"Invalid slug segment: {segment!r}",
            )


# Discovery (discover_tools): cache the tool/schema half, recompute connection
# state fresh (D6). Project-agnostic key — the search is global, only the
# connection-state join is project-scoped.
_DISCOVERY_CACHE_NAMESPACE = "tools:discover"
_DEFAULT_LIMIT_ALTERNATIVES = 3

# Whole-catalog cache: one entry holds every tool of one integration. The router's
# ``tools:catalog:*`` entries cannot serve this — each holds one page of one query,
# and they sit above the service. Shares the trigger catalog's TTL and deadline:
# both are the same project-agnostic Composio catalog data.
#
# This is the ONLY catalog cache keyed by toolkit version, and deliberately so. It is
# the only one a run reads, and it holds entries for 24 hours, so an unversioned key
# here can execute a run against a snapshot a full day older than the alias it was
# resolved from. The router's browse caches (``tools:catalog:actions``, ``:action``,
# ``:integration``, and the rest) always ask for latest, hold entries for 5 minutes,
# and feed display only — no execution reads them, and they self-correct within the
# TTL. Versioning them would pin browsing to a run's version, which is the wrong
# answer for a person looking at what an integration offers now.
_CATALOG_CACHE_NAMESPACE = "tools:catalog:all"

# Enough to correct a typo without turning the error into a menu.
_MAX_TOOL_KEY_SUGGESTIONS = 5


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
        category: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> ToolCatalogIntegrationsPage:
        page = await self.catalog_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            category=category,
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

    async def list_categories(
        self,
        *,
        provider_key: str,
    ) -> List[ToolCatalogCategory]:
        categories = await self.catalog_service.list_categories(
            provider_key=provider_key,
        )
        return [ToolCatalogCategory.model_validate(c.model_dump()) for c in categories]

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

    async def list_all_actions(
        self,
        *,
        provider_key: str,
        integration_key: str,
        toolkit_version: Optional[str] = None,
    ) -> List[ToolCatalogEntry]:
        """Return every tool of one integration, as identity plus the read-only hint.

        Resolution, action detail, and execution all read tool identity from here, so
        a tool key maps to exactly one provider action ID on every path. The provider
        crawl is bounded by a deadline and its result is cached whole; a crawl that
        cannot finish raises, so a partial catalog never reaches the cache.
        """
        started = perf_counter()
        cache_key = {
            "provider": provider_key,
            "integration": integration_key,
            "toolkit_version": toolkit_version or "latest",
        }
        cached = await get_cache(
            namespace=_CATALOG_CACHE_NAMESPACE,
            key=cache_key,
            model=ToolCatalogEntry,
            is_list=True,
        )
        if cached is not None:
            log.info(
                "[tools.catalog] catalog slice returned",
                integration=integration_key,
                tool_count=len(cached),
                latency_ms=round((perf_counter() - started) * 1000),
                cache_hit=True,
            )
            return cached

        adapter = self.adapter_registry.get(provider_key)
        try:
            actions = await asyncio.wait_for(
                adapter.list_all_actions(
                    integration_key=integration_key,
                    toolkit_version=toolkit_version,
                ),
                timeout=env.composio.catalog_fetch_deadline_seconds,
            )
        except asyncio.TimeoutError as e:
            raise AdapterError(
                provider_key=provider_key,
                operation="list_all_actions",
                detail="catalog fetch deadline exceeded",
            ) from e

        entries = [
            ToolCatalogEntry(
                key=action.key,
                provider_action_id=action.provider_action_id,
                read_only=action.read_only,
                input_schema=action.input_schema,
            )
            for action in actions
            if action.provider_action_id
        ]
        await set_cache(
            namespace=_CATALOG_CACHE_NAMESPACE,
            key=cache_key,
            value=entries,
            ttl=env.composio.catalog_cache_ttl_seconds,
        )
        log.info(
            "[tools.catalog] catalog slice returned",
            integration=integration_key,
            tool_count=len(entries),
            latency_ms=round((perf_counter() - started) * 1000),
            cache_hit=False,
        )
        return entries

    async def _provider_action_id(
        self,
        *,
        provider_key: str,
        integration_key: str,
        action_key: str,
        toolkit_version: Optional[str] = None,
    ) -> Optional[str]:
        """Look one tool key up in the catalog, or None when the integration lacks it."""
        actions = await self.list_all_actions(
            provider_key=provider_key,
            integration_key=integration_key,
            toolkit_version=toolkit_version,
        )
        for action in actions:
            if action.key == action_key:
                return action.provider_action_id
        return None

    async def get_action(
        self,
        *,
        provider_key: str,
        integration_key: str,
        action_key: str,
        toolkit_version: Optional[str] = None,
    ) -> Optional[ToolCatalogActionDetails]:
        """Return full action detail including input/output schema, or None if not found."""
        provider_action_id = await self._provider_action_id(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=action_key,
            toolkit_version=toolkit_version,
        )
        if not provider_action_id:
            return None

        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_action(
            action_key=action_key,
            provider_action_id=provider_action_id,
            toolkit_version=toolkit_version,
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
        toolkit_version: str,
        provider_connection_id: Optional[str] = None,
        user_id: Optional[str] = None,
        arguments: Dict[str, Any],
    ) -> ToolExecutionResponse:
        """Execute a tool action using the provider adapter.

        Both call paths, the legacy five-segment reference and the gateway route,
        reach the provider through this one lookup.

        ``toolkit_version`` has no default on purpose. The gateway path passes the
        version it resolved once for the run, and the legacy path passes the alias
        explicitly. A default would let a new caller reach the provider on ``latest``
        without saying so, which is the stale-alias trap this signature exists to close.
        """
        provider_action_id = await self._provider_action_id(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=action_key,
            toolkit_version=toolkit_version,
        )
        if not provider_action_id:
            raise ActionNotFoundError(
                provider_key=provider_key,
                integration_key=integration_key,
                action_key=action_key,
            )

        adapter = self.adapter_registry.get(provider_key)

        return await adapter.execute(
            request=ToolExecutionRequest(
                integration_key=integration_key,
                action_key=action_key,
                provider_action_id=provider_action_id,
                toolkit_version=toolkit_version,
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
        A ``gateway_connection`` entry validates the same connection and answers with
        the whole catalog slice instead. One request may carry both formats.
        """
        builtins: List[str] = []
        custom: List[ResolvedTool] = []
        gateway_connections: List[ResolvedGatewayConnection] = []

        for ref in tools:
            if isinstance(ref, BuiltinTool):
                if ref.name:
                    builtins.append(ref.name)
                continue

            if isinstance(ref, GatewayConnectionTool):
                gateway_connections.append(
                    await self._resolve_gateway_connection(
                        project_id=project_id,
                        ref=ref,
                    )
                )
                continue

            if isinstance(ref, ComposioTool):
                custom.append(
                    await self._resolve_composio_tool(
                        project_id=project_id,
                        ref=ref,
                    )
                )

        return ToolsResolution(
            builtins=builtins,
            custom=custom,
            gateway_connections=gateway_connections,
        )

    async def _resolve_gateway_connection(
        self,
        *,
        project_id: UUID,
        ref: GatewayConnectionTool,
    ) -> ResolvedGatewayConnection:
        """Validate one connection entry and return its whole catalog slice.

        Permission lives in the entry's ``policy`` and is compiled by the SDK, so this
        returns tool identity and ``read_only`` only.
        """
        provider_key = ref.connection.provider
        integration_key = ref.connection.integration
        connection_slug = ref.connection.slug

        _validate_slug_segments(provider_key, (integration_key, connection_slug))

        await self.resolve_connection_by_slug(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

        adapter = self.adapter_registry.get(provider_key)
        toolkit_version = await adapter.resolve_toolkit_version(
            integration_key=integration_key,
            version="latest",
        )
        actions = await self.list_all_actions(
            provider_key=provider_key,
            integration_key=integration_key,
            toolkit_version=toolkit_version,
        )

        return ResolvedGatewayConnection(
            provider=provider_key,
            integration=integration_key,
            connection=connection_slug,
            toolkit_version=toolkit_version,
            tools=[
                ResolvedGatewayTool(key=action.key, read_only=action.read_only)
                for action in actions
            ],
        )

    async def _resolve_composio_tool(
        self,
        *,
        project_id: UUID,
        ref: ComposioTool,
    ) -> ResolvedTool:
        provider_key = ToolProviderKind.COMPOSIO.value

        _validate_slug_segments(
            provider_key, (ref.integration, ref.action, ref.connection)
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

    # -----------------------------------------------------------------------
    # Runtime gateway tools (gateway.search / gateway.run)
    # -----------------------------------------------------------------------

    async def search_gateway_tools(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        query: str,
        toolkit_versions: Dict[str, str],
        integration_key: Optional[str] = None,
    ) -> List[GatewaySearchResult]:
        """Search the provider and answer in Agenta integration and tool keys.

        Permission is not applied here and cannot be: the agent's configured set lives
        in the runner's private policy, so the runner filters the list it gets back.

        Provider search ranks against the CURRENT catalog and cannot be asked for a
        toolkit version, so every schema it returns is replaced with the schema from the
        version this run pinned. ``toolkit_versions`` is that pin, one per integration,
        and it is also the join: a result whose integration is not in it, or whose key
        the pinned catalog does not hold, is dropped rather than answered from a version
        the run will not execute.
        """
        started = perf_counter()
        try:
            search, cache_hit = await self._cached_search(
                provider_key=provider_key,
                project_id=project_id,
                use_cases=[query],
                toolkits=[integration_key] if integration_key else None,
            )
        except AdapterError as e:
            log.warning(
                "[gateway.search] provider search failed",
                error=type(e).__name__,
                detail=e.detail,
                retryable=True,
                integration=integration_key,
            )
            raise

        ranked = translate_runtime_search(search, integration=integration_key)
        results = await self._pin_search_schemas(
            provider_key=provider_key,
            results=ranked,
            toolkit_versions=toolkit_versions,
        )
        log.info(
            "[gateway.search] provider search returned",
            latency_ms=round((perf_counter() - started) * 1000),
            cache_hit=cache_hit,
            ranked_count=len(ranked),
            result_count=len(results),
            integration=integration_key,
        )
        return results

    async def _pin_search_schemas(
        self,
        *,
        provider_key: str,
        results: List[GatewaySearchResult],
        toolkit_versions: Dict[str, str],
    ) -> List[GatewaySearchResult]:
        """Answer every ranked hit from the pinned catalog, or not at all.

        One catalog read per integration that actually appears in the results, so an
        unscoped search over many configured integrations does not read catalogs it has
        no hit for.
        """
        catalogs: Dict[str, Dict[str, ToolCatalogEntry]] = {}
        pinned: List[GatewaySearchResult] = []

        for result in results:
            version = toolkit_versions.get(result.integration)
            if not version:
                continue
            if result.integration not in catalogs:
                entries = await self.list_all_actions(
                    provider_key=provider_key,
                    integration_key=result.integration,
                    toolkit_version=version,
                )
                catalogs[result.integration] = {entry.key: entry for entry in entries}

            entry = catalogs[result.integration].get(result.tool)
            if entry is None or not is_object_schema(entry.input_schema):
                continue
            pinned.append(
                result.model_copy(update={"input_schema": entry.input_schema})
            )

        return pinned

    @staticmethod
    def _unknown_tool_key(
        *,
        integration_key: str,
        tool_key: str,
        catalog: List[ToolCatalogEntry],
    ) -> ToolsError:
        """Say which of the two mistakes a key that is not in this catalog looks like.

        A near miss of a real key is a typo, and close keys are what fixes it. A key
        that resembles nothing here and whose own prefix names something other than
        this integration is the other mistake: a tool of a different integration. That
        is the only cross-integration claim the API can prove, because it holds one
        integration's catalog and never the agent's configured set.
        """
        suggestions = get_close_matches(
            tool_key,
            [entry.key for entry in catalog],
            n=_MAX_TOOL_KEY_SUGGESTIONS,
        )
        if not suggestions:
            prefix, _ = split_composio_slug(tool_key, [integration_key])
            if prefix != integration_key.lower():
                return ToolNotInIntegrationError(
                    integration_key=integration_key,
                    tool_key=tool_key,
                )
        return ToolKeyNotFoundError(
            integration_key=integration_key,
            tool_key=tool_key,
            suggestions=suggestions,
        )

    async def run_gateway_tool(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
        tool_key: str,
        toolkit_version: str,
        arguments: Dict[str, Any],
    ) -> ToolExecutionResponse:
        """Run one integration tool through the selected connection.

        Identity only: the caller has already decided that the agent may run this tool.
        The connection must be usable and the tool key must belong to that integration's
        catalog, which is also where the canonical provider action ID comes from.
        """
        _validate_slug_segments(provider_key, (integration_key, connection_slug))

        connection = await self.resolve_connection_by_slug(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            connection_slug=connection_slug,
        )

        catalog = await self.list_all_actions(
            provider_key=provider_key,
            integration_key=integration_key,
            toolkit_version=toolkit_version,
        )
        if not any(entry.key == tool_key for entry in catalog):
            raise self._unknown_tool_key(
                integration_key=integration_key,
                tool_key=tool_key,
                catalog=catalog,
            )

        # The Composio user is the project the connection was initiated under.
        user_id = (
            connection.data.get("project_id")
            if isinstance(connection.data, dict)
            else None
        )

        started = perf_counter()
        result = await self.execute_tool(
            provider_key=provider_key,
            integration_key=integration_key,
            action_key=tool_key,
            toolkit_version=toolkit_version,
            provider_connection_id=connection.provider_connection_id,
            user_id=user_id,
            arguments=arguments,
        )
        log.info(
            "[gateway.run] provider execution finished",
            integration=integration_key,
            tool=tool_key,
            outcome="successful" if result.successful else "failed",
            latency_ms=round((perf_counter() - started) * 1000),
        )
        return result

    # -----------------------------------------------------------------------
    # Tool discovery (discover_tools)
    # -----------------------------------------------------------------------

    async def discover_capabilities(
        self,
        *,
        project_id: UUID,
        use_cases: List[str],
        provider_key: str = ToolProviderKind.COMPOSIO.value,
        limit_alternatives: int = _DEFAULT_LIMIT_ALTERNATIVES,
    ) -> CapabilitiesResult:
        """Discover tools for a set of use_cases, translated to Agenta concepts.

        Splits the work per D6: the expensive tool/schema half (the provider's
        semantic search) is cached project-agnostically; connection state is
        recomputed fresh from the project's ``gateway_connections`` rows every call,
        so it never goes stale when a user finishes connecting.
        """
        search, _ = await self._cached_search(
            provider_key=provider_key,
            project_id=project_id,
            use_cases=use_cases,
        )

        states: Dict[str, ConnectionRequirement] = {}
        for integration in referenced_integrations(
            search, limit_alternatives=limit_alternatives
        ):
            states[integration] = await self._discovery_connection_state(
                project_id=project_id,
                provider_key=provider_key,
                integration_key=integration,
            )

        trigger_use_cases = {u for u in use_cases if looks_like_trigger(u)}

        return translate_search_result(
            search,
            states,
            limit_alternatives=limit_alternatives,
            trigger_use_cases=trigger_use_cases,
        )

    async def _cached_search(
        self,
        *,
        provider_key: str,
        project_id: UUID,
        use_cases: List[str],
        toolkits: Optional[List[str]] = None,
    ) -> Tuple[ComposioSearchResult, bool]:
        """Run one provider search, or replay the cached one. True means it was cached."""
        cache_key = {
            "provider": provider_key,
            "use_cases": "\x1f".join(use_cases),
            # A scoped search answers a different question from an unscoped one, so it
            # needs its own entry rather than replaying the wider result.
            "toolkits": "\x1f".join(toolkits or []),
        }
        cached = await get_cache(
            namespace=_DISCOVERY_CACHE_NAMESPACE,
            key=cache_key,
            model=ComposioSearchResult,
        )
        if cached is not None:
            return cached, True

        adapter = self.adapter_registry.get(provider_key)
        search = await adapter.search_capabilities(
            use_cases=use_cases,
            user_id=str(project_id),
            toolkits=toolkits,
        )

        # Cache only the tool/schema half (D6): drop the per-project connection
        # state so the cached blob is project-agnostic and never makes a later
        # call's connection state stale. State is recomputed fresh below.
        cacheable = search.model_copy(update={"toolkit_connection_statuses": []})
        await set_cache(
            namespace=_DISCOVERY_CACHE_NAMESPACE,
            key=cache_key,
            value=cacheable,
        )
        return cacheable, False

    async def _discovery_connection_state(
        self,
        *,
        project_id: UUID,
        provider_key: str,
        integration_key: str,
    ) -> ConnectionRequirement:
        """Resolve one integration's connection state from the project's rows.

        ``ready`` mirrors what ``resolve_connection_by_slug`` accepts at invoke time
        (active + valid + a usable provider connection), so a ``ready`` here means
        the tool will actually resolve. Otherwise the state is ``needs_auth`` /
        ``needs_input`` from the integration's auth scheme, with the create
        affordance attached.
        """
        connections = await self.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=None,
        )
        ready = next(
            (
                c
                for c in connections
                if c.is_active
                and c.is_valid
                and (c.provider_connection_id or not c.has_auth)
            ),
            None,
        )
        if ready is not None:
            return ConnectionRequirement(
                integration=integration_key,
                state=ToolConnectionState.READY,
                slug=ready.slug,
            )

        state = await self._connection_auth_state(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        # Suggest a free slug: an inactive/invalid row may already hold
        # ``<integration>-main``, and resolve_connection_by_slug can't disambiguate
        # duplicate slugs, so don't propose one that already exists.
        existing_slugs = {c.slug for c in connections if c.slug}
        connect_slug = f"{integration_key}-main"
        suffix = 2
        while connect_slug in existing_slugs:
            connect_slug = f"{integration_key}-main-{suffix}"
            suffix += 1
        return ConnectionRequirement(
            integration=integration_key,
            state=state,
            connect=ConnectAffordance(
                body={
                    "connection": {
                        "provider_key": provider_key,
                        "integration_key": integration_key,
                        "slug": connect_slug,
                    }
                }
            ),
        )

    async def _connection_auth_state(
        self,
        *,
        provider_key: str,
        integration_key: str,
    ) -> ToolConnectionState:
        """needs_auth (OAuth) vs needs_input (API key) from the catalog auth scheme."""
        integration = await self.get_integration(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        schemes = integration.auth_schemes if integration else None
        if (
            schemes
            and ToolAuthScheme.API_KEY in schemes
            and ToolAuthScheme.OAUTH not in schemes
        ):
            return ToolConnectionState.NEEDS_INPUT
        # Default to OAuth: most Composio integrations are OAuth, and an unknown
        # scheme is safest surfaced as an OAuth-style "authorize" affordance.
        return ToolConnectionState.NEEDS_AUTH
