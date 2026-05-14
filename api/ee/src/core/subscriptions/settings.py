"""Billing settings: effective catalog, Stripe pricing, free/trial plan accessors.

Reads `env.billing.catalog`, `env.billing.pricing`, `env.billing.trial_plan`,
and `env.billing.trial_days` at import time and falls back to code defaults.

Catalog entries provide user-facing display metadata for `/billing/plans`.
Pricing entries provide Stripe line items and the free-plan marker.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.controls import get_plans
from ee.src.core.entitlements.types import (
    DEFAULT_CATALOG,
    Counter,
    DefaultPlan,
    Gauge,
)


_VALID_METER_KEYS: set[str] = {c.value for c in Counter} | {g.value for g in Gauge}
_VALID_CATALOG_TYPES: set[str] = {"standard", "custom"}


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class _CatalogEntry(BaseModel):
    """Schema-level validation for an entry in ``AGENTA_BILLING_CATALOG``.

    The catalog is rendered by the frontend pricing modal; field shape drives
    what the user sees. Extra fields are intentionally allowed so operators
    can extend the catalog without backend changes — but the documented set
    of required fields (title/description/type/features) is enforced.
    """

    title: str
    description: str
    type: str
    features: List[str]
    plan: Optional[str] = None
    price: Optional[Dict[str, Any]] = None
    retention: Optional[int] = None

    model_config = ConfigDict(extra="allow")


def _default_catalog() -> List[Dict[str, Any]]:
    return [dict(entry) for entry in DEFAULT_CATALOG]


def _parse_catalog_override(decoded: Any) -> List[Dict[str, Any]]:
    if not isinstance(decoded, list):
        raise ValueError("AGENTA_BILLING_CATALOG must be a JSON array")

    catalog: List[Dict[str, Any]] = []
    for idx, entry in enumerate(decoded):
        if not isinstance(entry, dict):
            raise ValueError("AGENTA_BILLING_CATALOG entries must be objects")
        try:
            parsed = _CatalogEntry.model_validate(entry)
        except ValidationError as e:
            raise ValueError(f"AGENTA_BILLING_CATALOG[{idx}] is invalid: {e}") from e
        if parsed.type not in _VALID_CATALOG_TYPES:
            raise ValueError(
                f"AGENTA_BILLING_CATALOG[{idx}].type must be one of "
                f"{sorted(_VALID_CATALOG_TYPES)}; got '{parsed.type}'."
            )
        # Round-trip through model_dump so extras (passed through to the
        # frontend) survive but required fields are guaranteed present.
        catalog.append(parsed.model_dump(exclude_none=True))
    return catalog


# ---------------------------------------------------------------------------
# Pricing (Stripe line items + free plan marker)
# ---------------------------------------------------------------------------


def _default_pricing() -> Dict[str, Dict[str, Any]]:
    """No code-default pricing. Stripe line items must come from
    `AGENTA_BILLING_PRICING`; paid-checkout flows fail clearly when missing."""
    return {}


def _normalize_pricing_entry(slug: str, entry: Any) -> Dict[str, Any]:
    """Validate and normalize one pricing entry.

    Canonical shape:

        {
            "free": bool,                 # optional, exactly one entry may be free=true
            "stripe": {                   # required for paid plans
                "line_items": [           # passed to Stripe checkout/subscription
                    {"price": "price_...", "quantity": 1},
                    ...
                ],
                "meters": {               # optional, per-meter price IDs for
                    "users":  {"price": "price_..."},   # usage reporting
                    "traces": {"price": "price_..."}
                }
            }
        }

    `meters` keys must be valid counter/gauge slugs. They are looked up by
    `ee.src.core.meters.service` to report quantities to the right Stripe
    subscription item.
    """
    if not isinstance(entry, dict):
        raise ValueError(f"AGENTA_BILLING_PRICING['{slug}'] must be an object")

    allowed_top = {"free", "stripe"}
    unknown = set(entry.keys()) - allowed_top
    if unknown:
        raise ValueError(
            f"AGENTA_BILLING_PRICING['{slug}'] has unknown keys: {sorted(unknown)}. "
            f"Allowed: {sorted(allowed_top)}. "
            "If migrating from STRIPE_PRICING, see scripts/migrate_stripe_pricing.py."
        )

    normalized: Dict[str, Any] = {}

    if "free" in entry:
        normalized["free"] = bool(entry["free"])

    if "stripe" in entry:
        stripe_block = entry["stripe"]
        if not isinstance(stripe_block, dict):
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}'].stripe must be an object"
            )

        stripe_unknown = set(stripe_block.keys()) - {"line_items", "meters"}
        if stripe_unknown:
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}'].stripe has unknown keys: "
                f"{sorted(stripe_unknown)}. Allowed: ['line_items', 'meters']."
            )

        line_items = stripe_block.get("line_items") or []
        if not isinstance(line_items, list):
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}'].stripe.line_items must be a list"
            )

        meters = stripe_block.get("meters") or {}
        if not isinstance(meters, dict):
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}'].stripe.meters must be an object"
            )
        for meter_key, meter_entry in meters.items():
            if meter_key not in _VALID_METER_KEYS:
                raise ValueError(
                    f"AGENTA_BILLING_PRICING['{slug}'].stripe.meters['{meter_key}'] "
                    "is not a valid Counter/Gauge slug. Allowed keys: "
                    f"{sorted(_VALID_METER_KEYS)}."
                )
            if not isinstance(meter_entry, dict) or "price" not in meter_entry:
                raise ValueError(
                    f"AGENTA_BILLING_PRICING['{slug}'].stripe.meters['{meter_key}'] "
                    "must be an object with a 'price' field"
                )

        normalized["stripe"] = {
            "line_items": list(line_items),
            "meters": dict(meters),
        }

    return normalized


def _parse_pricing_override(decoded: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(decoded, dict):
        raise ValueError("AGENTA_BILLING_PRICING must be a JSON object")

    pricing: Dict[str, Dict[str, Any]] = {}
    free_seen: Optional[str] = None

    for slug, entry in decoded.items():
        if not slug or not isinstance(slug, str):
            raise ValueError(f"Invalid pricing plan slug '{slug}'")
        normalized = _normalize_pricing_entry(slug, entry)
        if normalized.get("free"):
            if free_seen is not None:
                raise ValueError(
                    "AGENTA_BILLING_PRICING has multiple free plans "
                    f"('{free_seen}' and '{slug}'); exactly one allowed"
                )
            free_seen = slug
        pricing[slug] = normalized

    return pricing


# ---------------------------------------------------------------------------
# Effective settings (built once at import time)
# ---------------------------------------------------------------------------


def _resolve_trial(
    plans: set[str],
) -> tuple[Optional[str], Optional[int]]:
    """Resolve the trial plan slug and duration.

    Rule: `AGENTA_BILLING_TRIAL_PLAN` and `AGENTA_BILLING_TRIAL_DAYS` must
    be configured together — either both set or neither. Setting only one
    fails startup with a clear error.

    When neither is set the reverse-trial flow is disabled and signups
    onboard directly on the free plan.
    """
    raw_plan = env.billing.trial_plan
    raw_days = env.billing.trial_days

    if (raw_plan is None) != (raw_days is None):
        missing = (
            "AGENTA_BILLING_TRIAL_DAYS" if raw_plan else "AGENTA_BILLING_TRIAL_PLAN"
        )
        raise ValueError(
            f"Trial configuration is incomplete: {missing} is required when the "
            "other trial env var is set. Either configure both or unset both."
        )

    if raw_plan is None:
        return None, None

    if raw_plan not in plans:
        raise ValueError(
            f"AGENTA_BILLING_TRIAL_PLAN '{raw_plan}' is not in the effective plans set"
        )

    if raw_days is None or raw_days <= 0:
        raise ValueError(
            f"AGENTA_BILLING_TRIAL_DAYS must be a positive integer, got {raw_days!r}"
        )

    return raw_plan, int(raw_days)


def _build_settings() -> tuple[
    List[Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    Optional[str],
    Optional[str],
    Optional[int],
]:
    plans = set(get_plans().keys())

    catalog_payload = env.billing.catalog
    if catalog_payload is not None:
        catalog = _parse_catalog_override(catalog_payload)
        catalog_source = "env"
    else:
        catalog = _default_catalog()
        catalog_source = "defaults"

    for entry in catalog:
        slug = entry.get("plan")
        if slug and slug not in plans:
            raise ValueError(
                f"AGENTA_BILLING_CATALOG references plan '{slug}' not in effective plans"
            )

    pricing_payload = env.billing.pricing
    if pricing_payload is not None:
        pricing = _parse_pricing_override(pricing_payload)
        pricing_source = "env"
    else:
        pricing = _default_pricing()
        pricing_source = "defaults"

    for slug in pricing.keys():
        if slug not in plans:
            raise ValueError(
                f"AGENTA_BILLING_PRICING references plan '{slug}' not in effective plans"
            )

    free_plan: Optional[str] = None
    for slug, entry in pricing.items():
        if entry.get("free"):
            free_plan = slug
            break

    # If no env-driven free plan was declared, fall back to the legacy
    # ``cloud_v0_hobby`` slug — but only when it actually exists in the
    # effective plan set. Operators who restrict ``AGENTA_ACCESS_PLANS`` to
    # a slug set without ``cloud_v0_hobby`` MUST mark one entry of
    # ``AGENTA_BILLING_PRICING`` as ``"free": true``; otherwise we would
    # silently write a non-existent plan to ``subscriptions.plan`` during
    # cancel/downgrade, then 404 on every entitlement check.
    if free_plan is None and DefaultPlan.CLOUD_V0_HOBBY.value not in plans:
        raise ValueError(
            "No free plan can be derived: AGENTA_BILLING_PRICING has no entry "
            "marked '\"free\": true' and the default fallback slug "
            f"'{DefaultPlan.CLOUD_V0_HOBBY.value}' is not in the effective "
            "plan set. Add exactly one '\"free\": true' entry to "
            "AGENTA_BILLING_PRICING for a plan slug present in "
            "AGENTA_ACCESS_PLANS."
        )

    trial_plan, trial_days = _resolve_trial(plans)

    # If operators set AGENTA_ACCESS_DEFAULT_PLAN (or legacy
    # AGENTA_DEFAULT_PLAN), it must reference an effective plan slug.
    # Without this guard, signup onboards orgs onto a plan that never
    # resolves at runtime and every entitlement check 404s.
    default_plan_raw = env.access_controls.default_plan
    if default_plan_raw and default_plan_raw not in plans:
        raise ValueError(
            f"AGENTA_ACCESS_DEFAULT_PLAN '{default_plan_raw}' is not in the "
            "effective plans set. Set it to one of the slugs in "
            "AGENTA_ACCESS_PLANS, or unset it to fall back to the code "
            "defaults."
        )

    log.info(
        "[billing-settings] catalog=%s pricing=%s free_plan=%s trial=%s",
        catalog_source,
        pricing_source,
        free_plan,
        f"{trial_plan}/{trial_days}d" if trial_plan else "disabled",
    )

    return catalog, pricing, free_plan, trial_plan, trial_days


_CATALOG, _PRICING, _FREE_PLAN, _TRIAL_PLAN, _TRIAL_DAYS = _build_settings()


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------


def get_catalog() -> List[Dict[str, Any]]:
    return _CATALOG


def get_catalog_plan(slug: Optional[str]) -> Optional[Dict[str, Any]]:
    if not slug:
        return None
    for entry in _CATALOG:
        if entry.get("plan") == slug:
            return entry
    return None


def get_pricing() -> Dict[str, Dict[str, Any]]:
    return _PRICING


def get_pricing_plan(slug: Optional[str]) -> Optional[Dict[str, Any]]:
    if not slug:
        return None
    return _PRICING.get(slug)


def get_stripe_line_items(slug: Optional[str]) -> List[Dict[str, Any]]:
    """Return Stripe line items for a plan, or [] if not configured."""
    if not slug:
        return []
    entry = _PRICING.get(slug)
    if not entry:
        return []
    stripe_block = entry.get("stripe") or {}
    return list(stripe_block.get("line_items") or [])


def get_stripe_meter_price(
    plan: Optional[str],
    meter: Optional[str],
) -> Optional[str]:
    """Return the Stripe price ID for a given (plan, meter) pair.

    `meter` is a counter or gauge slug (e.g. "users", "traces"). Used by
    `meters/service.py` to find the Stripe subscription item to report usage to.
    Returns None when the plan has no pricing or the meter has no price wired up.
    """
    if not plan or not meter:
        return None
    entry = _PRICING.get(plan)
    if not entry:
        return None
    meters = (entry.get("stripe") or {}).get("meters") or {}
    return (meters.get(meter) or {}).get("price")


def get_free_plan() -> Optional[str]:
    """Return the free-plan slug derived from AGENTA_BILLING_PRICING ``free`` marker.

    Falls back to ``cloud_v0_hobby`` when no env-driven free plan is defined,
    matching legacy behavior.
    """
    if _FREE_PLAN:
        return _FREE_PLAN
    return DefaultPlan.CLOUD_V0_HOBBY.value


def get_trial_plan() -> Optional[str]:
    """Return the configured trial plan slug, or None if trial is disabled.

    Disabled when `AGENTA_BILLING_TRIAL_PLAN` / `AGENTA_BILLING_TRIAL_DAYS`
    are unset — signups should onboard directly on the free plan.
    """
    return _TRIAL_PLAN


def get_trial_days() -> Optional[int]:
    """Return the configured trial duration in days, or None if disabled."""
    return _TRIAL_DAYS


def trial_enabled() -> bool:
    """True when both trial env vars are configured."""
    return _TRIAL_PLAN is not None and _TRIAL_DAYS is not None
