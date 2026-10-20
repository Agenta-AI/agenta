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

from ee.src.core.wallets.plans import PLAN_ALLOWANCE_CREDIT_KIND
from ee.src.core.wallets.purchases import PURCHASE_CREDIT_KIND


# The one PostHog flag that configures the check; see `FraudCheckConfig` for the payload.
FRAUD_CHECK_FLAG = "fraud-check"

# `organizations.flags` key: the grant code awards nothing to an organization carrying it.
NO_GRANTS_FLAG = "fraud_no_grants"
# `organizations.flags` key: the verdict that set `NO_GRANTS_FLAG`.
VERDICT_FLAG = "fraud_check"
# Keys only the fraud check writes. An organization update never sets or clears them.
FRAUD_FLAG_KEYS = frozenset({NO_GRANTS_FLAG, VERDICT_FLAG})

# The whole decision (flag read, database reads, Jev call) at one check point. Past it
# the check allows. The Jev call has its own, shorter timeout inside this budget.
DECISION_TIMEOUT_SECONDS = 3.0

# Credit kinds that only exist after a payment: a purchase or top-up, and a paid plan's
# period allowance. An organization with either is a paying customer and is never held.
PAID_CREDIT_KINDS = frozenset({PURCHASE_CREDIT_KIND, PLAN_ALLOWANCE_CREDIT_KIND})

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
    # Whether the user creating the key owns the project's organization. An invited
    # member is never scored, so their key can never hold someone else's wallet.
    owns_organization: bool
    email: str
    account_age_seconds: int
    first_api_key_seconds_after_signup: int
    same_domain_signups_24h: int
    orgs_owned: int

    def to_state(self) -> dict:
        return self.model_dump(
            mode="json", exclude={"organization_id", "owns_organization"}
        )


class BillingFacts(BaseModel):
    """What the check needs to tell a free organization with no payment history from a
    paying customer. Read fresh at each decision, never cached."""

    # None when the organization has no subscription row.
    plan: Optional[str] = None
    # A Stripe customer or subscription: a checkout, a trial or a payment happened.
    has_stripe_ids: bool = False
    # Any credit of a `PAID_CREDIT_KINDS` kind with a positive amount, live or not.
    has_paid_credit: bool = False


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
        """Whether the organization carries `NO_GRANTS_FLAG`."""
        raise NotImplementedError

    @abstractmethod
    async def read_billing_facts(self, *, organization_id: UUID) -> BillingFacts:
        raise NotImplementedError
