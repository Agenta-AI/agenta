from typing import Optional


from uuid import UUID
from enum import Enum

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
