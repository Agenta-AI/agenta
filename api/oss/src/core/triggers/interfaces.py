from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogProvider,
)


class TriggersGatewayInterface(ABC):
    """Port for external trigger providers (Composio, ...).

    FROZEN (WS-PRE) — consumed by WS3 (subscriptions) and WS5 (web catalog).
    The catalog reads (``list_events``/``get_event``) back the events catalog;
    the subscription verbs build/manage the provider-side trigger instance
    (``ti_*``) that WP3 stores on a local subscription row.
    """

    @abstractmethod
    async def list_providers(self) -> List[TriggerCatalogProvider]: ...

    @abstractmethod
    async def list_events(
        self,
        *,
        integration_key: str,
        query: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Tuple[List[TriggerCatalogEvent], Optional[str], int]:
        """Returns (items, next_cursor, total_items)."""
        ...

    @abstractmethod
    async def get_event(
        self,
        *,
        integration_key: str,
        event_key: str,
    ) -> Optional[TriggerCatalogEventDetails]:
        """Return one event's detail, carrying its trigger_config JSON Schema."""
        ...

    @abstractmethod
    async def create_subscription(
        self,
        *,
        project_id: UUID,
        event_key: str,
        connected_account_id: str,
        trigger_config: Dict[str, Any],
    ) -> str:
        """Create the provider-side trigger instance; returns its id (``ti_*``)."""
        ...

    @abstractmethod
    async def set_subscription_status(
        self,
        *,
        trigger_id: str,
        enabled: bool,
    ) -> None:
        """Enable or disable the provider-side trigger instance."""
        ...

    @abstractmethod
    async def delete_subscription(
        self,
        *,
        trigger_id: str,
    ) -> None:
        """Permanently delete the provider-side trigger instance."""
        ...
