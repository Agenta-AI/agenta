"""Composio catalog operations — mixin for ComposioToolsAdapter.

Provides catalog HTTP calls (list/get integrations, list actions) backed by
``self._client``, ``self.api_key``, and ``self.api_url`` which must be
supplied by the concrete subclass (ComposioToolsAdapter).

The ``cursor`` value is Composio's native ``next_cursor`` string, passed through
as-is between our API and Composio's API.
"""

from typing import Any, Dict, List, Optional, Tuple

import httpx

from oss.src.utils.logging import get_module_logger
from oss.src.core.tools.dtos import (
    ToolAuthScheme,
    ToolCatalogAction,
    ToolCatalogIntegration,
)
from oss.src.core.tools.exceptions import AdapterError


log = get_module_logger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 1000


# ---------------------------------------------------------------------------
# Catalog mixin
# ---------------------------------------------------------------------------


class ComposioCatalogClient:
    """Catalog mixin for ComposioToolsAdapter — cursor-based pagination.

    Subclass must set ``self.api_key``, ``self.api_url``, and
    ``self._client`` (an ``httpx.AsyncClient``) before calling any method.
    """

    # Annotated for type-checkers; filled in by ComposioToolsAdapter.__init__
    api_key: str
    api_url: str
    _client: httpx.AsyncClient

    # -----------------------------------------------------------------------
    # Integration count
    # -----------------------------------------------------------------------

    async def count_integrations(self) -> Optional[int]:
        """Fetch total integration count from Composio using a single minimal request."""
        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits",
                headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
                params={"limit": 1},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="count_integrations",
                detail=str(e),
            ) from e

        return data.get("total_items") if isinstance(data, dict) else None

    # -----------------------------------------------------------------------
    # Integration detail (single fetch by slug)
    # -----------------------------------------------------------------------

    async def get_integration(
        self,
        *,
        integration_key: str,
    ) -> Optional[ToolCatalogIntegration]:
        """Fetch a single integration by slug using GET /toolkits/{slug}.

        Returns None when the integration does not exist (404).
        """
        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits/{integration_key}",
                headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
                timeout=15.0,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise AdapterError(
                provider_key="composio",
                operation="get_integration",
                detail=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_integration",
                detail=str(e),
            ) from e

        return _parse_integration_detail(resp.json())

    # -----------------------------------------------------------------------
    # Integration listing
    # -----------------------------------------------------------------------

    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogIntegration], Optional[str], int]:
        """Fetch one page of integrations from Composio.

        Args:
            search: Optional search query (sent as ``search=`` to Composio /toolkits)
            sort_by: Optional sort — "usage" or "alphabetically"
            limit: Items per page (max 1000)
            cursor: Composio next_cursor from a previous response

        Returns:
            (items, next_cursor, total_items)
            next_cursor is None when on the last page
        """
        page_limit = min(limit, MAX_PAGE_SIZE) if limit else DEFAULT_PAGE_SIZE

        params: Dict[str, Any] = {"limit": page_limit}
        if search:
            params["search"] = search
        if sort_by:
            params["sort_by"] = sort_by
        if cursor:
            params["cursor"] = cursor

        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits",
                headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_integrations",
                detail=str(e),
            ) from e

        items_raw: List[Dict[str, Any]] = (
            data.get("items", []) if isinstance(data, dict) else data
        )
        next_cursor: Optional[str] = (
            data.get("next_cursor") if isinstance(data, dict) else None
        )
        total_items: int = (
            data.get("total_items", len(items_raw))
            if isinstance(data, dict)
            else len(items_raw)
        )

        items = [_parse_integration(item) for item in items_raw]

        log.debug(
            "[composio] list_integrations cursor=%s items=%d total=%d next=%s",
            cursor,
            len(items),
            total_items,
            next_cursor,
        )

        return items, next_cursor, total_items

    # -----------------------------------------------------------------------
    # Action listing
    # -----------------------------------------------------------------------

    async def list_actions(
        self,
        *,
        integration_key: str,
        query: Optional[str] = None,
        categories: Optional[List[str]] = None,
        important: Optional[bool] = None,  # reserved; not forwarded to Composio
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[ToolCatalogAction], Optional[str], int]:
        """Fetch one page of actions for an integration from Composio.

        Args:
            integration_key: Integration slug (e.g. "gmail")
            query: Optional full-text search (sent as ``query=`` to Composio /tools)
            categories: Optional category tags filter (mapped to Composio "tags" param)
            important: Reserved for future filtering; not forwarded upstream
            limit: Items per page (max 1000)
            cursor: Composio next_cursor from a previous response

        Returns:
            (items, next_cursor, total_items)
            next_cursor is None when on the last page
        """
        page_limit = min(limit, MAX_PAGE_SIZE) if limit else DEFAULT_PAGE_SIZE

        params: Dict[str, Any] = {
            "toolkit_slug": integration_key,
            "toolkit_versions": "latest",
            "include_deprecated": False,
            "limit": page_limit,
        }
        if query:
            params["query"] = query
        if categories:
            params["tags"] = (
                categories  # Our "categories" maps to Composio's "tags" param
            )
        if cursor:
            params["cursor"] = cursor

        try:
            resp = await self._client.get(
                f"{self.api_url}/tools",
                headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_actions",
                detail=str(e),
            ) from e

        items_raw: List[Dict[str, Any]] = (
            data.get("items", []) if isinstance(data, dict) else data
        )
        next_cursor: Optional[str] = (
            data.get("next_cursor") if isinstance(data, dict) else None
        )
        total_items: int = (
            data.get("total_items", len(items_raw))
            if isinstance(data, dict)
            else len(items_raw)
        )

        # Strip deprecated actions (belt-and-suspenders on top of the API param)
        items_raw = [item for item in items_raw if not item.get("is_deprecated")]

        items = [_parse_action(item, integration_key) for item in items_raw]

        log.debug(
            "[composio] list_actions(%s) cursor=%s items=%d total=%d next=%s",
            integration_key,
            cursor,
            len(items),
            total_items,
            next_cursor,
        )

        return items, next_cursor, total_items


