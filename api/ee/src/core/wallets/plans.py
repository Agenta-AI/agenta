"""Plan -> wallet-value mappings: the single source of truth for both the general
balance's `floor_musd` and a plan's period allowance credit amount, consumed by
organization creation and the migration backfill's SQL (which must derive the same
constant, not invent its own). A plan change writes nothing to the wallet: it only
changes which allowance the next billing period grants (open-designs items 22 and 23).

PRODUCT DECISION (2026-10-06, replaces option E's 2,900 / 29,900): Starter (plan id
`cloud_v0_pro`, $20) -> 2,000 credits, Business -> 32,000 credits per billing period,
1 credit = 1 cent, expiring at the period's end. The floor amounts are a 2026-08-14 decision
(WP-1-05, `docs/design/wallets-research/v1/wave-1.md`).
`floor_musd` is 0 for every plan at launch: a hard stop when the general balance is
spent, everywhere. Individual customers get an overdraft (a negative floor) by hand
later — `floor_musd_for_plan` stays a per-plan function so that remains possible without
a signature change.
"""

from ee.src.core.access.entitlements.types import DefaultPlan

# credit_kind and priority for a plan's period allowance credit. A constant, not a
# per-plan choice, until credit priority itself becomes plan-dependent.
PLAN_ALLOWANCE_CREDIT_KIND = "plan_allowance"
PLAN_ALLOWANCE_PRIORITY = 10

# musd; $1 = 1_000_000 musd. One recurring allowance amount per plan, per billing period.
_HOBBY_ALLOWANCE_MUSD = 0  # $0 — the free tier draws no funded allowance
_PRO_ALLOWANCE_MUSD = 20_000_000  # Starter: 2,000 credits a period
_BUSINESS_ALLOWANCE_MUSD = 320_000_000  # 32,000 credits a period
# `cloud_v0_agenta_ai` is our internal plan; treated as business-tier pending a distinct
# product decision for it.
_AGENTA_AI_ALLOWANCE_MUSD = _BUSINESS_ALLOWANCE_MUSD  # business-tier parity
_SELF_HOSTED_ALLOWANCE_MUSD = 0  # self-hosted does not draw on our funded balance

_ALLOWANCE_MUSD_BY_PLAN: dict = {
    DefaultPlan.CLOUD_V0_HOBBY.value: _HOBBY_ALLOWANCE_MUSD,
    DefaultPlan.CLOUD_V0_PRO.value: _PRO_ALLOWANCE_MUSD,
    DefaultPlan.CLOUD_V0_BUSINESS.value: _BUSINESS_ALLOWANCE_MUSD,
    DefaultPlan.CLOUD_V0_AGENTA_AI.value: _AGENTA_AI_ALLOWANCE_MUSD,
    DefaultPlan.SELF_HOSTED_ENTERPRISE.value: _SELF_HOSTED_ALLOWANCE_MUSD,
}

# The plans whose organizations get the daily free credits (`grants.DAILY_FREE_ACTIVITY`).
# PRODUCT DECISION (2026-10-06): every public cloud plan; not the internal or self-hosted
# plans.
DAILY_FREE_CREDIT_PLANS = frozenset(
    {
        DefaultPlan.CLOUD_V0_HOBBY.value,
        DefaultPlan.CLOUD_V0_PRO.value,
        DefaultPlan.CLOUD_V0_BUSINESS.value,
    }
)

# Hard stop at launch: every plan floors at 0. Kept as a per-plan mapping (rather than a
# bare constant) so a later hand-set customer overdraft (a negative floor) is a data
# change here, not a new code path.
_FLOOR_MUSD_BY_PLAN: dict = {
    DefaultPlan.CLOUD_V0_HOBBY.value: 0,
    DefaultPlan.CLOUD_V0_PRO.value: 0,
    DefaultPlan.CLOUD_V0_BUSINESS.value: 0,
    DefaultPlan.CLOUD_V0_AGENTA_AI.value: 0,
    DefaultPlan.SELF_HOSTED_ENTERPRISE.value: 0,
}


# The floor a general balance row starts at when it is provisioned on a path that does not
# know the organization's plan — the settlement, award and admission paths, which
# provision lazily to close the flag gap (open-designs item 14). It equals every known
# plan's floor above, so no plan lookup is worth dragging onto those paths.
LAZY_PROVISION_FLOOR_MUSD = 0


def floor_musd_for_plan(*, plan: str) -> int:
    """The general balance's plan-dependent deficit floor. 0 for every known plan today
    (see module docstring); an unrecognized plan slug also floors at 0 rather than
    raising, matching the fail-safe posture of the rest of this mapping."""
    return _FLOOR_MUSD_BY_PLAN.get(plan, 0)


def allowance_musd_for_plan(*, plan: str) -> int:
    """A plan's full-period wallet allowance, in musd — see module docstring for the
    per-plan amounts. An unrecognized plan slug allows 0 rather than raising."""
    return _ALLOWANCE_MUSD_BY_PLAN.get(plan, 0)
