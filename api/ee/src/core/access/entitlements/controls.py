"""Plan/entitlement controls: pure builders + parsers (no singleton).

Builds the effective plan map (slug -> entitlement controls: flags, counters,
gauges, throttles) and plan descriptions from code defaults or env overrides
(`AGENTA_ACCESS_PLANS`, `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`).

This module holds no module-level state and no public accessors. The shared
singleton + `get_plan*` accessors live in `ee.src.core.access.controls`, which
calls `build_plan_controls()` once at import time.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from oss.src.utils.env import env

from ee.src.core.access.entitlements.types import (
    Category,
    Counter,
    DEFAULT_ENTITLEMENTS,
    DefaultPlan,
    Flag,
    Gauge,
    Quota,
    Throttle,
    Tracker,
)


# ---------------------------------------------------------------------------
# Override schemas
# ---------------------------------------------------------------------------


class _PlanOverride(BaseModel):
    description: Optional[str] = None
    flags: Optional[Dict[str, bool]] = None
    counters: Optional[Dict[str, Quota]] = None
    gauges: Optional[Dict[str, Quota]] = None
    throttles: Optional[List[Throttle]] = None

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Plan entitlements + descriptions
# ---------------------------------------------------------------------------

# Effective state is a dict[plan_slug, plan_entry] where plan_entry has the same
# shape as DEFAULT_ENTITLEMENTS values (Tracker -> mapping) plus an optional
# "description" key in the top-level plan entry's own description map.

_DEFAULT_PLAN_DESCRIPTIONS: Dict[str, str] = {}


def _default_plans() -> Dict[str, Dict[Tracker, Any]]:
    # Keys in DEFAULT_ENTITLEMENTS are `DefaultPlan` (str, Enum) members.
    # Coerce to plain strings so the runtime plan map is uniformly keyed by slug.
    return {str(plan.value): entry for plan, entry in DEFAULT_ENTITLEMENTS.items()}


def _validate_flag_key(key: str) -> Flag:
    try:
        return Flag(key)
    except ValueError as e:
        raise ValueError(f"Unknown flag '{key}'") from e


def _validate_counter_key(key: str) -> Counter:
    try:
        return Counter(key)
    except ValueError as e:
        raise ValueError(f"Unknown counter '{key}'") from e


def _validate_gauge_key(key: str) -> Gauge:
    try:
        return Gauge(key)
    except ValueError as e:
        raise ValueError(f"Unknown gauge '{key}'") from e


def _parse_plans_override(
    decoded: Any,
) -> tuple[Dict[str, Dict[Tracker, Any]], Dict[str, str]]:
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError("AGENTA_ACCESS_PLANS must be a non-empty JSON object")

    plans: Dict[str, Dict[Tracker, Any]] = {}
    descriptions: Dict[str, str] = {}

    for slug, payload in decoded.items():
        if not slug or not isinstance(slug, str):
            raise ValueError(f"Invalid plan slug '{slug}' in AGENTA_ACCESS_PLANS")

        try:
            override = _PlanOverride.model_validate(payload)
        except ValidationError as e:
            raise ValueError(
                f"Invalid plan override for '{slug}' in AGENTA_ACCESS_PLANS: {e}"
            ) from e

        plan_entry: Dict[Tracker, Any] = {}

        if override.flags is not None:
            plan_entry[Tracker.FLAGS] = {
                _validate_flag_key(k): bool(v) for k, v in override.flags.items()
            }

        if override.counters is not None:
            plan_entry[Tracker.COUNTERS] = {
                _validate_counter_key(k): v for k, v in override.counters.items()
            }

        if override.gauges is not None:
            plan_entry[Tracker.GAUGES] = {
                _validate_gauge_key(k): v for k, v in override.gauges.items()
            }

        if override.throttles is not None:
            plan_entry[Tracker.THROTTLES] = list(override.throttles)

        # Plans with only a description are allowed — they represent custom /
        # display-only plans (e.g. self-hosted Enterprise) that don't enforce
        # quotas server-side. Downstream consumers must handle the empty
        # entitlement map gracefully (e.g. `fetch_usage` returns no rows).
        plans[slug] = plan_entry

        if override.description:
            descriptions[slug] = override.description

    return plans, descriptions


# ---------------------------------------------------------------------------
# Default-plan overlay
# ---------------------------------------------------------------------------
#
# `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` lets self-hosted operators tweak individual
# entitlement values on the default plan without restating the entire plan in
# `AGENTA_ACCESS_PLANS`. Common cases: bumping trace retention, raising the
# standard-throttle rate, flipping a flag.
#
# Shape mirrors a plan entry (same keys, same units) with one divergence:
# `throttles` is a map keyed by category slug instead of a list, so per-
# category patches don't require restating the whole list. Throttles that
# combine multiple categories or use `endpoints` cannot be addressed via the
# overlay — operators who need that should use `AGENTA_ACCESS_PLANS`.


class _ThrottleOverlay(BaseModel):
    """Partial throttle update keyed by a single category.

    Every field is optional; only fields explicitly set on the overlay
    replace the matching field on the existing throttle entry.
    """

    bucket: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class _DefaultPlanOverlay(BaseModel):
    """Partial overlay for the default plan. Same shape as `_PlanOverride`
    except `throttles` is a map keyed by category slug."""

    description: Optional[str] = None
    flags: Optional[Dict[str, bool]] = None
    counters: Optional[Dict[str, Dict[str, Any]]] = None
    gauges: Optional[Dict[str, Dict[str, Any]]] = None
    throttles: Optional[Dict[str, _ThrottleOverlay]] = None

    model_config = ConfigDict(extra="forbid")


def _merge_quota(existing: Optional[Quota], patch: Dict[str, Any]) -> Quota:
    """Patch a Quota field-by-field, preserving fields the overlay didn't set."""
    if existing is None:
        # Patching an entitlement key that isn't defined on the base plan:
        # treat the overlay as the full definition.
        return Quota.model_validate(patch)
    merged = existing.model_dump()
    merged.update(patch)
    return Quota.model_validate(merged)


