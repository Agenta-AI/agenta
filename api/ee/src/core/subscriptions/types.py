from typing import Optional


from uuid import UUID
from enum import Enum

from oss.src.utils.env import env
from pydantic import BaseModel


class Plan(str, Enum):
    CLOUD_V0_HOBBY = "cloud_v0_hobby"
    CLOUD_V0_PRO = "cloud_v0_pro"
    CLOUD_V0_BUSINESS = "cloud_v0_business"
    #
    CLOUD_V0_HUMANITY_LABS = "cloud_v0_humanity_labs"
    CLOUD_V0_X_LABS = "cloud_v0_x_labs"
    #
    CLOUD_V0_AGENTA_AI = "cloud_v0_agenta_ai"
    #
    SELF_HOSTED_ENTERPRISE = "self_hosted_enterprise"


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
    plan: Optional[Plan] = None
    active: Optional[bool] = None
    anchor: Optional[int] = None


FREE_PLAN = Plan.CLOUD_V0_HOBBY  # Move to ENV FILE
REVERSE_TRIAL_PLAN = Plan.CLOUD_V0_PRO  # move to ENV FILE
REVERSE_TRIAL_DAYS = 14  # move to ENV FILE


def get_default_plan() -> Plan:
    """Returns the default plan for new organizations.

    Reads from AGENTA_DEFAULT_PLAN env var. If not set, defaults to:
    - self_hosted_enterprise when Stripe is disabled
    - cloud_v0_hobby when Stripe is enabled
    """
    raw = env.agenta.default_plan
    if raw:
        return Plan(raw)

    if env.stripe.enabled:
        return Plan.CLOUD_V0_HOBBY

    return Plan.SELF_HOSTED_ENTERPRISE
