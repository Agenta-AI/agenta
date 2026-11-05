import time
from datetime import datetime
from typing import Any, Callable, Dict, Optional, Sequence
from uuid import UUID

from oss.src.core.memberships.service import MembershipsService
from oss.src.core.notifications.dtos import (
    NotificationKind,
    NotificationState,
    PendingNotificationDelivery,
    RenderedEmail,
)
from oss.src.core.notifications.interfaces import NotificationsDAOInterface
from oss.src.utils.emailing import send_rendered_email
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAX_SENDS_PER_REQUEST = 100
MAX_SEND_ATTEMPTS = 5
# With 15 s per socket operation, a send started now ends well inside the 600 s lock.
SEND_WINDOW_SECONDS = 300

NotificationTemplate = Callable[[UUID, Dict[str, Any]], RenderedEmail]


class NotificationsService:
    def __init__(
        self,
        *,
        notifications_dao: NotificationsDAOInterface,
        memberships_service: MembershipsService,
        template: NotificationTemplate,
    ):
        self.dao = notifications_dao
        self.memberships_service = memberships_service
        self.template = template

    async def open(
        self,
        *,
        project_id: UUID,
        kind: NotificationKind,
        dedup_key: str,
        data: Dict[str, Any],
        user_ids: Sequence[UUID],
    ) -> bool:
        return await self.dao.open(
            project_id=project_id,
            kind=kind,
            dedup_key=dedup_key,
            data=data,
            user_ids=user_ids,
        )

    async def resolve(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: Optional[datetime] = None,
    ) -> int:
        return await self.dao.resolve(
            project_id=project_id,
            dedup_key=dedup_key,
            started_at=started_at,
        )

    async def note_failure(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: datetime,
    ) -> int:
        return await self.dao.note_failure(
            project_id=project_id,
            dedup_key=dedup_key,
            started_at=started_at,
        )

    async def send_pending(self, *, request_started_at: float) -> None:
        """Send `created` deliveries. `request_started_at` is a `time.monotonic()` value."""
        deliveries = await self.dao.query_created(limit=MAX_SENDS_PER_REQUEST)
        can_send = env.agenta.notifications.email_enabled and (
            env.smtp.enabled or env.sendgrid.enabled
        )

        for delivery in deliveries:
            if time.monotonic() - request_started_at >= SEND_WINDOW_SECONDS:
                return

            try:
                email = None
                if can_send and delivery.notification_state == NotificationState.OPEN:
                    email = await self._recipient_email(delivery)
                if email is None:
                    await self.dao.mark_skipped(
                        project_id=delivery.project_id,
                        delivery_id=delivery.id,
                    )
                    continue
                rendered = self.template(delivery.project_id, delivery.data)
            except Exception as error:  # pylint: disable=broad-exception-caught
                await self._record_failure(delivery, error)
                continue

            try:
                await send_rendered_email(
                    email, rendered.subject, rendered.html, rendered.text
                )
            except Exception as error:  # pylint: disable=broad-exception-caught
                await self._record_failure(delivery, error)
                return

            await self.dao.mark_sent(
                project_id=delivery.project_id,
                delivery_id=delivery.id,
            )

    async def _recipient_email(
        self, delivery: PendingNotificationDelivery
    ) -> Optional[str]:
        emails = await self.memberships_service.fetch_member_emails(
            user_ids=[delivery.user_id]
        )
        return emails.get(delivery.user_id)

    async def _record_failure(
        self,
        delivery: PendingNotificationDelivery,
        error: Exception,
    ) -> None:
        log.warning(
            "[notifications] send failed",
            project_id=str(delivery.project_id),
            delivery_id=str(delivery.id),
            notification_id=str(delivery.notification_id),
            error_type=type(error).__name__,
        )
        await self.dao.record_failure(
            project_id=delivery.project_id,
            delivery_id=delivery.id,
            max_attempts=MAX_SEND_ATTEMPTS,
        )