def _merge_throttle(existing: Throttle, patch: _ThrottleOverlay) -> Throttle:
    """Patch one throttle entry. `bucket` is field-merged; `mode` replaces."""
    base = existing.model_dump()
    if patch.bucket is not None:
        bucket = dict(base.get("bucket") or {})
        bucket.update(patch.bucket)
        base["bucket"] = bucket
    if patch.mode is not None:
        base["mode"] = patch.mode
    return Throttle.model_validate(base)


def _parse_default_plan_overlay(decoded: Any) -> _DefaultPlanOverlay:
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError(
            "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY must be a non-empty JSON object"
        )
    try:
        overlay = _DefaultPlanOverlay.model_validate(decoded)
    except ValidationError as e:
        raise ValueError(f"Invalid AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY: {e}") from e

    # Validate slugs upfront so the error message points at the bad key
    # rather than failing inside the merge.
    if overlay.flags is not None:
        for key in overlay.flags:
            _validate_flag_key(key)
    if overlay.counters is not None:
        for key in overlay.counters:
            _validate_counter_key(key)
    if overlay.gauges is not None:
        for key in overlay.gauges:
            _validate_gauge_key(key)
    if overlay.throttles is not None:
        valid_categories = {c.value for c in Category}
        for key in overlay.throttles:
            if key not in valid_categories:
                raise ValueError(
                    f"AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY.throttles['{key}'] is not a "
                    f"valid throttle category. Allowed: {sorted(valid_categories)}."
                )
    return overlay


