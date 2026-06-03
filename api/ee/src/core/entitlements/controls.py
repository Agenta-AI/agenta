"""Access controls: effective plan/role accessors built from code defaults or env overrides.

This module is the single runtime source of truth for:

- the effective plan slug set;
- per-plan entitlement controls (flags, counters, gauges, throttles);
- per-scope role catalogs (organization, workspace, project).

Code defaults live in `types.py` and `ee.src.models.shared_models`. Environment
overrides come from `AGENTA_ACCESS_PLANS` and `AGENTA_ACCESS_ROLES` (raw JSON
strings exposed via `env.agenta.access`). Parsing happens once at import time.
"""

import hashlib
from json import dumps
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import (
    Category,
    Counter,
    DEFAULT_ENTITLEMENTS,
    DefaultPlan,
    DefaultRole,
    Flag,
    Gauge,
    OWNER_PERMISSIONS,
    Quota,
    SCOPES,
    Throttle,
    Tracker,
)
from ee.src.models.shared_models import Permission, WorkspaceRole


log = get_module_logger(__name__)


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


class _RoleOverride(BaseModel):
    role: str
    description: Optional[str] = None
    permissions: List[str]

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
# Role catalogs (scoped)
# ---------------------------------------------------------------------------
#
# Minima contract: every scope MUST expose `owner` and `viewer` with code-
# defined permissions. Env overrides may add roles or customize permissions
# of non-minima roles, but the minima are always present and their slugs
# cannot be re-bound to a different permission set.


def _read_only_permissions() -> List[str]:
    """Read-only permission set sourced from the code-default `WorkspaceRole.VIEWER`.

    Used as the `viewer` minima permissions for the `workspace` and `project`
    scopes where permissions are actually enforced. Organization-scope `viewer`
    has no permissions (it's just a membership marker today).
    """
    return [p.value for p in Permission.default_permissions(WorkspaceRole.VIEWER)]


def _viewer_permissions_for_scope(scope: str) -> List[str]:
    """Per-scope code-default permissions for the `viewer` minima role.

    - `organization`: empty — orgs have no permission concept today.
    - `workspace` and `project`: the code-default `WorkspaceRole.VIEWER` read-only set.
    """
    if scope == "organization":
        return []
    return _read_only_permissions()


def _minima_for(scope: str) -> List[Dict[str, Any]]:
    """Return the required role entries for a scope (owner + viewer).

    Application code relies on these slugs being present in every scope; the
    builder synthesizes them up front and re-applies them after any env
    overrides so they can never be dropped or relabeled.

    The permission set for `viewer` varies per scope (see
    `_viewer_permissions_for_scope`); `owner` is always wildcard.
    """
    return [
        {
            "role": DefaultRole.OWNER.value,
            "description": "Full access (wildcard permissions).",
            "permissions": list(OWNER_PERMISSIONS),
        },
        {
            "role": DefaultRole.VIEWER.value,
            "description": (
                "Membership marker (no permissions)."
                if scope == "organization"
                else "Read-only access."
            ),
            "permissions": _viewer_permissions_for_scope(scope),
        },
    ]


def _default_roles() -> Dict[str, List[Dict[str, Any]]]:
    """Return the code-default role catalog for each scope.

    Workspace and project scopes expose the code-default `WorkspaceRole`
    entries on top of the minima — project membership stores the same role
    slugs (`admin`/`developer`/`editor`/`annotator`), and the runtime
    permission check resolves them through this map. Organization scope
    only gets the minima today; new roles can be added per-scope via
    `AGENTA_ACCESS_ROLES`.
    """
    default_extras: List[Dict[str, Any]] = []
    minima_slugs = {DefaultRole.OWNER.value, DefaultRole.VIEWER.value}
    for role in WorkspaceRole:
        if role.value in minima_slugs:
            continue
        default_extras.append(
            {
                "role": role.value,
                "description": WorkspaceRole.get_description(role),
                "permissions": [p.value for p in Permission.default_permissions(role)],
            }
        )

    return {
        "organization": _minima_for("organization"),
        "workspace": _minima_for("workspace") + default_extras,
        "project": _minima_for("project") + default_extras,
    }


def _validate_permission(slug: str) -> str:
    if slug == "*":
        return slug
    try:
        Permission(slug)
    except ValueError as e:
        raise ValueError(f"Unknown permission '{slug}'") from e
    return slug


