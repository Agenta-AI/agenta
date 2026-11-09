import time
from datetime import datetime
from typing import Any, Callable, Dict, Optional, Sequence
from uuid import UUID

from oss.src.core.memberships.service import MembershipsService
from oss.src.core.notifications.dtos import (
    NotificationKind,
    NotificationState,
    CreatedNotificationDelivery,
    RenderedEmail,
)
from oss.src.core.notifications.interfaces import NotificationsDAOInterface
from oss.src.utils.emailing import is_recipient_rejection, send_rendered_email
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAX_SENDS_PER_REQUEST = 100
MAX_SEND_ATTEMPTS = 5
# A send waits at most `SMTP_TIMEOUT` (else 15 s) per SMTP socket operation, or 15 s for
# SendGrid, so a send started inside this window ends well inside the 600 s lock.
SEND_WINDOW_SECONDS = 300

NotificationTemplate = Callable[[UUID, Dict[str, Any]], RenderedEmail]


class NotificationsService:
    """`template` renders every delivery. It is the `automation_failing` template, the only
    kind today."""

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

    async def send_created(self, *, request_started_at: float) -> None:
        """Send `created` deliveries. `request_started_at` is a `time.monotonic()` value."""
        deliveries = await self.dao.query_created(limit=MAX_SENDS_PER_REQUEST)
        can_send = env.agenta.notifications.email_enabled and (
            env.smtp.enabled or env.sendgrid.enabled
        )

        user_ids = {
            delivery.user_id
            for delivery in deliveries
            if delivery.notification_state == NotificationState.OPEN
        }
        emails: Dict[UUID, str] = {}
        if can_send and user_ids:
            try:
                emails = await self.memberships_service.fetch_member_emails(
                    user_ids=list(user_ids)
                )
            except Exception as error:  # pylint: disable=broad-exception-caught
                log.warning(
                    "[notifications] recipient emails read failed",
                    delivery_ids=[str(delivery.id) for delivery in deliveries],
                    error_type=type(error).__name__,
                )
                return

        for delivery in deliveries:
            if time.monotonic() - request_started_at >= SEND_WINDOW_SECONDS:
                return

            try:
                email = None
                if can_send and delivery.notification_state == NotificationState.OPEN:
                    email = emails.get(delivery.user_id)
                if email is None:
                    await self.dao.mark_skipped(
                        project_id=delivery.project_id,
                        delivery_id=delivery.id,
                    )
                    continue
                rendered = self.template(delivery.project_id, delivery.data)
            except Exception as error:  # pylint: disable=broad-exception-caught
                await self._record_send_failure(delivery, error)
                continue

            try:
                await send_rendered_email(
                    email,
                    rendered.subject,
                    rendered.html,
                    rendered.text,
                    inline_images=rendered.inline_images,
                    from_name=rendered.from_name,
                )
            except Exception as error:  # pylint: disable=broad-exception-caught
                await self._record_send_failure(delivery, error)
                if is_recipient_rejection(error):
                    continue
                return

            await self.dao.mark_sent(
                project_id=delivery.project_id,
                delivery_id=delivery.id,
            )

    async def _record_send_failure(
        self,
        delivery: CreatedNotificationDelivery,
        error: Exception,
    ) -> None:
        log.warning(
            "[notifications] send failed",
            project_id=str(delivery.project_id),
            delivery_id=str(delivery.id),
            notification_id=str(delivery.notification_id),
            error_type=type(error).__name__,
        )
        await self.dao.record_send_failure(
            project_id=delivery.project_id,
            delivery_id=delivery.id,
            max_attempts=MAX_SEND_ATTEMPTS,
        )
