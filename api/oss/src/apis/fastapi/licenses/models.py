from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class InstanceLicenseKey(BaseModel):
    key_id: UUID
    plan: str
    customer: str
    seats: Optional[int] = None
    issued_at: datetime
    expires_at: Optional[datetime] = None
    telemetry: Literal["required", "exempt"]


class InstanceLicenseUsage(BaseModel):
    users: int


class InstanceLicenseResponse(BaseModel):
    plan: str
    source: Optional[Literal["environment", "database"]] = None
    license: Optional[InstanceLicenseKey] = None
    usage: InstanceLicenseUsage
    # The admin skipped the one-time registration prompt on this instance.
    registration_prompt_dismissed: bool = False


class InstanceLicenseActivateRequest(BaseModel):
    key: str


# A choice label from the setup survey; the browser never sends typed text.
SurveyLabel = Field(
    default=None, min_length=1, max_length=64, pattern=r"^[^\x00-\x1f\x7f]+$"
)


class InstanceRegistrationSurvey(BaseModel):
    role: Optional[str] = SurveyLabel
    team_size: Optional[str] = SurveyLabel
    heard_from: Optional[str] = SurveyLabel


class InstanceRegistrationRequest(BaseModel):
    email: EmailStr
    # "Send me security and product updates". Optional: the key never needs it.
    product_updates: bool = False
    # The setup survey answers, sent only from the onboarding step.
    survey: Optional[InstanceRegistrationSurvey] = None


class InstanceRegistrationResponse(BaseModel):
    email: str
