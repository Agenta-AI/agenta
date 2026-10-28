from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from oss.src.utils.logging import get_module_logger

from oss.src.core.triggers.dtos import (
    TriggerCatalogProvider,
    TriggerProviderKind,
    TriggerWebhookRegistration,
)
from oss.src.core.triggers.interfaces import TriggersGatewayInterface
from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.providers.composio.catalog import (
    ComposioTriggersCatalogClient,
)
from oss.src.core.gateway.providers.composio.errors import composio_error_detail
from oss.src.utils.env import env


log = get_module_logger(__name__)

_WEBHOOK_EVENT = "composio.trigger.message"


def normalize_webhook_event(envelope: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map a Composio V3 webhook envelope to the internal trigger event shape.

    V3 carries the event id at the top level and the message under ``data``;
    the dispatcher reads ``metadata.id`` and ``payload``. Returns None when the
    envelope is not a routable trigger message.
    """
    if envelope.get("type") != _WEBHOOK_EVENT:
        return None
    metadata = envelope.get("metadata") or {}
    if not isinstance(metadata, dict):
        return None
    trigger_id = metadata.get("trigger_id")
    event_id = envelope.get("id")
    if not trigger_id or not event_id:
        return None
    return {
        "metadata": {**metadata, "id": event_id},
        "payload": envelope.get("data"),
    }


class ComposioTriggersAdapter(ComposioTriggersCatalogClient, TriggersGatewayInterface):
    """Composio V3 triggers adapter — uses httpx directly (no SDK).

    Modeled on ``ComposioToolsAdapter``: own httpx client, ``_get/_post/_delete``
    helpers, slug passthrough. Catalog operations (list/get events) come from
    ``ComposioTriggersCatalogClient``; subscription (trigger-instance) management
    is implemented here.

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

    async def _get(self, path: str) -> Any:
        resp = await self._client.get(
            f"{self.api_url}{path}",
            headers=self._headers(),
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
    # Webhook subscription (project-level event delivery → Agenta ingress)
    # -----------------------------------------------------------------------

    async def ensure_webhook_subscription(
        self, *, webhook_url: str
    ) -> TriggerWebhookRegistration:
        """GET-or-create-then-GET the delivery webhook; return its secret and URL.

        The one-per-project cap arbitrates the race: the 409 loser re-reads the
        winner's secret. An existing webhook is never updated, even when its URL
        differs from ``webhook_url``.
        """
        try:
            existing = await self._get("/webhook_subscriptions")
            registration = self._first_webhook(existing)
            if registration:
                return registration

            resp = await self._client.post(
                f"{self.api_url}/webhook_subscriptions",
                headers=self._headers(),
                json={"webhook_url": webhook_url, "enabled_events": [_WEBHOOK_EVENT]},
            )
            if resp.status_code == 409:
                again = await self._get("/webhook_subscriptions")
                registration = self._first_webhook(again)
                if not registration:
                    raise AdapterError(
                        provider_key="composio",
                        operation="ensure_webhook_subscription",
                        detail="409 conflict returned no readable webhook secret",
                    )
                return registration
            resp.raise_for_status()
            created = resp.json()
            return TriggerWebhookRegistration(
                secret=created["secret"],
                webhook_url=created.get("webhook_url") or webhook_url,
            )
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="ensure_webhook_subscription",
                detail=composio_error_detail(e),
            ) from e

    @staticmethod
    def _first_webhook(payload: object) -> Optional[TriggerWebhookRegistration]:
        if not isinstance(payload, dict):
            return None
        items = payload.get("items", [])
        if not items or not isinstance(items[0], dict):
            return None
        secret = items[0].get("secret")
        if not secret:
            return None
        return TriggerWebhookRegistration(
            secret=secret,
            webhook_url=items[0].get("webhook_url"),
        )

    # -----------------------------------------------------------------------
    # Subscriptions (provider-side trigger instances — ti_*)
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
                detail=composio_error_detail(e),
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
        except httpx.HTTPStatusError as e:
            # 409 means the instance is already in the requested state.
            if e.response.status_code == 409:
                return
            raise AdapterError(
                provider_key="composio",
                operation="set_subscription_status",
                detail=composio_error_detail(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="set_subscription_status",
                detail=composio_error_detail(e),
            ) from e

    async def delete_subscription(
        self,
        *,
        trigger_id: str,
    ) -> None:
        try:
            await self._delete(f"/trigger_instances/manage/{trigger_id}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return
            raise AdapterError(
                provider_key="composio",
                operation="delete_subscription",
                detail=composio_error_detail(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="delete_subscription",
                detail=composio_error_detail(e),
            ) from e
