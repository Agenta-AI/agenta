"""Composio triggers catalog operations — mixin for ComposioTriggersAdapter.

Provides catalog HTTP calls (list events, get one event) backed by
``self._client``, ``self.api_key``, and ``self.api_url`` which must be supplied
by the concrete subclass (ComposioTriggersAdapter).

Mirrors ``core/tools/providers/composio/catalog.py`` with ``action → event``:
the tools "action" leaf becomes the triggers "event" leaf (a Composio *trigger
type*), and an action's ``input_parameters`` schema becomes an event's
``trigger_config`` schema. The ``cursor`` value is Composio's native
``next_cursor`` string, passed through as-is.
"""

from typing import Any, Dict, List, Optional

import httpx

from oss.src.utils.logging import get_module_logger
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogEventsPage,
    TriggerCatalogEventsSnapshot,
)
from oss.src.core.triggers.exceptions import AdapterError


log = get_module_logger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 1000
# Composio clamps larger page limits to 50, so ask for exactly that.
ALL_EVENTS_PAGE_SIZE = 50
# Runaway-cursor guard for the full-catalog crawl (~8 pages live today).
ALL_EVENTS_MAX_PAGES = 50


class ComposioTriggersCatalogClient:
    """Catalog mixin for ComposioTriggersAdapter — cursor-based pagination.

    Subclass must set ``self.api_key``, ``self.api_url``, and ``self._client``
    (an ``httpx.AsyncClient``) before calling any method.
    """

    # Annotated for type-checkers; filled in by ComposioTriggersAdapter.__init__
    api_key: str
    api_url: str
    _client: httpx.AsyncClient

    async def list_events(
        self,
        *,
        integration_key: str,
        query: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> TriggerCatalogEventsPage:
        """Fetch one page of events (Composio trigger types) for an integration.

        E5 (verified vs live Composio API reference): GET /triggers_types,
        filtered by ``toolkit_slugs``.
        """
        page_limit = min(limit, MAX_PAGE_SIZE) if limit else DEFAULT_PAGE_SIZE

        params: Dict[str, Any] = {
            "toolkit_slugs": integration_key,
            "limit": page_limit,
        }
        if query:
            params["query"] = query
        if cursor:
            params["cursor"] = cursor

        try:
            resp = await self._client.get(
                f"{self.api_url}/triggers_types",
                headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
                params=params,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="list_events",
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

        items = [_parse_event(item, integration_key) for item in items_raw]

        log.debug(
            "[composio] list_events(%s) cursor=%s items=%d total=%d next=%s",
            integration_key,
            cursor,
            len(items),
            total_items,
            next_cursor,
        )

        return TriggerCatalogEventsPage(
            events=items,
            next_cursor=next_cursor,
            total=total_items,
        )

    async def list_all_events(self) -> TriggerCatalogEventsSnapshot:
        """Fetch the complete trigger-types catalog, following ``next_cursor`` to exhaustion.

        LIST items carry ``config`` and ``payload`` (verified live), so the snapshot
        holds full event details plus the toolkit slug -> display name map.
        """
        events: List[TriggerCatalogEventDetails] = []
        integration_names: Dict[str, str] = {}
        cursor: Optional[str] = None
        seen_cursors: set = set()

        for _ in range(ALL_EVENTS_MAX_PAGES):
            params: Dict[str, Any] = {"limit": ALL_EVENTS_PAGE_SIZE}
            if cursor:
                params["cursor"] = cursor

            try:
                resp = await self._client.get(
                    f"{self.api_url}/triggers_types",
                    headers={
                        "x-api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    params=params,
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as e:
                raise AdapterError(
                    provider_key="composio",
                    operation="list_all_events",
                    detail=str(e),
                ) from e

            items_raw: List[Dict[str, Any]] = (
                data.get("items", []) if isinstance(data, dict) else data
            )
            for item in items_raw:
                toolkit_slug = _toolkit_slug(item, "")
                events.append(_parse_event_detail(item, toolkit_slug))
                toolkit = item.get("toolkit")
                if toolkit_slug and isinstance(toolkit, dict) and toolkit.get("name"):
                    integration_names[toolkit_slug] = toolkit["name"]

            next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
            if not next_cursor or next_cursor in seen_cursors:
                break
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        else:
            log.warning(
                "[composio] list_all_events hit the %d-page cap; snapshot may be partial",
                ALL_EVENTS_MAX_PAGES,
            )

        log.debug(
            "[composio] list_all_events items=%d toolkits=%d",
            len(events),
            len(integration_names),
        )

        return TriggerCatalogEventsSnapshot(
            events=events,
            integration_names=integration_names,
        )

    async def get_event(
        self,
        *,
        integration_key: str,
        event_key: str,
    ) -> Optional[TriggerCatalogEventDetails]:
        """Fetch one event (trigger type) by slug, with its trigger_config schema.

        E5 (verified vs live Composio API reference): GET /triggers_types/{slug}.
        Returns None when the event does not exist (404).
        """
        try:
            resp = await self._client.get(
                f"{self.api_url}/triggers_types/{event_key}",
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
                operation="get_event",
                detail=str(e),
            ) from e
        except httpx.HTTPError as e:
            raise AdapterError(
                provider_key="composio",
                operation="get_event",
                detail=str(e),
            ) from e

        return _parse_event_detail(resp.json(), integration_key)


# ---------------------------------------------------------------------------
# Parsers (module-level — no instance state needed)
# ---------------------------------------------------------------------------


def _toolkit_slug(item: Dict[str, Any], fallback: str) -> str:
    toolkit = item.get("toolkit")
    if isinstance(toolkit, dict):
        return toolkit.get("slug") or toolkit.get("name") or fallback
    if isinstance(toolkit, str):
        return toolkit
    return fallback


def _parse_event(item: Dict[str, Any], integration_key: str) -> TriggerCatalogEvent:
    return TriggerCatalogEvent(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=item.get("description"),
        provider="composio",
        integration=_toolkit_slug(item, integration_key),
    )


def _parse_event_detail(
    item: Dict[str, Any],
    integration_key: str,
) -> TriggerCatalogEventDetails:
    # The event's required config is the JSON Schema under "config" — the inbound
    # analogue of an action's "input_parameters".
    trigger_config = item.get("config") or item.get("trigger_config")
    payload = item.get("payload")

    return TriggerCatalogEventDetails(
        key=item.get("slug", ""),
        name=item.get("name", ""),
        description=item.get("description"),
        provider="composio",
        integration=_toolkit_slug(item, integration_key),
        trigger_config=trigger_config,
        payload=payload,
    )
