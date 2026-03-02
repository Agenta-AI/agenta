from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class RequestType(str, Enum):
    """Execution request kind that produced an event."""

    UNKNOWN = "unknown"
    ROUTER = "router"
    WORKER = "worker"


class EventType(str, Enum):
    """Top-level event classification."""

    UNKNOWN = "unknown"
    ENVIRONMENTS_REVISIONS_COMMITTED = "environments.revisions.committed"
    WEBHOOKS_SUBSCRIPTIONS_TESTED = "webhooks.subscriptions.tested"


class RequestID(BaseModel):
    request_id: UUID


class EventID(BaseModel):
    event_id: UUID
