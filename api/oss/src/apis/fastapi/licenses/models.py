from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel


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


class InstanceLicenseActivateRequest(BaseModel):
    key: str
