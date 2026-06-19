"""Composio catalog adapter — shared providers + integrations for the gateway.

Backs the shared ``CatalogService`` (tools AND triggers). Implements the
provider listing and integration browse/get against Composio ``/toolkits``,
returning the shared ``Catalog*`` DTOs. The per-domain leaf reads (tool actions
/ trigger events) live in their own domain adapters and are NOT here.

Parser logic mirrors ``core/tools/providers/composio/catalog.py`` (the prior
home of integration browse) so the wire shape is unchanged.
"""

from typing import Any, Dict, List, Optional, Tuple

import httpx

from oss.src.utils.logging import get_module_logger
from oss.src.core.gateway.catalog.dtos import (
    CatalogAuthScheme,
    CatalogIntegration,
    CatalogProvider,
)
from oss.src.core.gateway.catalog.interfaces import CatalogGatewayInterface
from oss.src.core.gateway.connections.exceptions import AdapterError
from oss.src.core.gateway.providers.composio.errors import composio_error_detail
from oss.src.utils.env import env


log = get_module_logger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 1000


class ComposioCatalogAdapter(CatalogGatewayInterface):
    """Composio V3 catalog adapter — cursor-based pagination over /toolkits."""

    def __init__(
        self,
        *,
        api_key: str,
        api_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.api_url = (api_url or env.composio.api_url).rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    def _headers(self) -> Dict[str, str]:
        return {"x-api-key": self.api_key, "Content-Type": "application/json"}

    async def _count_integrations(self) -> Optional[int]:
        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits",
                headers=self._headers(),
                params={"limit": 1},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="count_integrations",
                detail=composio_error_detail(e),
            ) from e

        return data.get("total_items") if isinstance(data, dict) else None

    async def list_providers(self) -> List[CatalogProvider]:
        integrations_count = await self._count_integrations()
        return [
            CatalogProvider(
                key="composio",
                name="Composio",
                description="Third-party integrations via Composio",
                integrations_count=integrations_count,
            )
        ]

    async def get_integration(
        self,
        *,
        integration_key: str,
    ) -> Optional[CatalogIntegration]:
        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits/{integration_key}",
                headers=self._headers(),
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
                detail=composio_error_detail(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_integration",
                detail=composio_error_detail(e),
            ) from e

        return _parse_integration_detail(resp.json())

    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[CatalogIntegration], Optional[str], int]:
        page_limit = min(limit, MAX_PAGE_SIZE) if limit else DEFAULT_PAGE_SIZE

        params: Dict[str, Any] = {"limit": page_limit}
        if search and len(search) >= 3:
            params["search"] = search
        if sort_by:
            params["sort_by"] = sort_by
        if cursor:
            params["cursor"] = cursor

        try:
            resp = await self._client.get(
                f"{self.api_url}/toolkits",
                headers=self._headers(),
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_integrations",
                detail=composio_error_detail(e),
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

        return items, next_cursor, total_items


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

_AUTH_SCHEME_MAP: Dict[str, CatalogAuthScheme] = {
    "oauth": CatalogAuthScheme.OAUTH,
    "oauth2": CatalogAuthScheme.OAUTH,
    "oauth1": CatalogAuthScheme.OAUTH,
    "api_key": CatalogAuthScheme.API_KEY,
    "apikey": CatalogAuthScheme.API_KEY,
    "api key": CatalogAuthScheme.API_KEY,
}


def _parse_integration(item: Dict[str, Any]) -> CatalogIntegration:
    meta = item.get("meta") or {}

    auth_schemes: List[CatalogAuthScheme] = []
    for s in item.get("auth_schemes", []):
        mode = (s if isinstance(s, str) else s.get("auth_mode", "")).lower()
        mapped = _AUTH_SCHEME_MAP.get(mode)
        if mapped and mapped not in auth_schemes:
            auth_schemes.append(mapped)

    raw_cats = meta.get("categories") or []
    categories = [c["name"] if isinstance(c, dict) else str(c) for c in raw_cats if c]

    return CatalogIntegration(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=meta.get("description"),
        logo=meta.get("logo"),
        url=meta.get("app_url"),
        actions_count=meta.get("tools_count"),
        auth_schemes=auth_schemes or None,
        categories=categories,
    )


def _parse_integration_detail(item: Dict[str, Any]) -> CatalogIntegration:
    """Parse GET /toolkits/{slug}; auth lives in composio_managed_auth_schemes."""
    meta = item.get("meta") or {}

    auth_schemes: List[CatalogAuthScheme] = []
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

    return CatalogIntegration(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=meta.get("description"),
        logo=meta.get("logo"),
        url=meta.get("app_url"),
        actions_count=meta.get("tools_count"),
        auth_schemes=auth_schemes or None,
        categories=categories,
    )
