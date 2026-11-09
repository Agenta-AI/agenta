from enum import Enum
from typing import Any, Dict, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel

from oss.src.utils.emailing import InlineImage


class NotificationKind(str, Enum):
    AUTOMATION_FAILING = "automation_failing"


class NotificationState(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"


class NotificationDeliveryState(str, Enum):
    CREATED = "created"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class NotificationChannel(str, Enum):
    EMAIL = "email"


class CreatedNotificationDelivery(BaseModel):
    """A `created` notification delivery, read with its notification."""

    project_id: UUID
    id: UUID
    notification_id: UUID
    user_id: UUID
    notification_state: NotificationState
    data: Dict[str, Any]


class RenderedEmail(BaseModel):
    subject: str
    html: str
    text: str
    inline_images: Tuple[InlineImage, ...] = ()
    from_name: Optional[str] = None
