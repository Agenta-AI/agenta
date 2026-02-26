from enum import Enum
from typing import List

from oss.src.core.events.types import EventType


class WebhookEventType(str, Enum):
    """Subscribable event types — a strict subset of EventType.

    Values are derived from EventType so the strings stay in sync.
    To add a new subscribable event type, it must first exist in EventType.
    """

    ENVIRONMENTS_REVISIONS_COMMITTED = EventType.ENVIRONMENTS_REVISIONS_COMMITTED.value

    @classmethod
    def values(cls) -> List[str]:
        return [e.value for e in cls]
