"""Access controls (EE): the plan/entitlement surface.

This is the EE composition root for the plan catalog. It builds — once, at import
time — the effective plan state from `build_plan_controls` and exposes the public
`get_plan*` accessors plus a stable `controls_hash`.

The role surface moved to OSS (`oss.src.core.access.controls`); the `get_role*`
accessors are re-exported from there so existing EE imports keep working.

Code defaults live in the domain `types.py` modules; env overrides come from
`AGENTA_ACCESS_PLANS` and `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` (raw JSON exposed
via `env.agenta.access`).
"""

import hashlib
from json import dumps
from typing import Any, Dict, Optional

from oss.src.utils.logging import get_module_logger

from oss.src.core.access.controls import (  # noqa: F401 — role surface re-exported from OSS
    get_roles,
    get_role,
    get_role_permissions,
    get_role_description,
)

from ee.src.core.access.entitlements.types import Tracker
from ee.src.core.access.entitlements.controls import build_plan_controls


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Effective controls (built once at import time)
# ---------------------------------------------------------------------------


def _build_controls() -> tuple[
    Dict[str, Dict[Tracker, Any]],
    Dict[str, str],
    str,
]:
    plans, descriptions, plan_source = build_plan_controls()

    payload = dumps(
        {"plans": sorted(plans.keys()), "descriptions": descriptions},
        sort_keys=True,
        default=str,
    )
    controls_hash = hashlib.sha256(payload.encode()).hexdigest()[:12]

    log.info("[access-controls] %s hash=%s", plan_source, controls_hash)

    return plans, descriptions, controls_hash


_PLANS, _PLAN_DESCRIPTIONS, _CONTROLS_HASH = _build_controls()


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
# Utility
# ---------------------------------------------------------------------------


def get_controls_hash() -> str:
    """Stable short hash of the effective plan controls; useful in logs."""
    return _CONTROLS_HASH
