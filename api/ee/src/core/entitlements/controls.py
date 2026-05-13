"""Access controls: effective plan/role accessors built from code defaults or env overrides.

This module is the single runtime source of truth for:

- the effective plan slug set;
- per-plan entitlement controls (flags, counters, gauges, throttles);
- per-scope role catalogs (organization, workspace, project).

Code defaults live in `types.py` and `ee.src.models.shared_models`. Environment
overrides come from `AGENTA_ACCESS_PLANS` and `AGENTA_ACCESS_ROLES` (raw JSON
strings exposed via `env.access_controls`). Parsing happens once at import time.
"""

import hashlib
from json import dumps
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import (
    Counter,
    DEFAULT_ENTITLEMENTS,
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

        if not plan_entry:
            raise ValueError(
                f"AGENTA_ACCESS_PLANS['{slug}'] must define at least one of: "
                "flags, counters, gauges, throttles"
            )

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
    """Read-only permission set sourced from the legacy `WorkspaceRole.VIEWER`.

    Used as the `viewer` minima permissions for the `workspace` and `project`
    scopes where permissions are actually enforced. Organization-scope `viewer`
    has no permissions (it's just a membership marker today).
    """
    return [p.value for p in Permission.default_permissions(WorkspaceRole.VIEWER)]


def _viewer_permissions_for_scope(scope: str) -> List[str]:
    """Per-scope code-default permissions for the `viewer` minima role.

    - `organization`: empty — orgs have no permission concept today.
    - `workspace` and `project`: the legacy `WorkspaceRole.VIEWER` read-only set.
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

    Workspace exposes the historical `WorkspaceRole` enum entries on top of
    the minima for backward compatibility with existing UIs. Organization and
    project scopes only get the minima today; new roles can be added per-scope
    via `AGENTA_ACCESS_ROLES`.
    """
    workspace_extras: List[Dict[str, Any]] = []
    minima_slugs = {DefaultRole.OWNER.value, DefaultRole.VIEWER.value}
    for role in WorkspaceRole:
        if role.value in minima_slugs:
            continue
        workspace_extras.append(
            {
                "role": role.value,
                "description": WorkspaceRole.get_description(role),
                "permissions": [p.value for p in Permission.default_permissions(role)],
            }
        )

    return {
        "organization": _minima_for("organization"),
        "workspace": _minima_for("workspace") + workspace_extras,
        "project": _minima_for("project"),
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

    return result


# ---------------------------------------------------------------------------
# Effective controls (built once at import time)
# ---------------------------------------------------------------------------


def _build_controls() -> tuple[
    Dict[str, Dict[Tracker, Any]],
    Dict[str, str],
    Dict[str, List[Dict[str, Any]]],
    str,
]:
    plans_payload = env.access_controls.plans
    roles_payload = env.access_controls.roles

    if plans_payload is not None:
        plans, descriptions = _parse_plans_override(plans_payload)
        plans_source = "env"
    else:
        plans = _default_plans()
        descriptions = dict(_DEFAULT_PLAN_DESCRIPTIONS)
        plans_source = "defaults"

    if roles_payload is not None:
        roles = _parse_roles_override(roles_payload)
        roles_source = "env"
    else:
        roles = _default_roles()
        roles_source = "defaults"

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
        "[access-controls] plans=%s roles=%s hash=%s",
        plans_source,
        roles_source,
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
