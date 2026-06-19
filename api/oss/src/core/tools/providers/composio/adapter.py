from typing import Any, Dict, List, Optional

import httpx

from oss.src.utils.logging import get_module_logger

from agenta.sdk.models.workflows import JsonSchemas

from oss.src.core.tools.dtos import (
    ToolCatalogActionDetails,
    ToolCatalogProvider,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from oss.src.core.tools.interfaces import ToolsGatewayInterface
from oss.src.core.tools.exceptions import AdapterError
from oss.src.core.tools.providers.composio.catalog import ComposioCatalogClient
from oss.src.core.gateway.providers.composio.errors import composio_error_detail
from oss.src.utils.env import env


log = get_module_logger(__name__)


class ComposioToolsAdapter(ComposioCatalogClient, ToolsGatewayInterface):
    """Composio V3 API adapter — uses httpx directly (no SDK).

    Catalog operations (list/get integrations and actions) are provided by
    ``ComposioCatalogClient``. Tool execution is implemented here. Connection
    auth lives in ``ComposioConnectionsAdapter``.
    """

    def __init__(
        self,
        *,
        api_key: str,
        api_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.api_url = (api_url or env.composio.api_url).rstrip("/")
        # Shared client — one connection pool for the adapter's lifetime.
        # Call close() on shutdown (wired in entrypoints/routers.py lifespan).
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        """Close the shared HTTP client and release connection pool resources."""
        await self._client.aclose()

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
        resp = await self._client.get(
            f"{self.api_url}{path}",
            headers=self._headers(),
            params=params,
        )
        resp.raise_for_status()
        return resp.json()

    async def _post(
        self,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        resp = await self._client.post(
            f"{self.api_url}{path}",
            headers=self._headers(),
            json=json or {},
        )
        if not resp.is_success:
            log.error(
                "Composio POST %s → %s: %s",
                path,
                resp.status_code,
                resp.text,
            )
        resp.raise_for_status()
        return resp.json()

    # -----------------------------------------------------------------------
    # Catalog — provider listing
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[ToolCatalogProvider]:
        integrations_count = await self.count_integrations()
        return [
            ToolCatalogProvider(
                key="composio",
                name="Composio",
                description="Third-party tool integrations via Composio",
                integrations_count=integrations_count,
            )
        ]

    # list_integrations, get_integration, list_actions are inherited from
    # ComposioCatalogClient and satisfy the ToolsGatewayInterface contract.

    # -----------------------------------------------------------------------
    # Catalog — action detail
    # -----------------------------------------------------------------------

    async def get_action(
        self,
        *,
        integration_key: str,
        action_key: str,
    ) -> Optional[ToolCatalogActionDetails]:
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
                detail=composio_error_detail(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_action",
                detail=composio_error_detail(e),
            ) from e

        input_params = item.get("input_parameters")
        output_params = item.get("output_parameters")

        return ToolCatalogActionDetails(
            key=action_key,
            name=item.get("name", ""),
            description=item.get("description"),
            schemas=JsonSchemas(
                inputs=input_params,
                outputs=output_params,
            )
            if input_params or output_params
            else None,
            scopes=item.get("scopes") or None,
        )

    # -----------------------------------------------------------------------
    # Execution
    # -----------------------------------------------------------------------

    async def execute(
        self,
        *,
        request: ToolExecutionRequest,
    ) -> ToolExecutionResponse:
        composio_slug = self._to_composio_slug(
            integration_key=request.integration_key,
            action_key=request.action_key,
        )

        payload: Dict[str, Any] = {
            "arguments": request.arguments,
            "connected_account_id": request.provider_connection_id,
        }
        if request.user_id:
            payload["user_id"] = request.user_id

        try:
            result = await self._post(
                f"/tools/execute/{composio_slug}",
                json=payload,
            )
        except httpx.HTTPStatusError as e:
            raise AdapterError(
                provider_key="composio",
                operation="execute",
                detail=composio_error_detail(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="execute",
                detail=composio_error_detail(e),
            ) from e

        return ToolExecutionResponse(
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
