"""Access controls: the combined effective plan + role surface.

This is the single runtime source of truth and the composition root for access
controls. It builds — once, at import time — the effective state from the two
domain builders:

- plans/entitlements: `ee.src.core.access.entitlements.controls.build_plan_controls`
- roles/permissions:  `ee.src.core.access.permissions.controls.build_role_controls`

and exposes the public `get_plan*` / `get_role*` accessors plus a stable
`controls_hash`. The domain `controls.py` modules are pure builders/parsers with
no module-level state; this module owns the singleton.

Code defaults live in the domain `types.py` modules; env overrides come from
`AGENTA_ACCESS_PLANS`, `AGENTA_ACCESS_ROLES`, `AGENTA_ACCESS_ROLES_OVERLAY`, and
`AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` (raw JSON exposed via `env.access_controls`).
"""

import hashlib
from json import dumps
from typing import Any, Dict, List, Optional

from oss.src.utils.logging import get_module_logger

from ee.src.core.access.entitlements.types import SCOPES, Tracker
from ee.src.core.access.entitlements.controls import build_plan_controls
from ee.src.core.access.permissions.controls import build_role_controls


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Effective controls (built once at import time)
# ---------------------------------------------------------------------------


def _build_controls() -> tuple[
    Dict[str, Dict[Tracker, Any]],
    Dict[str, str],
    Dict[str, List[Dict[str, Any]]],
    str,
]:
    plans, descriptions, plan_source = build_plan_controls()
    roles, role_source = build_role_controls()

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
        "[access-controls] %s %s hash=%s",
        plan_source,
        role_source,
        controls_hash,
    )

    return plans, descriptions, roles, controls_hash


_PLANS, _PLAN_DESCRIPTIONS, _ROLES, _CONTROLS_HASH = _build_controls()


# ---------------------------------------------------------------------------
# Public accessors — plans
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


# ---------------------------------------------------------------------------
# Public accessors — roles
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def get_controls_hash() -> str:
    """Stable short hash of the effective controls; useful in logs."""
    return _CONTROLS_HASH
