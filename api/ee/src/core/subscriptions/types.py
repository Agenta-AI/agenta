from typing import Optional


from uuid import UUID
from enum import Enum

from oss.src.utils.env import env
from pydantic import BaseModel

from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.licenses.cloud import is_cloud


class Event(str, Enum):
    SUBSCRIPTION_CREATED = "subscription_created"
    SUBSCRIPTION_PAUSED = "subscription_paused"
    SUBSCRIPTION_RESUMED = "subscription_resumed"
    SUBSCRIPTION_SWITCHED = "subscription_switched"
    SUBSCRIPTION_CANCELLED = "subscription_cancelled"


class SubscriptionDTO(BaseModel):
    organization_id: UUID
    customer_id: Optional[str] = None
    subscription_id: Optional[str] = None
    plan: Optional[str] = None
    active: Optional[bool] = None
    anchor: Optional[int] = None


def get_default_plan() -> str:
    """Returns the default plan slug for new organizations.

    Reads from `AGENTA_ACCESS_DEFAULT_PLAN` (canonical) or the legacy
    `AGENTA_DEFAULT_PLAN` env var (both surfaced via
    `env.agenta.access.default_plan`). If neither is set, defaults to:
    - self_hosted_enterprise outside cloud
    - cloud_v0_hobby on cloud (`is_cloud()`)
    """
    raw = env.agenta.access.default_plan
    if raw:
        return raw

    if is_cloud():
        return DefaultPlan.CLOUD_V0_HOBBY.value

    return DefaultPlan.SELF_HOSTED_ENTERPRISE.value
