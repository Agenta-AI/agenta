"""Contracts of the credit-farming fraud check.

Two check points ask TypeSafe's Jev model whether a new account belongs to a
credit-farming ring: at signup (email only) and at API key creation (email plus
behaviour facts). A flagged organization keeps its account but gets no free credits.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# The one PostHog flag that configures the check; see `FraudCheckConfig` for the payload.
FRAUD_CHECK_FLAG = "fraud-check"

# `organizations.flags` key: the grant code awards nothing to an organization carrying it.
NO_GRANTS_FLAG = "fraud_no_grants"

# A floor no balance reaches, so `WalletsService.check()` refuses every call of a held
# organization even after a later grant or purchase.
HOLD_FLOOR_MUSD = 1_000_000_000_000

POLICY = (
    "Agenta is a developer platform. New accounts get free credits. Fraud rings sign up "
    "many accounts on throwaway or catch-all email domains, often with random-letter "
    "local parts, and create an API key within seconds of signup to drain the credits "
    "through the model gateway. Real developers usually sign up with a work or personal "
    "mailbox and take minutes to create a key, if at all."
)

SIGNUP_QUESTION = "Is `signup` part of a credit-farming fraud ring? Judge from the email address alone."
API_KEY_QUESTION = "Is `signup` part of a credit-farming fraud ring?"


class FraudCheckMode(str, Enum):
    OFF = "off"
    ENFORCE = "enforce"


class FraudCheckConfig(BaseModel):
    """The `fraud-check` flag payload. The defaults apply when the flag is missing or
    unreadable: the check is on from the first deploy."""

    mode: FraudCheckMode = FraudCheckMode.ENFORCE
    signup_threshold: float = Field(default=0.8, ge=0.0, le=1.0)
    apikey_threshold: float = Field(default=0.9, ge=0.0, le=1.0)


class FraudCheckpoint(str, Enum):
    SIGNUP = "signup"
    API_KEY = "api_key"


class FraudVerdict(BaseModel):
    checkpoint: FraudCheckpoint
    domain: Optional[str] = None
    # None when Jev gave no answer (timeout, error, no key): the check fails open.
    score: Optional[float] = None
    threshold: float
    flagged: bool
    action: str


class ApiKeySignals(BaseModel):
    """What the API key check point sends to Jev, plus the organization to hold."""

    organization_id: UUID
    email: str
    account_age_seconds: int
    first_api_key_seconds_after_signup: int
    same_domain_signups_24h: int
    orgs_owned: int

    def to_state(self) -> dict:
        return self.model_dump(mode="json", exclude={"organization_id"})


class FraudDAOInterface(ABC):
    @abstractmethod
    async def read_api_key_signals(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        now: datetime,
    ) -> Optional[ApiKeySignals]:
        """The behaviour facts of the user creating a key in `project_id`, or None when
        the user or project does not exist."""
        raise NotImplementedError

    @abstractmethod
    async def mark_no_grants(
        self,
        *,
        organization_id: UUID,
        checkpoint: FraudCheckpoint,
        score: float,
        now: datetime,
    ) -> None:
        """Set `NO_GRANTS_FLAG` on the organization, with the verdict that set it."""
        raise NotImplementedError

    @abstractmethod
    async def grants_blocked(self, *, organization_id: UUID) -> bool:
        raise NotImplementedError
