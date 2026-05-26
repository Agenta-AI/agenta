"""Billing settings: effective catalog, Stripe pricing, free/trial plan accessors.

Reads `env.agenta.billing.catalog` and `env.agenta.billing.pricing` at import time and
falls back to code defaults. The free-plan marker and trial duration live
per-entry inside `AGENTA_BILLING_PRICING` (`{"free": true}` /
`{"trial": N}`); there is no separate `_FREE_PLAN` / `_TRIAL_PLAN` /
`_TRIAL_DAYS` env var.

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
    DefaultPlan,
)


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


_RESERVED_PRICING_KEYS: set[str] = {"free", "trial"}
_DEFAULT_TRIAL_PLAN = DefaultPlan.CLOUD_V0_PRO.value
_DEFAULT_TRIAL_DAYS = 14


def _normalize_pricing_entry(slug: str, entry: Any) -> Dict[str, Any]:
    """Validate and normalize one pricing entry.

    Canonical shape (flat — mirrors the original `STRIPE_PRICING` layout):

        {
            "free":  bool,                      # optional; reserved
            "trial": int,                       # optional; reserved; days > 0
            "<slot>": {"price": "price_...", "quantity": 1?},
            ...
        }

    `"free"` and `"trial"` are the reserved top-level keys:

    - `"free": true` marks this plan as the free / downgrade fallback. Exactly
      one entry across the whole `AGENTA_BILLING_PRICING` map may carry this.
    - `"trial": N` declares this plan as the reverse-trial plan with duration
      `N` days. Exactly one entry across the map may carry this. `N` must be
      a positive integer.

    Every other top-level key is a **Stripe-side meter slot name**
    (operator-configured on the Stripe dashboard; e.g. `"users"`, `"traces"`,
    `"base"`). A slot's value must be an object carrying a `"price"` field
    plus an optional `"quantity"` (default `1` when omitted).

    The internal `Counter` / `Gauge` slug → Stripe-side slot name map lives
    in `ee.src.core.entitlements.types.STRIPE_METER_NAMES`. The runtime in
    `ee.src.core.meters.service` resolves the internal slug through that
    map before looking up the price ID here; that is why the operator's
    pricing JSON uses Stripe-side names (matching their Stripe dashboard)
    and not internal slugs.

    Validation:

    - At least one of `"free"`, `"trial"`, or any meter slot must be present.
    - Every slot must be an object with a non-empty `"price"` string.
    - `"quantity"`, when supplied, must be an integer.
    """
    if not isinstance(entry, dict):
        raise ValueError(f"AGENTA_BILLING_PRICING['{slug}'] must be an object")

    normalized: Dict[str, Any] = {}

    for key, value in entry.items():
        if not isinstance(key, str) or not key:
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}']: keys must be non-empty strings; "
                f"got {key!r}"
            )

        if key == "free":
            normalized["free"] = bool(value)
            continue

        if key == "trial":
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise ValueError(
                    f"AGENTA_BILLING_PRICING['{slug}'].trial must be a positive "
                    f"integer (days); got {value!r}"
                )
            normalized["trial"] = value
            continue

        # Treat as a Stripe meter slot.
        if not isinstance(value, dict):
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}']['{key}']: slot must be an "
                f"object with a 'price' field; got {type(value).__name__}"
            )
        price = value.get("price")
        if not isinstance(price, str) or not price:
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}']['{key}']: missing or invalid "
                "'price' (must be a non-empty string)"
            )
        slot: Dict[str, Any] = {"price": price}
        if "quantity" in value:
            qty = value["quantity"]
            if not isinstance(qty, int) or isinstance(qty, bool):
                raise ValueError(
                    f"AGENTA_BILLING_PRICING['{slug}']['{key}'].quantity must "
                    f"be an integer; got {type(qty).__name__}"
                )
            slot["quantity"] = qty
        # Reject any unknown sub-keys inside a slot to catch operator typos.
        slot_unknown = set(value.keys()) - {"price", "quantity"}
        if slot_unknown:
            raise ValueError(
                f"AGENTA_BILLING_PRICING['{slug}']['{key}'] has unknown sub-keys: "
                f"{sorted(slot_unknown)}. Allowed: ['price', 'quantity']."
            )
        normalized[key] = slot

    if not normalized:
        raise ValueError(
            f"AGENTA_BILLING_PRICING['{slug}'] must declare at least one of "
            "'free', 'trial', or a Stripe meter slot (e.g. 'base', 'users', "
            "'traces')."
        )

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
    pricing: Dict[str, Dict[str, Any]],
) -> tuple[Optional[str], Optional[int]]:
    """Resolve the trial plan slug and duration from the pricing map.

    A plan declares itself as the trial plan by carrying `"trial": N` in its
    `AGENTA_BILLING_PRICING` entry, where `N` is the trial duration in days.
    At most one entry across the map may carry `"trial"`; multiples fail
    startup.

    When no entry carries `"trial"`, callers apply the legacy default trial.
    """
    trial_plan: Optional[str] = None
    trial_days: Optional[int] = None
    for slug, entry in pricing.items():
        days = entry.get("trial")
        if days is None:
            continue
        if trial_plan is not None:
            raise ValueError(
                "AGENTA_BILLING_PRICING has multiple trial plans "
                f"('{trial_plan}' and '{slug}'); exactly one entry may "
                "carry '\"trial\": N'."
            )
        trial_plan = slug
        trial_days = int(days)
    return trial_plan, trial_days


def _build_settings() -> tuple[
    List[Dict[str, Any]],
    Dict[str, Dict[str, Any]],
    Optional[str],
    Optional[str],
    Optional[int],
]:
    plans = set(get_plans().keys())

    catalog_payload = env.agenta.billing.catalog
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

    pricing_payload = env.agenta.billing.pricing
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

    trial_plan, trial_days = _resolve_trial(pricing)
    if trial_plan is None and env.stripe.enabled:
        trial_plan = _DEFAULT_TRIAL_PLAN
        trial_days = _DEFAULT_TRIAL_DAYS

    if trial_plan is not None and trial_plan not in plans:
        raise ValueError(
            f"No trial plan can be derived: AGENTA_BILLING_PRICING has no "
            "entry marked '\"trial\": N' and the default fallback slug "
            f"'{_DEFAULT_TRIAL_PLAN}' is not in the effective plan set "
            f"(AGENTA_ACCESS_PLANS = {sorted(plans)}). Add exactly one "
            "'\"trial\": N' entry to AGENTA_BILLING_PRICING for a plan slug "
            "present in AGENTA_ACCESS_PLANS."
        )

    # If operators set AGENTA_ACCESS_DEFAULT_PLAN (or legacy
    # AGENTA_DEFAULT_PLAN), it must reference an effective plan slug.
    # Without this guard, signup onboards orgs onto a plan that never
    # resolves at runtime and every entitlement check 404s.
    default_plan_raw = env.agenta.access.default_plan
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


def get_effective_pricing() -> Dict[str, Dict[str, Any]]:
    """Return pricing with backend-resolved free/trial markers applied.

    This keeps `/billing/pricing` as the frontend source of truth for billing
    metadata without requiring clients to duplicate backend fallback rules.
    """
    pricing = {slug: dict(entry) for slug, entry in _PRICING.items()}

    free_plan = get_free_plan()
    if free_plan:
        pricing.setdefault(free_plan, {})["free"] = True

    trial_plan = get_trial_plan()
    trial_days = get_trial_days()
    if trial_plan and trial_days is not None:
        pricing.setdefault(trial_plan, {})["trial"] = trial_days

    return pricing


def get_pricing_plan(slug: Optional[str]) -> Optional[Dict[str, Any]]:
    if not slug:
        return None
    return _PRICING.get(slug)


def get_stripe_line_items(slug: Optional[str]) -> List[Dict[str, Any]]:
    """Return Stripe line items for a plan, or `[]` if not configured.

    Derived from the flat pricing entry: every non-reserved key whose value
    carries a `"price"` is a line item. Order is the JSON-insertion order
    the operator supplied (Python dicts preserve insertion).
    """
    if not slug:
        return []
    entry = _PRICING.get(slug)
    if not entry:
        return []
    line_items: List[Dict[str, Any]] = []
    for key, value in entry.items():
        if key in _RESERVED_PRICING_KEYS:
            continue
        if isinstance(value, dict) and value.get("price"):
            line_items.append(dict(value))
    return line_items


def require_pricing(
    slug: Optional[str],
    *,
    purpose: str,
) -> List[Dict[str, Any]]:
    """Return Stripe line items or fail with an operator-facing config error."""
    line_items = get_stripe_line_items(slug)
    if line_items:
        return line_items

    plan = slug or "<missing>"

    raise ValueError(
        f"{purpose} requires Stripe line items for plan '{plan}', but none "
        "are configured. Set AGENTA_BILLING_PRICING with an entry for this "
        "plan containing at least one Stripe slot, for example "
        f'{{"{plan}": {{"base": {{"price": "price_...", "quantity": 1}}}}}}.'
    )


def get_stripe_meter_price(
    plan: Optional[str],
    meter: Optional[str],
) -> Optional[str]:
    """Return the Stripe price ID for a given (plan, meter) pair.

    `meter` is a **Stripe-side meter slot name** (e.g. `"users"`,
    `"traces"`) — the operator-configured identifier on the Stripe dashboard,
    not the internal `Counter` / `Gauge` slug. Callers in `meters/service.py`
    resolve the internal slug through `STRIPE_METER_NAMES` before calling
    this. Returns `None` when the plan has no pricing, the meter slot is
    absent, or the slot carries no `"price"`.
    """
    if not plan or not meter:
        return None
    entry = _PRICING.get(plan)
    if not entry:
        return None
    slot = entry.get(meter)
    if not isinstance(slot, dict):
        return None
    return slot.get("price")


def get_free_plan() -> Optional[str]:
    """Return the free-plan slug derived from AGENTA_BILLING_PRICING ``free`` marker.

    Falls back to ``cloud_v0_hobby`` when no env-driven free plan is defined,
    matching legacy behavior.
    """
    if _FREE_PLAN:
        return _FREE_PLAN
    return DefaultPlan.CLOUD_V0_HOBBY.value


def get_trial_plan() -> Optional[str]:
    """Return the configured trial plan slug.

    Falls back to ``cloud_v0_pro`` when no `AGENTA_BILLING_PRICING` entry
    carries `"trial": N`, matching legacy behavior.
    """
    return _TRIAL_PLAN


def get_trial_days() -> Optional[int]:
    """Return the configured trial duration in days."""
    return _TRIAL_DAYS


def trial_enabled() -> bool:
    """True when trial plan and duration are resolvable."""
    return _TRIAL_PLAN is not None and _TRIAL_DAYS is not None