# ---------------------------------------------------------------------------
# Parsers (module-level — no instance state needed)
# ---------------------------------------------------------------------------

# MCP behavioral hint strings injected by Composio — not semantic category labels
_MCP_HINTS: set = {
    "destructiveHint",
    "idempotentHint",
    "mcpIgnore",
    "openWorldHint",
    "readOnlyHint",
    "updateHint",
    "important",
}

_AUTH_SCHEME_MAP: Dict[str, ToolAuthScheme] = {
    "oauth": ToolAuthScheme.OAUTH,
    "oauth2": ToolAuthScheme.OAUTH,
    "oauth1": ToolAuthScheme.OAUTH,
    "api_key": ToolAuthScheme.API_KEY,
    "apikey": ToolAuthScheme.API_KEY,
    "api key": ToolAuthScheme.API_KEY,
}


def _parse_integration(item: Dict[str, Any]) -> ToolCatalogIntegration:
    meta = item.get("meta") or {}

    # V3: auth_schemes is a flat list of strings (e.g. ["oauth2", "api_key"])
    auth_schemes: List[ToolAuthScheme] = []
    for s in item.get("auth_schemes", []):
        mode = (s if isinstance(s, str) else s.get("auth_mode", "")).lower()
        mapped = _AUTH_SCHEME_MAP.get(mode)
        if mapped and mapped not in auth_schemes:
            auth_schemes.append(mapped)

    # V3: categories are under meta.categories as [{id, name}, ...]
    raw_cats = meta.get("categories") or []
    categories = [c["name"] if isinstance(c, dict) else str(c) for c in raw_cats if c]

    return ToolCatalogIntegration(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=meta.get("description"),
        logo=meta.get("logo"),
        url=meta.get("app_url"),
        actions_count=meta.get("tools_count"),
        auth_schemes=auth_schemes or None,
        categories=categories,
    )


def _parse_integration_detail(item: Dict[str, Any]) -> ToolCatalogIntegration:
    """Parse the response from GET /toolkits/{slug} (detail endpoint).

    The detail response places auth schemes in ``composio_managed_auth_schemes``
    (a list of objects with a ``name`` field) rather than a flat ``auth_schemes``
    list used by the listing endpoint.
    """
    meta = item.get("meta") or {}

    # Detail endpoint: composio_managed_auth_schemes is a list of objects with
    # at minimum a ``name`` field (e.g. "oauth2", "api_key").
    auth_schemes: List[ToolAuthScheme] = []
    for s in item.get("composio_managed_auth_schemes", []):
        if isinstance(s, dict):
            mode = (s.get("name") or s.get("auth_mode") or "").lower()
        else:
            mode = str(s).lower()
        mapped = _AUTH_SCHEME_MAP.get(mode)
        if mapped and mapped not in auth_schemes:
            auth_schemes.append(mapped)

    raw_cats = meta.get("categories") or []
    categories = [c["name"] if isinstance(c, dict) else str(c) for c in raw_cats if c]

    return ToolCatalogIntegration(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=meta.get("description"),
        logo=meta.get("logo"),
        url=meta.get("app_url"),
        actions_count=meta.get("tools_count"),
        auth_schemes=auth_schemes or None,
        categories=categories,
    )


def _parse_action(item: Dict[str, Any], integration_key: str) -> ToolCatalogAction:
    raw_tags = item.get("tags")
    # Tags mix MCP hint flags with semantic categories — strip the known hints
    categories = (
        [t for t in raw_tags if isinstance(t, str) and t not in _MCP_HINTS]
        if isinstance(raw_tags, list)
        else []
    )

    composio_slug = item.get("slug", "")
    prefix = f"{integration_key.upper()}_"
    action_key = (
        composio_slug[len(prefix) :]
        if composio_slug.startswith(prefix)
        else composio_slug
    )

    return ToolCatalogAction(
        key=action_key,
        name=item.get("name", ""),
        description=item.get("description"),
        categories=categories,
    )
