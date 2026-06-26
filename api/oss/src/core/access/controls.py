"""Access controls: the role surface (composition root for roles).

Builds — once, at import time — the effective per-scope role catalog from the
domain builder `oss.src.core.access.permissions.controls.build_role_controls`,
and exposes the public `get_role*` accessors plus a stable `controls_hash`.

The role domain `controls.py` is a pure builder/parser with no module-level
state; this module owns the singleton.

EE composes plans on top of these roles in `ee.src.core.access.controls`, which
re-exports the `get_role*` accessors from here.
"""

import hashlib
from json import dumps
from typing import Any, Dict, List, Optional

from oss.src.utils.logging import get_module_logger

from oss.src.core.access.permissions.controls import build_role_controls, SCOPES


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Effective controls (built once at import time)
# ---------------------------------------------------------------------------


def _build_controls() -> tuple[Dict[str, List[Dict[str, Any]]], str]:
    roles, role_source = build_role_controls()

    payload = dumps(
        {
            "roles": {
                scope: [
                    {"role": r["role"], "permissions": sorted(r.get("permissions", []))}
                    for r in roles[scope]
                ]
                for scope in SCOPES
            }
        },
        sort_keys=True,
        default=str,
    )
    controls_hash = hashlib.sha256(payload.encode()).hexdigest()[:12]

    log.info("[access-controls] %s hash=%s", role_source, controls_hash)

    return roles, controls_hash


_ROLES, _CONTROLS_HASH = _build_controls()


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
    """Stable short hash of the effective role controls; useful in logs."""
    return _CONTROLS_HASH
