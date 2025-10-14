from typing import Optional

from uuid import UUID
from enum import Enum

from pydantic import BaseModel

from ee.src.core.entitlements.types import Counter, Gauge
from ee.src.core.subscriptions.types import SubscriptionDTO


class Meters(str, Enum):
    # COUNTERS
    TRACES = Counter.TRACES.value
    EVALUATIONS = Counter.EVALUATIONS.value
    # GAUGES
    USERS = Gauge.USERS.value
    APPLICATIONS = Gauge.APPLICATIONS.value


class MeterDTO(BaseModel):
    organization_id: UUID

    year: Optional[int] = 0
    month: Optional[int] = 0

    key: Meters
    value: Optional[int] = None
    synced: Optional[int] = None
    delta: Optional[int] = None

    subscription: Optional[SubscriptionDTO] = None
