from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from ee.src.core.access.entitlements.types import DefaultPlan


LICENSE_KEY_PREFIX = "agenta_license_v1"

LicenseSource = Literal["environment", "database"]


class LicenseKey(BaseModel):
    """The signed payload of a license key. Unknown fields are ignored."""

    key_id: UUID
    plan: str
    customer: str
    seats: Optional[int] = None
    issued_at: datetime
    expires_at: Optional[datetime] = None
    telemetry: Literal["required", "exempt"] = "required"

    model_config = ConfigDict(extra="ignore")

    @field_validator("issued_at", "expires_at")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def is_expired(self, *, now: Optional[datetime] = None) -> bool:
        if self.expires_at is None:
            return False
        return self.expires_at <= (now or datetime.now(timezone.utc))


class LicenseState(BaseModel):
    """Where the instance's key comes from, and the key when its signature checks.
    `license` stays set after the key expires, so the License page can show it."""

    source: Optional[LicenseSource] = None
    license: Optional[LicenseKey] = None

    def active_license(self) -> Optional[LicenseKey]:
        """The key in force: its signature checked and it has not expired."""
        if self.license is None or self.license.is_expired():
            return None
        return self.license

    @property
    def plan(self) -> str:
        active = self.active_license()
        return active.plan if active else DefaultPlan.SELF_HOSTED_COMMUNITY.value


class StoredLicense(BaseModel):
    key_id: UUID
    key: str
    created_at: datetime
    created_by_id: UUID


class LicenseError(Exception):
    pass


class InvalidLicenseKey(LicenseError):
    """Bad format, bad signature, refused `key_id`, unknown plan, or expired."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class LicenseKeyInEnvironment(LicenseError):
    """`AGENTA_LICENSE_KEY` is set, so a key added in the app would never apply."""
