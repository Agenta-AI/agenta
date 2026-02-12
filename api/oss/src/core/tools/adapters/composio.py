from typing import Any, Dict, List, Optional

import httpx

from oss.src.utils.logging import get_module_logger

from oss.src.core.tools.dtos import (
    CatalogAction,
    CatalogIntegration,
    CatalogProvider,
    ExecutionResult,
    Tags,
)
from oss.src.core.tools.interfaces import GatewayAdapterInterface
from oss.src.core.tools.exceptions import AdapterError


log = get_module_logger(__name__)

COMPOSIO_DEFAULT_BASE_URL = "https://backend.composio.dev/api/v3"


class ComposioAdapter(GatewayAdapterInterface):
    """Composio V3 API adapter — uses httpx directly (no SDK)."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = COMPOSIO_DEFAULT_BASE_URL,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> Dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    async def _get(
        self,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}{path}",
                headers=self._headers(),
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(
        self,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}{path}",
                headers=self._headers(),
                json=json or {},
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def _delete(self, path: str) -> bool:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{self.base_url}{path}",
                headers=self._headers(),
                timeout=30.0,
            )
            resp.raise_for_status()
            return True

    # -----------------------------------------------------------------------
    # Catalog
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[CatalogProvider]:
        return [
            CatalogProvider(
                key="composio",
                name="Composio",
                description="Third-party tool integrations via Composio",
                enabled=True,
            )
        ]

    async def list_integrations(
        self,
        *,
        search: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogIntegration]:
        params: Dict[str, Any] = {}
        if search:
            params["search"] = search
        if limit:
            params["limit"] = limit

        try:
            data = await self._get("/toolkits", params=params)
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_integrations",
                detail=str(e),
            ) from e

        items = data if isinstance(data, list) else data.get("items", [])

        return [
            CatalogIntegration(
                key=item.get("slug", ""),
                name=item.get("name", ""),
                description=item.get("description"),
                logo=item.get("logo"),
                auth_schemes=[
                    s.get("auth_mode", "")
                    for s in item.get("auth_schemes", [])
                    if isinstance(s, dict)
                ],
                actions_count=item.get("total_actions", 0),
                categories=[
                    c.strip()
                    for c in (item.get("category") or "").split(",")
                    if c.strip()
                ],
                no_auth=item.get("no_auth", False),
            )
            for item in items
        ]

    async def list_actions(
        self,
        *,
        integration_key: str,
        search: Optional[str] = None,
        tags: Optional[Tags] = None,
        important: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> List[CatalogAction]:
        params: Dict[str, Any] = {"toolkit_slug": integration_key}
        if limit:
            params["limit"] = limit
        if important is not None:
            params["important"] = str(important).lower()

        try:
            data = await self._get("/tools", params=params)
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_actions",
                detail=str(e),
            ) from e

        items = data if isinstance(data, list) else data.get("items", [])

        actions = []
        for item in items:
            action_tags = {}
            for t in item.get("tags", []):
                if isinstance(t, str):
                    action_tags[t] = True

            action_key = self._extract_action_key(
                composio_slug=item.get("slug", ""),
                integration_key=integration_key,
            )

            actions.append(
                CatalogAction(
                    key=action_key,
                    name=item.get("name", ""),
                    description=item.get("description"),
                    tags=action_tags if action_tags else None,
                )
            )

        return actions

    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[CatalogAction]:
        composio_slug = self._to_composio_slug(
            integration_key=integration_key,
            action_key=action_key,
        )

        try:
            item = await self._get(f"/tools/{composio_slug}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise AdapterError(
                provider_key="composio",
                operation="get_action",
                detail=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_action",
                detail=str(e),
            ) from e

        action_tags = {}
        for t in item.get("tags", []):
            if isinstance(t, str):
                action_tags[t] = True

        return CatalogAction(
            key=action_key,
            name=item.get("name", ""),
            description=item.get("description"),
            tags=action_tags if action_tags else None,
            input_schema=item.get("input_parameters"),
            output_schema=item.get("output_parameters"),
        )

    # -----------------------------------------------------------------------
    # Connections
    # -----------------------------------------------------------------------

    async def initiate_connection(
        self,
        *,
        entity_id: str,
        integration_key: str,
        callback_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Step 1: resolve auth config for this integration
        try:
            auth_configs = await self._get(
                "/auth_configs",
                params={"toolkit_slugs": integration_key},
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection.resolve_auth_config",
                detail=str(e),
            ) from e

        items = (
            auth_configs
            if isinstance(auth_configs, list)
            else auth_configs.get("items", [])
        )
        if not items:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection",
                detail=f"No auth config found for integration '{integration_key}'",
            )

        auth_config_id = items[0].get("id")

        # Step 2: initiate connected account link
        payload: Dict[str, Any] = {
            "user_id": entity_id,
            "auth_config_id": auth_config_id,
        }
        if callback_url:
            payload["callback_url"] = callback_url

        try:
            result = await self._post("/connected_accounts/link", json=payload)
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection",
                detail=str(e),
            ) from e

        return {
            "id": result.get("id"),
            "redirect_url": result.get("redirect_url"),
            "auth_config_id": auth_config_id,
        }

    async def get_connection_status(
        self,
        *,
        provider_connection_id: str,
    ) -> Dict[str, Any]:
        try:
            result = await self._get(f"/connected_accounts/{provider_connection_id}")
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_connection_status",
                detail=str(e),
            ) from e

        return {
            "status": result.get("status"),
            "is_valid": result.get("status") == "ACTIVE",
        }

    async def refresh_connection(
        self,
        *,
        provider_connection_id: str,
        force: bool = False,
    ) -> Dict[str, Any]:
        try:
            result = await self._post(
                f"/connected_accounts/{provider_connection_id}/refresh",
                json={},
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="refresh_connection",
                detail=str(e),
            ) from e

        return {
            "status": result.get("status"),
            "is_valid": result.get("status") == "ACTIVE",
            "redirect_url": result.get("redirect_url"),
        }

    async def revoke_connection(
        self,
        *,
        provider_connection_id: str,
    ) -> bool:
        try:
            return await self._delete(f"/connected_accounts/{provider_connection_id}")
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="revoke_connection",
                detail=str(e),
            ) from e

    # -----------------------------------------------------------------------
    # Execution
    # -----------------------------------------------------------------------

    async def execute(
        self,
        *,
        integration_key: str,
        action_key: str,
        provider_connection_id: str,
        arguments: Dict[str, Any],
    ) -> ExecutionResult:
        composio_slug = self._to_composio_slug(
            integration_key=integration_key,
            action_key=action_key,
        )

        try:
            result = await self._post(
                f"/tools/execute/{composio_slug}",
                json={
                    "arguments": arguments,
                    "connected_account_id": provider_connection_id,
                },
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="execute",
                detail=str(e),
            ) from e

        return ExecutionResult(
            data=result.get("data"),
            error=result.get("error"),
            successful=result.get("successful", False),
        )

    # -----------------------------------------------------------------------
    # Slug mapping helpers
    # -----------------------------------------------------------------------

    @staticmethod
    def _to_composio_slug(
        *,
        integration_key: str,
        action_key: str,
    ) -> str:
        """Agenta → Composio: gmail + SEND_EMAIL → GMAIL_SEND_EMAIL"""
        return f"{integration_key.upper()}_{action_key}"

    @staticmethod
    def _extract_action_key(
        *,
        composio_slug: str,
        integration_key: str,
    ) -> str:
        """Composio → Agenta: GMAIL_SEND_EMAIL → SEND_EMAIL"""
        prefix = f"{integration_key.upper()}_"
        if composio_slug.startswith(prefix):
            return composio_slug[len(prefix) :]
        return composio_slug
