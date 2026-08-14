"""Plan -> wallet-value mappings: the single source of truth for both the general
balance's `floor_musd` and a plan's period allowance credit amount, consumed by
organization creation, subscription plan-change handling, and the migration backfill's
SQL (which must derive the same constant, not invent its own).

UNDEFINED PRODUCT DECISION: no plan in `ee.src.core.access.entitlements.types`
(`DEFAULT_ENTITLEMENTS` / `DEFAULT_CATALOG`) carries a floor or allowance value today.
Both mappings return 0 for every plan slug until a product decision defines real
per-plan numbers — do not fabricate them here. Once that decision exists, wire it into
these two functions only; every caller already threads a plan slug through them.
"""

# credit_kind and priority for the plan-allowance credit minted on a plan change. A
# constant, not a per-plan choice, until credit priority itself becomes plan-dependent.
PLAN_ALLOWANCE_CREDIT_KIND = "plan_allowance"
PLAN_ALLOWANCE_PRIORITY = 10


def floor_musd_for_plan(*, plan: str) -> int:
    """The general balance's plan-dependent deficit floor. Always 0 today (see module
    docstring)."""
    return 0


def allowance_musd_for_plan(*, plan: str) -> int:
    """A plan's full-period wallet allowance, in musd. Always 0 today (see module
    docstring) — proration against this mapping therefore always moves zero value, but
    exercises the exact same code path a nonzero mapping would."""
    return 0
