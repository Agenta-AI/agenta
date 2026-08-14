"""Grant catalog: named, product-decided ACTIVITIES that award wallet credit outside the
plan-change proration path (`ee.src.core.wallets.plans`/`.proration`). Adding a new
activity — an activation milestone, a referral bonus, a contribution award (see
`docs/design/wallets-research/v1/mechanics.md` §4 for the full enumerated list) — is a
new row in `GRANT_CATALOG`, never a new code path: `WalletsService.award()` and
`WalletsDAOInterface.award_credit` are generic over any catalog entry.

Seeded with exactly one entry today: `signup`.
"""

from dataclasses import dataclass
from typing import Dict, Optional
from uuid import UUID

# The house default for granted value's lifetime (report.md §9.5/§9.6: "twelve months,
# the same as purchases"). A calendar-agnostic day count, not `dateutil`'s relativedelta —
# good enough for a lifetime measured in months, and keeps this module dependency-free.
TWELVE_MONTHS_DAYS = 365

# PRODUCT DECISION (2026-08-14, WP-1-05): $1 signup grant, awarded once per organization,
# on every plan including free. `credit_kind="signup_grant"` (`mechanics.md` §4;
# `GENERAL_CREDIT_KINDS` in `ee.src.core.wallets.types`) — its own kind, distinguishable
# from a `contribution_award` or any other inbound kind by the row alone.
SIGNUP_GRANT_AMOUNT_MUSD = 1_000_000  # $1
# Spent after the recurring plan_allowance credit (priority 10, `plans.py`) — the
# funded-plan allowance is drawn down first; the one-time signup bonus lasts longer.
SIGNUP_GRANT_PRIORITY = 20


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


GRANT_CATALOG: Dict[str, GrantRule] = {
    "signup": GrantRule(
        code="signup",
        amount_musd=SIGNUP_GRANT_AMOUNT_MUSD,
        credit_kind="signup_grant",
        priority=SIGNUP_GRANT_PRIORITY,
        lifetime_days=TWELVE_MONTHS_DAYS,
        repeatable=False,
    ),
    # Intended next entries (mechanics.md §4), each a new row here, no new code path.
    # Suggested priority (spend order, after plan_allowance=10/signup_grant=20 above —
    # see `ee.src.core.wallets.types.GENERAL_CREDIT_KINDS` for the full kind set):
    #   "promotion"           — repeatable=False, priority=30, keyed by campaign
    #   "referral_bonus"      — repeatable=True,  priority=40, keyed by referral identifier
    #   "contribution_award"  — repeatable=True,  priority=50, keyed by contribution identifier
    #   "goodwill"            — repeatable=True,  priority=60, keyed by support case identifier
    #   "activation_milestone" — repeatable=False, e.g. saving a first agent (not a
    #                             mechanics.md §4 kind; would need its own credit_kind)
}


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


def get_grant_rule(*, activity_code: str) -> Optional[GrantRule]:
    return GRANT_CATALOG.get(activity_code)


def compose_award_idempotency_key(
    *,
    activity_code: str,
    organization_id: UUID,
    reference: Optional[str] = None,
) -> str:
    """One prefix (`award`), then identifiers, `organization` spelled out — mirrors the
    `plan_change:{subscription_id}:{period_start}` / `measurement:{measurement_id}`
    convention elsewhere in this package. A once-per-organization activity's key omits
    `reference` entirely (there is only ever one), so two calls with different
    `reference` values for a non-repeatable activity still collide onto the same key —
    by design, since `repeatable=False` means at most one award ever."""
    key = f"award:{activity_code}:organization:{organization_id}"
    if reference is not None:
        key = f"{key}:reference:{reference}"
    return key
