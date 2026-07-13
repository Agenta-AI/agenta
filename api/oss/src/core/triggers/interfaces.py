from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    TriggerCatalogEventDetails,
    TriggerCatalogEventsPage,
    TriggerCatalogProvider,
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryQuery,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleEdit,
    TriggerScheduleQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)


class TriggersGatewayInterface(ABC):
    """Port for external trigger providers (Composio, ...).

    The catalog reads (``list_events``/``get_event``) back the events catalog;
    the subscription verbs build/manage the provider-side trigger instance
    (``ti_*``) stored on a local subscription row.
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
    ) -> TriggerCatalogEventsPage: ...

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

    @abstractmethod
    async def ensure_webhook_subscription(self, *, webhook_url: str) -> str:
        """Idempotently ensure the project-level delivery webhook; return its secret."""
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
        trigger_id: str,
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
    async def fetch_subscription_by_trigger_id(
        self,
        *,
        project_id: UUID,
        trigger_id: str,
    ) -> Optional[TriggerSubscription]:
        """Fetch the live (non-deleted) subscription owning ``trigger_id`` in this project."""
        ...

    @abstractmethod
    async def get_project_and_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[Tuple[UUID, TriggerSubscription]]:
        """Resolve a ``ti_*`` to its (project_id, subscription).

        Deliberately cross-project: an inbound Composio event carries only the
        provider ``ti_*`` and no tenant scope, so this lookup *recovers* the
        project from the (partial-unique) ``trigger_id`` column. The only sanctioned
        unscoped DAO read — every other read/write takes ``project_id``.
        """
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
        """Upsert a delivery row (idempotent on event_id)."""
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
    async def poll_delivery_after(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        baseline_id: Optional[UUID],
        timeout_seconds: float,
        interval_seconds: float = 1.0,
    ) -> Optional[TriggerDelivery]:
        """Wait (on one held connection) for a delivery newer than baseline_id."""
        ...

    @abstractmethod
    async def dedup_seen(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        event_id: str,
    ) -> bool:
        """True if a delivery for this event_id already exists."""
        ...

    @abstractmethod
    async def dedup_seen_schedule(
        self,
        *,
        project_id: UUID,
        schedule_id: UUID,
        event_id: str,
    ) -> bool:
        """True if a delivery for this (schedule, event_id) already exists."""
        ...

    # --- schedules ---------------------------------------------------------- #

    @abstractmethod
    async def create_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleCreate,
    ) -> TriggerSchedule: ...

    @abstractmethod
    async def fetch_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> Optional[TriggerSchedule]: ...

    @abstractmethod
    async def edit_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleEdit,
    ) -> Optional[TriggerSchedule]: ...

    @abstractmethod
    async def delete_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> bool: ...

    @abstractmethod
    async def query_schedules(
        self,
        *,
        project_id: UUID,
        #
        schedule: Optional[TriggerScheduleQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSchedule]: ...

    @abstractmethod
    async def fetch_active_schedules(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> List[TriggerSchedule]: ...

    @abstractmethod
    async def fetch_active_schedules_with_project(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> List[Tuple[UUID, TriggerSchedule]]: ...
