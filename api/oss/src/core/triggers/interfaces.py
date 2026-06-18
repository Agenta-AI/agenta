from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogProvider,
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
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


class TriggersDAOInterface(ABC):
    """Persistence contract for the triggers domain (subscriptions + deliveries)."""

    # --- subscriptions ------------------------------------------------------ #

    @abstractmethod
    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionCreate,
        #
        ti_id: str,
    ) -> TriggerSubscription: ...

    @abstractmethod
    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[TriggerSubscription]: ...

    @abstractmethod
    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionEdit,
    ) -> Optional[TriggerSubscription]: ...

    @abstractmethod
    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[TriggerSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSubscription]: ...

    @abstractmethod
    async def get_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[TriggerSubscription]:
        """FROZEN (WP4): resolve an inbound event's ``ti_*`` to its local row."""
        ...

    @abstractmethod
    async def get_project_and_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[Tuple[UUID, TriggerSubscription]]:
        """Resolve a ``ti_*`` to its (project_id, subscription); the DTO omits project scope."""
        ...

    # --- deliveries --------------------------------------------------------- #

    @abstractmethod
    async def write_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: TriggerDeliveryCreate,
    ) -> TriggerDelivery:
        """FROZEN (WP4): upsert a delivery row (idempotent on event_id)."""
        ...

    @abstractmethod
    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[TriggerDelivery]: ...

    @abstractmethod
    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[TriggerDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerDelivery]: ...

    @abstractmethod
    async def dedup_seen(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        event_id: str,
    ) -> bool:
        """FROZEN (WP4): True if a delivery for this event_id already exists (I4)."""
        ...
