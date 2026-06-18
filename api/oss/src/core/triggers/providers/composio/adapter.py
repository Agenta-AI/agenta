from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from oss.src.utils.logging import get_module_logger

from oss.src.core.triggers.dtos import (
    TriggerCatalogProvider,
    TriggerProviderKind,
)
from oss.src.core.triggers.interfaces import TriggersGatewayInterface
from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.providers.composio.catalog import (
    ComposioTriggersCatalogClient,
)


log = get_module_logger(__name__)

COMPOSIO_DEFAULT_API_URL = "https://backend.composio.dev/api/v3"


class ComposioTriggersAdapter(ComposioTriggersCatalogClient, TriggersGatewayInterface):
    """Composio V3 triggers adapter — uses httpx directly (no SDK).

    Modeled on ``ComposioToolsAdapter``: own httpx client, ``_get/_post/_delete``
    helpers, slug passthrough. Catalog operations (list/get events) come from
    ``ComposioTriggersCatalogClient``; subscription (trigger-instance) management
    is implemented here and consumed by WP3.

    REST paths (E5 — verified vs the live Composio API reference):
      list events    GET    /triggers_types?toolkit_slugs={i}
      get event      GET    /triggers_types/{slug}
      create/upsert  POST   /trigger_instances/{slug}/upsert
      enable/disable PATCH  /trigger_instances/manage/{trigger_id}
      delete         DELETE /trigger_instances/manage/{trigger_id}
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
            log.error("Composio POST %s → %s: %s", path, resp.status_code, resp.text)
        resp.raise_for_status()
        return resp.json()

    async def _patch(
        self,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        resp = await self._client.patch(
            f"{self.api_url}{path}",
            headers=self._headers(),
            json=json or {},
        )
        if not resp.is_success:
            log.error("Composio PATCH %s → %s: %s", path, resp.status_code, resp.text)
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

    async def list_providers(self) -> List[TriggerCatalogProvider]:
        return [
            TriggerCatalogProvider(
                key=TriggerProviderKind.COMPOSIO,
                name="Composio",
                description="Third-party event triggers via Composio",
            )
        ]

    # list_events and get_event are inherited from ComposioTriggersCatalogClient
    # and satisfy the TriggersGatewayInterface catalog contract.

    # -----------------------------------------------------------------------
    # Subscriptions (provider-side trigger instances — ti_*) — consumed by WP3
    # -----------------------------------------------------------------------

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        event_key: str,
        connected_account_id: str,
        trigger_config: Dict[str, Any],
    ) -> str:
        """Create/upsert the provider-side trigger instance; return its id (ti_*)."""
        payload: Dict[str, Any] = {
            "connected_account_id": connected_account_id,
            "trigger_config": trigger_config or {},
        }
        try:
            result = await self._post(
                f"/trigger_instances/{event_key}/upsert",
                json=payload,
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="create_subscription",
                detail=str(e),
            ) from e

        trigger_id = result.get("trigger_id") or result.get("id")
        if not trigger_id:
            raise AdapterError(
                provider_key="composio",
                operation="create_subscription",
                detail=f"No trigger_id in upsert response for event '{event_key}'",
            )
        return trigger_id

    async def set_subscription_status(
        self,
        *,
        trigger_id: str,
        enabled: bool,
    ) -> None:
        status = "enable" if enabled else "disable"
        try:
            await self._patch(
                f"/trigger_instances/manage/{trigger_id}",
                json={"status": status},
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="set_subscription_status",
                detail=str(e),
            ) from e

    async def delete_subscription(
        self,
        *,
        trigger_id: str,
    ) -> None:
        try:
            await self._delete(f"/trigger_instances/manage/{trigger_id}")
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="delete_subscription",
                detail=str(e),
            ) from e
