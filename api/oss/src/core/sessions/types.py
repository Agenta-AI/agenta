from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class SessionOrigin(str, Enum):
    manual = "manual"
    trigger = "trigger"


class SessionTriggerKind(str, Enum):
    schedule = "schedule"
    subscription = "subscription"


class SessionTriggerAttribution(BaseModel):
    configuration_id: UUID
    kind: SessionTriggerKind
    delivery_id: UUID


class SessionTrigger(BaseModel):
    id: UUID
    kind: SessionTriggerKind
    name: Optional[str] = None


class SessionDelivery(BaseModel):
    id: UUID
