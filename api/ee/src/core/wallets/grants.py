"""Grant catalog: named, product-decided ACTIVITIES that award wallet credit, apart from
a plan's period allowance (`ee.src.core.wallets.plans`). Adding a new
activity — an activation milestone, a referral bonus, a contribution award (see
`docs/design/wallets-research/v1/mechanics.md` §4 for the full enumerated list) — is a
new row in `GRANT_CATALOG`, never a new code path: `WalletsService.award()` and
`WalletsDAOInterface.award_credit` are generic over any catalog entry.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Optional
from uuid import UUID

# The house default for granted value's lifetime (report.md §9.5/§9.6: "twelve months,
# the same as purchases"). A calendar-agnostic day count, not `dateutil`'s relativedelta —
# good enough for a lifetime measured in months, and keeps this module dependency-free.
TWELVE_MONTHS_DAYS = 365

# PRODUCT DECISION (2026-10-02, pricing option E): $5 signup grant, awarded once per
# organization, on every plan including free. The backfill job awards through this rule too. `credit_kind="signup_grant"` (`mechanics.md` §4;
# `GENERAL_CREDIT_KINDS` in `ee.src.core.wallets.types`) — its own kind, distinguishable
# from a `contribution_award` or any other inbound kind by the row alone.
SIGNUP_GRANT_AMOUNT_MUSD = 5_000_000  # $5 = 500 credits
# Spent after the recurring plan_allowance credit (priority 10, `plans.py`) — the
# funded-plan allowance is drawn down first; the one-time signup bonus lasts longer.
SIGNUP_GRANT_PRIORITY = 20

# PRODUCT DECISION (2026-10-02, widened 2026-10-06): 75 credits a day on every public
# cloud plan (`plans.DAILY_FREE_CREDIT_PLANS`).
# 1 credit = 1 cent = 10_000 musd. Granted on the organization's first wallet admission of
# the UTC day, expiring at the next UTC midnight, so it never rolls over.
DAILY_FREE_CREDITS_MUSD = 750_000  # 75 credits = $0.75
# Spent first: it is the credit that expires soonest.
DAILY_FREE_CREDITS_PRIORITY = 5
DAILY_FREE_ACTIVITY = "daily_free"
# PRODUCT DECISION (2026-10-06): at most 10 daily grants per UTC calendar month per
# organization. Days after the tenth grant get none until the next month.
DAILY_FREE_GRANTS_PER_MONTH = 10


@dataclass(frozen=True)
class GrantRule:
    code: str
    amount_musd: int
    credit_kind: str
    priority: int
    # Days after the award's `now` until the minted credit expires; `None` = never.
    lifetime_days: Optional[int]
    # `False`: idempotency key is (activity, organization) — at most one award ever.
    # `True`: idempotency key is (activity, organization, reference) — the caller's
    # `reference` (e.g. a referral id, a contribution id) makes each occurrence distinct.
    repeatable: bool
    # `True`: the credit expires at the next UTC midnight after `now`, and
    # `lifetime_days` is ignored.
    ends_at_utc_midnight: bool = False
    # At most this many awards of the rule per UTC calendar month; `None` = no cap.
    max_awards_per_month: Optional[int] = None


GRANT_CATALOG: Dict[str, GrantRule] = {
    "signup": GrantRule(
        code="signup",
        amount_musd=SIGNUP_GRANT_AMOUNT_MUSD,
        credit_kind="signup_grant",
        priority=SIGNUP_GRANT_PRIORITY,
        lifetime_days=TWELVE_MONTHS_DAYS,
        repeatable=False,
    ),
    # Repeatable per UTC date: the reference is the date (`daily_free_reference`), so an
    # organization gets at most one daily grant per day however many admissions race.
    DAILY_FREE_ACTIVITY: GrantRule(
        code=DAILY_FREE_ACTIVITY,
        amount_musd=DAILY_FREE_CREDITS_MUSD,
        credit_kind="daily_free",
        priority=DAILY_FREE_CREDITS_PRIORITY,
        lifetime_days=None,
        repeatable=True,
        ends_at_utc_midnight=True,
        max_awards_per_month=DAILY_FREE_GRANTS_PER_MONTH,
    ),
}


def daily_free_reference(*, day: date) -> str:
    return day.isoformat()


def next_utc_midnight(now: datetime) -> datetime:
    day = now.astimezone(timezone.utc).date() + timedelta(days=1)
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def utc_month_start(now: datetime) -> datetime:
    day = now.astimezone(timezone.utc).date().replace(day=1)
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


class UnknownGrantActivityError(Exception):
    """Raised when `WalletsService.award()` is called with an `activity_code` that has
    no entry in `GRANT_CATALOG`."""

    def __init__(self, activity_code: str):
        self.activity_code = activity_code
        super().__init__(f"No grant catalog entry for activity '{activity_code}'")


class GrantReferenceRequiredError(Exception):
    """Raised when a repeatable grant activity is awarded without a `reference` — a
    repeatable rule's idempotency key is undefined without one."""

    def __init__(self, activity_code: str):
        self.activity_code = activity_code
        super().__init__(
            f"Grant activity '{activity_code}' is repeatable and requires a reference"
        )


class GrantCapReachedError(Exception):
    """Raised by `WalletsDAOInterface.award_credit` when the organization already holds
    `cap_count` credits of the kind minted since `cap_since`; nothing is written."""

    def __init__(self, credit_kind: str, cap_count: int):
        self.credit_kind = credit_kind
        self.cap_count = cap_count
        super().__init__(f"Grant cap reached: {cap_count} '{credit_kind}' grants")


def get_grant_rule(*, activity_code: str) -> Optional[GrantRule]:
    return GRANT_CATALOG.get(activity_code)


def compose_award_idempotency_key(
    *,
    activity_code: str,
    organization_id: UUID,
    reference: Optional[str] = None,
) -> str:
    """One prefix (`award`), then identifiers, `organization` spelled out — mirrors the
    `measurement:{measurement_id}` convention elsewhere in this package. A once-per-organization activity's key omits
    `reference` entirely (there is only ever one), so two calls with different
    `reference` values for a non-repeatable activity still collide onto the same key —
    by design, since `repeatable=False` means at most one award ever."""
    key = f"award:{activity_code}:organization:{organization_id}"
    if reference is not None:
        key = f"{key}:reference:{reference}"
    return key
