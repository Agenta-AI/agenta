"""An in-memory `NotificationsDAOInterface` and delivery rows for the settle tests."""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID, uuid4

from oss.src.core.notifications.dtos import (
    NotificationDeliveryState,
    NotificationKind,
    NotificationState,
    CreatedNotificationDelivery,
)
from oss.src.core.notifications.interfaces import NotificationsDAOInterface
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import TriggerDeliveryData, UnsettledTriggerDelivery

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
STATUS_MESSAGES = {
    "202": "dispatched",
    "400": "failed",
    "403": "failed",
    "422": "skipped",
    "500": "failed",
}


def minutes_ago(minutes: int) -> datetime:
    return NOW - timedelta(minutes=minutes)


def make_delivery(
    code: str = "500",
    *,
    project_id: Optional[UUID] = None,
    schedule_id: Optional[UUID] = None,
    created_at: datetime = NOW,
    updated_at: Optional[datetime] = None,
    run_id: Optional[str] = None,
    session_id: Optional[str] = None,
    error_details: Optional[Dict[str, Any]] = None,
) -> UnsettledTriggerDelivery:
    return UnsettledTriggerDelivery(
        project_id=project_id or uuid4(),
        id=uuid4(),
        created_at=created_at,
        updated_at=updated_at,
        status=Status(code=code, message=STATUS_MESSAGES.get(code, "other")),
        data=TriggerDeliveryData(
            session_id=session_id,
            result={"run_id": run_id} if run_id else None,
            error_details=error_details,
        ),
        schedule_id=schedule_id or uuid4(),
        event_id=str(uuid4()),
    )


class FakeNotificationsDAO(NotificationsDAOInterface):
    def __init__(self) -> None:
        self.notifications: List[Dict[str, Any]] = []
        self.deliveries: List[Dict[str, Any]] = []

    def open_rows(self) -> List[Dict[str, Any]]:
        return [
            row for row in self.notifications if row["state"] == NotificationState.OPEN
        ]

    def _open_row(self, project_id: UUID, dedup_key: str) -> Optional[Dict[str, Any]]:
        for row in self.open_rows():
            if (row["project_id"], row["dedup_key"]) == (project_id, dedup_key):
                return row
        return None

    async def open(
        self,
        *,
        project_id: UUID,
        kind: NotificationKind,
        dedup_key: str,
        data: Dict[str, Any],
        user_ids: Sequence[UUID],
    ) -> bool:
        if self._open_row(project_id, dedup_key) is not None:
            return False
        notification = {
            "project_id": project_id,
            "id": uuid4(),
            "dedup_key": dedup_key,
            "state": NotificationState.OPEN,
            "data": data,
        }
        self.notifications.append(notification)
        self.deliveries += [
            {
                "project_id": project_id,
                "id": uuid4(),
                "notification": notification,
                "user_id": user_id,
                "state": NotificationDeliveryState.CREATED,
                "attempt_count": 0,
            }
            for user_id in user_ids
        ]
        return True

    async def resolve(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: Optional[datetime] = None,
    ) -> int:
        row = self._open_row(project_id, dedup_key)
        if row is None:
            return 0
        last_failure_started_at = datetime.fromisoformat(
            row["data"]["last_failure_started_at"]
        )
        if started_at is not None and last_failure_started_at > started_at:
            return 0
        row["state"] = NotificationState.RESOLVED
        return 1

    async def note_failure(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: datetime,
    ) -> int:
        row = self._open_row(project_id, dedup_key)
        if row is None:
            return 0
        if datetime.fromisoformat(row["data"]["last_failure_started_at"]) < started_at:
            row["data"]["last_failure_started_at"] = started_at.isoformat()
        return 1

    async def query_created(self, *, limit: int) -> List[CreatedNotificationDelivery]:
        return [
            CreatedNotificationDelivery(
                project_id=row["project_id"],
                id=row["id"],
                notification_id=row["notification"]["id"],
                user_id=row["user_id"],
                notification_state=row["notification"]["state"],
                data=row["notification"]["data"],
            )
            for row in self.deliveries
            if row["state"] == NotificationDeliveryState.CREATED
        ][:limit]

    def _delivery(self, delivery_id: UUID) -> Dict[str, Any]:
        return next(row for row in self.deliveries if row["id"] == delivery_id)

    async def mark_sent(self, *, project_id: UUID, delivery_id: UUID) -> None:
        self._delivery(delivery_id)["state"] = NotificationDeliveryState.SENT

    async def mark_skipped(self, *, project_id: UUID, delivery_id: UUID) -> None:
        self._delivery(delivery_id)["state"] = NotificationDeliveryState.SKIPPED

    async def record_send_failure(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        max_attempts: int,
    ) -> None:
        row = self._delivery(delivery_id)
        row["attempt_count"] += 1
        if row["attempt_count"] >= max_attempts:
            row["state"] = NotificationDeliveryState.FAILED
