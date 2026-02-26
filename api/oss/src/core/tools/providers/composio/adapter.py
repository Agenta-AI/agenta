from typing import Any, Dict, List, Optional

import httpx

from oss.src.utils.logging import get_module_logger

from agenta.sdk.models.workflows import JsonSchemas

from oss.src.core.tools.dtos import (
    ToolCatalogActionDetails,
    ToolCatalogProvider,
    ToolConnectionRequest,
    ToolConnectionResponse,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from oss.src.core.tools.interfaces import ToolsGatewayInterface
from oss.src.core.tools.exceptions import AdapterError
from oss.src.core.tools.providers.composio.catalog import ComposioCatalogClient


log = get_module_logger(__name__)

COMPOSIO_DEFAULT_API_URL = "https://backend.composio.dev/api/v3"


class ComposioToolsAdapter(ComposioCatalogClient, ToolsGatewayInterface):
    """Composio V3 API adapter — uses httpx directly (no SDK).

    Catalog operations (list/get integrations and actions) are provided by
    ``ComposioCatalogClient``. Connection management and tool execution are
    implemented here.
    """

    def __init__(
        self,
        *,
        api_key: str,
        api_url: str = COMPOSIO_DEFAULT_API_URL,
    ):
        self.api_key = api_key
        self.api_url = api_url.rstrip("/")
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

    async def _delete(self, path: str) -> bool:
        resp = await self._client.delete(
            f"{self.api_url}{path}",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return True

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
                detail=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_action",
                detail=str(e),
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
    # Connections
    # -----------------------------------------------------------------------

    async def initiate_connection(
        self,
        *,
        request: ToolConnectionRequest,
    ) -> ToolConnectionResponse:
        user_id = request.user_id
        integration_key = request.integration_key
        auth_scheme = request.auth_scheme
        callback_url = request.callback_url

        # Step 1: validate the toolkit exists and get its auth scheme info.
        try:
            toolkit = await self._get(f"/toolkits/{integration_key}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise AdapterError(
                    provider_key="composio",
                    operation="initiate_connection.validate_toolkit",
                    detail=f"Integration '{integration_key}' not found",
                ) from e
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection.validate_toolkit",
                detail=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection.validate_toolkit",
                detail=str(e),
            ) from e

        # Step 2: create an auth config for this integration.
        # api_key → use_custom_auth; Composio's redirect UI collects the credentials.
        # oauth / None → use_composio_managed_auth.
        log.info(
            "initiate_connection: integration_key=%s auth_scheme=%r",
            integration_key,
            auth_scheme,
        )

        if auth_scheme == "api_key":
            # Derive Composio authScheme from toolkit's auth_config_details.
            # Fall back to "API_KEY" as the common default.
            composio_auth_scheme = "API_KEY"
            for detail in toolkit.get("auth_config_details") or []:
                mode = detail.get("mode", "")
                if mode and "oauth" not in mode.lower():
                    composio_auth_scheme = mode
                    break

            auth_config_body: Dict[str, Any] = {
                "type": "use_custom_auth",
                "authScheme": composio_auth_scheme,
            }
        else:
            auth_config_body = {"type": "use_composio_managed_auth"}

        auth_configs_payload = {
            "toolkit": {"slug": integration_key},
            "auth_config": auth_config_body,
        }
        log.info(
            "initiate_connection: POST /auth_configs payload=%s", auth_configs_payload
        )

        try:
            auth_config_result = await self._post(
                "/auth_configs",
                json=auth_configs_payload,
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection.create_auth_config",
                detail=str(e),
            ) from e

        auth_config_id = (auth_config_result.get("auth_config") or {}).get("id")
        if not auth_config_id:
            raise AdapterError(
                provider_key="composio",
                operation="initiate_connection.create_auth_config",
                detail=f"No auth_config_id in response for integration '{integration_key}'",
            )

        log.info(
            "initiate_connection: integration_key=%s auth_config_id=%s",
            integration_key,
            auth_config_id,
        )

        # Step 3: initiate connected account link.
        payload: Dict[str, Any] = {
            "user_id": user_id,
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

        provider_connection_id = result.get("connected_account_id", "")
        redirect_url = result.get("redirect_url")

        connection_data: Dict[str, Any] = {
            "connected_account_id": provider_connection_id,
            "auth_config_id": auth_config_id,
        }
        if redirect_url:
            connection_data["redirect_url"] = redirect_url

        return ToolConnectionResponse(
            provider_connection_id=provider_connection_id,
            redirect_url=redirect_url,
            connection_data=connection_data,
        )

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
        callback_url: Optional[str] = None,
        integration_key: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        # For Composio OAuth flows, "refresh" means re-initiating the auth link.
        # The provider does not expose a token-refresh endpoint for OAuth connections,
        # so we create a new connected_accounts/link which the user must re-authorize.
        if integration_key and user_id:
            result = await self.initiate_connection(
                request=ToolConnectionRequest(
                    user_id=user_id,
                    integration_key=integration_key,
                    callback_url=callback_url,
                ),
            )
            return {
                "id": result.provider_connection_id,
                "redirect_url": result.redirect_url,
                "auth_config_id": result.connection_data.get("auth_config_id"),
                "is_valid": False,  # Re-auth pending until callback fires
            }

        payload: Dict[str, Any] = {}
        if callback_url:
            payload["callback_url"] = callback_url

        try:
            result = await self._post(
                f"/connected_accounts/{provider_connection_id}/refresh",
                json=payload,
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
            body = e.response.text if e.response is not None else ""
            raise AdapterError(
                provider_key="composio",
                operation="execute",
                detail=f"{e} — response: {body}",
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="execute",
                detail=str(e),
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
