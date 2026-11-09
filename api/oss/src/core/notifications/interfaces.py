from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from oss.src.core.notifications.dtos import (
    NotificationKind,
    CreatedNotificationDelivery,
)


class NotificationsDAOInterface(ABC):
    @abstractmethod
    async def open(
        self,
        *,
        project_id: UUID,
        kind: NotificationKind,
        dedup_key: str,
        data: Dict[str, Any],
        user_ids: Sequence[UUID],
    ) -> bool:
        """Insert the notification and one `created` email delivery per user, in one
        transaction. Returns False, and inserts nothing, when one is already open."""

    @abstractmethod
    async def resolve(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: Optional[datetime] = None,
    ) -> int:
        """Resolve the open notification. With `started_at`, only if that time is at or
        after `data.last_failure_started_at`. Returns the row count."""

    @abstractmethod
    async def note_failure(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: datetime,
    ) -> int:
        """Move `data.last_failure_started_at` of the open notification forward to `started_at`.
        Returns the count of open rows, 0 when none is open."""

    @abstractmethod
    async def query_created(
        self,
        *,
        limit: int,
    ) -> List[CreatedNotificationDelivery]:
        """`created` deliveries, oldest first."""

    @abstractmethod
    async def mark_sent(self, *, project_id: UUID, delivery_id: UUID) -> None: ...

    @abstractmethod
    async def mark_skipped(self, *, project_id: UUID, delivery_id: UUID) -> None: ...

    @abstractmethod
    async def record_failure(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        max_attempts: int,
    ) -> None:
        """Add 1 to `attempt_count`, and set `failed` at `max_attempts`."""