def _parse_roles_override(decoded: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Parse `AGENTA_ACCESS_ROLES` and merge with scope minima.

    Schema is `{scope: [role, ...]}` where scope is one of `organization`,
    `workspace`, `project`. Missing scopes fall back to the code-default
    minima for that scope. Within an overridden scope:

      - `owner` and `viewer` are reserved slugs; if present, they're rejected
        with a clear error so application invariants stay intact. The minima
        for that scope are re-applied after parsing.
      - Other roles are validated (known permissions, no duplicates) and
        appended to the minima list.

    Empty `{}` or an empty per-scope list is rejected.
    """
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError("AGENTA_ACCESS_ROLES must be a non-empty JSON object")

    # Start with code-default catalogs for every scope. Overrides only mutate
    # the scopes they specify; non-overridden scopes keep their full code
    # defaults (e.g. workspace's admin/developer/editor/annotator stay even
    # when only `project` is overridden).
    result: Dict[str, List[Dict[str, Any]]] = _default_roles()

    reserved = {DefaultRole.OWNER.value, DefaultRole.VIEWER.value}

    for scope, roles in decoded.items():
        if scope not in SCOPES:
            raise ValueError(
                f"Unknown role scope '{scope}' in AGENTA_ACCESS_ROLES "
                f"(allowed: {list(SCOPES)})"
            )

        if not isinstance(roles, list) or not roles:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES['{scope}'] must be a non-empty list of roles"
            )

        extras: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for entry in roles:
            try:
                role = _RoleOverride.model_validate(entry)
            except ValidationError as e:
                raise ValueError(
                    f"Invalid role override under scope '{scope}': {e}"
                ) from e

            slug = role.role
            if not slug:
                raise ValueError(f"Empty role slug under scope '{scope}'")
            if slug in reserved:
                raise ValueError(
                    f"AGENTA_ACCESS_ROLES['{scope}'] cannot redefine reserved "
                    f"role '{slug}'; minima are always synthesized by the platform"
                )
            if slug in seen:
                raise ValueError(f"Duplicate role slug '{slug}' under scope '{scope}'")
            seen.add(slug)

            permissions = [_validate_permission(p) for p in role.permissions]

            extras.append(
                {
                    "role": slug,
                    "description": role.description,
                    "permissions": permissions,
                }
            )

        # Minima first, then validated extras.
        result[scope] = _minima_for(scope) + extras

    # TEMP: workspace and project use the same role set at runtime (the only
    # caller of `workspace`-scope roles today is the Invite Members modal,
    # which is really inviting to the underlying project). Operators almost
    # always override only `project` via AGENTA_ACCESS_ROLES; without this
    # mirror, custom roles silently disappear from the workspace catalog.
    # Remove once the workspace/project scope split is reconciled.
    if "project" in decoded and "workspace" not in decoded:
        project_extras = [
            entry
            for entry in result["project"]
            if entry["role"] not in {DefaultRole.OWNER.value, DefaultRole.VIEWER.value}
        ]
        result["workspace"] = _minima_for("workspace") + project_extras

    return result


# ---------------------------------------------------------------------------
# Roles overlay
# ---------------------------------------------------------------------------
#
# `AGENTA_ACCESS_ROLES_OVERLAY` lets operators tweak individual fields on
# existing default roles (`admin`, `developer`, `editor`, `annotator`) — or
# add new roles — without restating the whole scope catalog the way
# `AGENTA_ACCESS_ROLES` requires.
#
# The overlay accepts two shapes:
#
#   - Project-focused shortcut (preferred for the common case):
#       {<role_slug>: <patch>, ...}
#     The whole dict is interpreted as project-level role patches. The scope
#     names (`organization`, `workspace`, `project`) are reserved and cannot
#     be used as role slugs in this form.
#
#   - Full form, scoped:
#       {"project": {<role_slug>: <patch>, ...}}
#     Triggered when any of `organization`/`workspace`/`project` appears at
#     the root. Today only `project` is supported; `organization` and
#     `workspace` are rejected — silent ignore would mislead operators.
#
# In both shapes the patch is applied to both the `workspace` and `project`
# scopes because the two scopes share the same role set in the code defaults.
#
# Merge semantics per role slug:
#   - role exists in the scope: per-field replace (`permissions` and/or
#     `description`).
#   - role does not exist: append as a new role (must include both
#     `description` and `permissions`).
#   - `owner` and `viewer` minima cannot be patched (platform-managed).


class _RoleOverlayEntry(BaseModel):
    """Partial role update. ``permissions`` and ``description`` are both
    optional; whatever is set replaces the matching field on the existing
    role entry. To add a new role both fields must be supplied — that
    constraint is enforced in :func:`_apply_roles_overlay`.
    """

    description: Optional[str] = None
    permissions: Optional[List[str]] = None

    model_config = ConfigDict(extra="forbid")


def _parse_roles_overlay(decoded: Any) -> Dict[str, _RoleOverlayEntry]:
    """Parse `AGENTA_ACCESS_ROLES_OVERLAY` and return per-slug entries.

    Two accepted payload shapes:

    1. Project-focused shortcut — ``{<role_slug>: <patch>}``. Used when none
       of the scope keys (``organization``, ``workspace``, ``project``) appear
       at the root; the payload is interpreted as project-level role patches.
       The scope names are therefore reserved and cannot be used as role slugs.

    2. Full (scoped) form — ``{"project": {<role_slug>: <patch>}}``. Triggered
       when any of ``organization``, ``workspace``, ``project`` appears at the
       root. Only ``project`` is supported today; ``organization`` and
       ``workspace`` are rejected.

    The result is the inner ``{<role_slug>: <patch>}`` dict; the caller decides
    which scopes the patch applies to.
    """
    if not isinstance(decoded, dict) or not decoded:
        raise ValueError("AGENTA_ACCESS_ROLES_OVERLAY must be a non-empty JSON object")

    scope_keys = {"organization", "workspace", "project"}

    if scope_keys & set(decoded.keys()):
        # Full parse: at least one scope key at root.
        unsupported = (set(decoded.keys()) & scope_keys) - {"project"}
        if unsupported:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY only supports the 'project' scope "
                f"today (got: {sorted(unsupported)}). The patch is applied to "
                "both workspace and project."
            )
        unknown = set(decoded.keys()) - scope_keys
        if unknown:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY mixes scope keys with non-scope "
                f"keys at the root ({sorted(unknown)}). Either use the "
                "project-focused shortcut (no scope keys, role slugs at the "
                "root) or the full form ({'project': {...}})."
            )
        project_payload = decoded.get("project")
        if not isinstance(project_payload, dict) or not project_payload:
            raise ValueError(
                "AGENTA_ACCESS_ROLES_OVERLAY['project'] must be a non-empty "
                "JSON object keyed by role slug"
            )
    else:
        # Project-focused shortcut: top-level dict is keyed by role slug.
        project_payload = decoded

    reserved = {DefaultRole.OWNER.value, DefaultRole.VIEWER.value}
    entries: Dict[str, _RoleOverlayEntry] = {}
    for slug, patch in project_payload.items():
        if not slug or not isinstance(slug, str):
            raise ValueError(
                f"Invalid role slug '{slug}' in AGENTA_ACCESS_ROLES_OVERLAY"
            )
        if slug in reserved:
            raise ValueError(
                f"AGENTA_ACCESS_ROLES_OVERLAY cannot patch reserved role "
                f"'{slug}'; minima are platform-managed"
            )
        try:
            entry = _RoleOverlayEntry.model_validate(patch)
        except ValidationError as e:
            raise ValueError(
                f"Invalid AGENTA_ACCESS_ROLES_OVERLAY['project']['{slug}']: {e}"
            ) from e
        if entry.permissions is not None:
            for perm in entry.permissions:
                _validate_permission(perm)
        entries[slug] = entry

    return entries


def _apply_roles_overlay(
    roles: Dict[str, List[Dict[str, Any]]],
    overlay: Dict[str, _RoleOverlayEntry],
) -> Dict[str, List[Dict[str, Any]]]:
    """Apply the parsed overlay to the workspace and project scopes.

    Returns a new dict; the input is not mutated. New roles (where the
    slug doesn't already exist on the scope) require both ``description``
    and ``permissions``.
    """
    result = {scope: [dict(entry) for entry in roles[scope]] for scope in roles}

    for scope_name in ("workspace", "project"):
        scope_entries = result[scope_name]
        by_slug = {entry["role"]: idx for idx, entry in enumerate(scope_entries)}

        for slug, patch in overlay.items():
            if slug in by_slug:
                # Patch existing role: per-field replace.
                idx = by_slug[slug]
                if patch.description is not None:
                    scope_entries[idx]["description"] = patch.description
                if patch.permissions is not None:
                    scope_entries[idx]["permissions"] = list(patch.permissions)
            else:
                # New role: both fields must be present.
                if patch.permissions is None:
                    raise ValueError(
                        f"AGENTA_ACCESS_ROLES_OVERLAY['project']['{slug}']: "
                        f"new role requires 'permissions' (scope '{scope_name}' "
                        "has no existing role with this slug to patch)"
                    )
                scope_entries.append(
                    {
                        "role": slug,
                        "description": patch.description,
                        "permissions": list(patch.permissions),
                    }
                )

    return result


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
    raw = env.agenta.access.default_plan
    if raw:
        return raw
    if env.stripe.enabled:
        return DefaultPlan.CLOUD_V0_HOBBY.value
    return DefaultPlan.SELF_HOSTED_ENTERPRISE.value


# ---------------------------------------------------------------------------
# Effective controls (built once at import time)
# ---------------------------------------------------------------------------


def _build_controls() -> tuple[
    Dict[str, Dict[Tracker, Any]],
    Dict[str, str],
    Dict[str, List[Dict[str, Any]]],
    str,
]:
    plans_payload = env.agenta.access.plans
    roles_payload = env.agenta.access.roles
    roles_overlay_payload = env.agenta.access.roles_overlay
    plan_overlay_payload = env.agenta.access.default_plan_overlay

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

    if roles_payload is not None:
        roles = _parse_roles_override(roles_payload)
        roles_source = "env"
    else:
        roles = _default_roles()
        roles_source = "defaults"

    roles_overlay_source = "none"
    if roles_overlay_payload is not None:
        roles_overlay = _parse_roles_overlay(roles_overlay_payload)
        roles = _apply_roles_overlay(roles, roles_overlay)
        roles_overlay_source = "env"

    payload = dumps(
        {
            "plans": sorted(plans.keys()),
            "descriptions": descriptions,
            "roles": {scope: [r["role"] for r in roles[scope]] for scope in SCOPES},
        },
        sort_keys=True,
        default=str,
    )
    controls_hash = hashlib.sha256(payload.encode()).hexdigest()[:12]

    log.info(
        "[access-controls] plans=%s roles=%s plan_overlay=%s roles_overlay=%s hash=%s",
        plans_source,
        roles_source,
        plan_overlay_source,
        roles_overlay_source,
        controls_hash,
    )

    return plans, descriptions, roles, controls_hash


_PLANS, _PLAN_DESCRIPTIONS, _ROLES, _CONTROLS_HASH = _build_controls()


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------


def get_plans() -> Dict[str, Dict[Tracker, Any]]:
    """Return the effective plan map (slug -> entitlement controls)."""
    return _PLANS


def get_plan(slug: Optional[str]) -> Optional[Dict[Tracker, Any]]:
    """Return the entitlement controls for a plan slug, or None if missing."""
    if not slug:
        return None
    return _PLANS.get(slug)


def get_plan_entitlements(slug: Optional[str]) -> Optional[Dict[Tracker, Any]]:
    """Alias for `get_plan`. Kept distinct for readability at call sites."""
    if not slug:
        return None
    return _PLANS.get(slug)


def get_plan_description(slug: Optional[str]) -> Optional[str]:
    """Return the operator-facing description for a plan, if any."""
    if not slug:
        return None
    return _PLAN_DESCRIPTIONS.get(slug)


def get_roles(scope: str) -> List[Dict[str, Any]]:
    """Return the effective role catalog for a scope."""
    if scope not in SCOPES:
        return []
    return _ROLES[scope]


def get_role(scope: str, slug: str) -> Optional[Dict[str, Any]]:
    """Return a single role entry within a scope."""
    for entry in get_roles(scope):
        if entry["role"] == slug:
            return entry
    return None


def get_role_permissions(scope: str, slug: str) -> List[str]:
    """Return the permission slugs for a role within a scope."""
    role = get_role(scope, slug)
    if not role:
        return []
    return list(role["permissions"])


def get_role_description(scope: str, slug: str) -> Optional[str]:
    role = get_role(scope, slug)
    if not role:
        return None
    return role.get("description")


def get_controls_hash() -> str:
    """Stable short hash of the effective controls; useful in logs."""
    return _CONTROLS_HASH