def _apply_default_plan_overlay(
    plans: Dict[str, Dict[Tracker, Any]],
    descriptions: Dict[str, str],
    overlay: _DefaultPlanOverlay,
    default_plan_slug: str,
) -> tuple[Dict[str, Dict[Tracker, Any]], Dict[str, str]]:
    """Apply the overlay to the resolved default plan in-place (returning new dicts)."""
    if default_plan_slug not in plans:
        raise ValueError(
            f"AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY targets the default plan "
            f"'{default_plan_slug}', which is not in the effective plan set "
            f"({sorted(plans.keys())}). Add the slug to AGENTA_ACCESS_PLANS or "
            "unset AGENTA_DEFAULT_PLAN."
        )

    plans = {slug: dict(entry) for slug, entry in plans.items()}
    descriptions = dict(descriptions)
    entry = plans[default_plan_slug]

    if overlay.description is not None:
        descriptions[default_plan_slug] = overlay.description

    if overlay.flags is not None:
        flags = dict(entry.get(Tracker.FLAGS) or {})
        for key, value in overlay.flags.items():
            flags[Flag(key)] = bool(value)
        entry[Tracker.FLAGS] = flags

    if overlay.counters is not None:
        counters = dict(entry.get(Tracker.COUNTERS) or {})
        for key, patch in overlay.counters.items():
            counter = Counter(key)
            counters[counter] = _merge_quota(counters.get(counter), patch)
        entry[Tracker.COUNTERS] = counters

    if overlay.gauges is not None:
        gauges = dict(entry.get(Tracker.GAUGES) or {})
        for key, patch in overlay.gauges.items():
            gauge = Gauge(key)
            gauges[gauge] = _merge_quota(gauges.get(gauge), patch)
        entry[Tracker.GAUGES] = gauges

    if overlay.throttles is not None:
        existing_throttles = list(entry.get(Tracker.THROTTLES) or [])

        for category_key, patch in overlay.throttles.items():
            category = Category(category_key)
            # Find the single-category throttle entry that matches.
            target_idx = next(
                (
                    idx
                    for idx, t in enumerate(existing_throttles)
                    if t.categories
                    and len(t.categories) == 1
                    and t.categories[0] == category
                ),
                None,
            )
            if target_idx is None:
                raise ValueError(
                    f"AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY.throttles['{category_key}']: "
                    f"the default plan '{default_plan_slug}' has no single-"
                    f"category throttle entry for '{category_key}'. Use "
                    "AGENTA_ACCESS_PLANS to define multi-category or endpoint-"
                    "keyed throttles."
                )
            existing_throttles[target_idx] = _merge_throttle(
                existing_throttles[target_idx], patch
            )
        entry[Tracker.THROTTLES] = existing_throttles

    plans[default_plan_slug] = entry
    return plans, descriptions


def _resolve_default_plan_slug(plans: Dict[str, Dict[Tracker, Any]]) -> str:
    """Resolve the default plan slug for overlay targeting.

    Mirrors `subscriptions.types.get_default_plan()` without importing it (to
    avoid pulling subscription/Stripe code into the access-controls layer).
    """
    raw = env.access_controls.default_plan
    if raw:
        return raw
    if env.stripe.enabled:
        return DefaultPlan.CLOUD_V0_HOBBY.value
    return DefaultPlan.SELF_HOSTED_ENTERPRISE.value


# ---------------------------------------------------------------------------
# Build (called once by ee.src.core.access.controls)
# ---------------------------------------------------------------------------


def build_plan_controls() -> tuple[Dict[str, Dict[Tracker, Any]], Dict[str, str], str]:
    """Build the effective plan map + descriptions from defaults or env overrides.

    Returns ``(plans, descriptions, source_label)`` where ``source_label`` is a
    short string for startup logging (e.g. ``"defaults"`` or
    ``"env plan_overlay=env→<slug>"``).
    """
    plans_payload = env.access_controls.plans
    plan_overlay_payload = env.access_controls.default_plan_overlay

    if plans_payload is not None:
        plans, descriptions = _parse_plans_override(plans_payload)
        plans_source = "env"
    else:
        plans = _default_plans()
        descriptions = dict(_DEFAULT_PLAN_DESCRIPTIONS)
        plans_source = "defaults"

    plan_overlay_source = "none"
    if plan_overlay_payload is not None:
        plan_overlay = _parse_default_plan_overlay(plan_overlay_payload)
        default_plan_slug = _resolve_default_plan_slug(plans)
        plans, descriptions = _apply_default_plan_overlay(
            plans, descriptions, plan_overlay, default_plan_slug
        )
        plan_overlay_source = f"env→{default_plan_slug}"

    source = f"plans={plans_source} plan_overlay={plan_overlay_source}"
    return plans, descriptions, source
