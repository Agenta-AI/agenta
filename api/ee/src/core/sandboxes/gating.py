"""Sandbox entitlement gating: create-time quota check (Layer 1) and
post-hoc true-up (Layer 2), both against the single billed meter
SANDBOX_CREDITS.

Two-layer design mirrors the existing tracing entitlements pattern:

Layer 1 (create-time soft pre-check)
    `check_sandbox_quota()` -- called before launching a sandbox. Uses the
    Redis-cached SANDBOX_CREDITS value (`cache=True`) plus an in-flight
    accrual estimate (converted via `credits.to_credits`) so the org does not
    exceed its quota the moment a new sandbox starts. Fails open: any
    infrastructure error allows the launch and logs a warning.

Layer 2 (post-hoc true-up)
    `check_sandbox_credits_true_up()` -- called after
    `SandboxMeteringService.record_usage()` has adjusted the raw *_seconds
    and *_credits meters (see sink.py). Re-checks SANDBOX_CREDITS
    (`cache=False`, delta=0 -- a read-only true-up, the write already
    happened in the sink) and returns whether the org is within quota.

Layer 2b (mid-session kill -- stub, deferred)
    When `check_sandbox_credits_true_up()` returns `False` the caller should
    kill the active sandbox session. The `DELETE /sessions/streams/{id}` +
    runner `/kill` endpoint is not yet implemented; until it is, a WARNING
    log is the only action taken. See docs/designs/sandbox-metering/tasks.md.

RBAC (RUN_SESSIONS permission) is strictly separate from entitlement checks.
This module only concerns itself with quota; callers must enforce RBAC
before invoking either function here.
"""

from decimal import Decimal
from typing import Optional
from uuid import UUID

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

from ee.src.core.sandboxes.credits import Dimension, to_credits

log = get_module_logger(__name__)


async def check_sandbox_quota(
    *,
    organization_id: UUID,
    provider: str = "e2b",
) -> tuple[bool, Optional[str]]:
    """Layer 1: create-time soft pre-check.

    Fetches the cached meter value for `SANDBOX_CREDITS` and adds an
    estimated in-flight accrual (CPU-dimension credits for
    `env.sandbox.estimated_vcpu` vCPUs over `env.sandbox.estimated_run_seconds`
    seconds) before comparing against the plan quota.

    Args:
        organization_id: The org that will own the new sandbox.
        provider: Provider slug the new sandbox will launch on; selects the
            rate table for the accrual estimate.

    Returns:
        ``(allowed, reason)`` where ``allowed=False`` means the org is
        at or over quota. ``reason`` is a human-readable string for
        HTTP 429 responses; ``None`` when allowed.

    Fail-open: any error except `EntitlementsException` returns
    ``(True, None)`` and logs a warning so infra issues never block
    sandbox creation.
    """
    if not is_ee():
        return True, None

    try:
        return await _check_sandbox_quota_ee(
            organization_id=organization_id,
            provider=provider,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[sandboxes] check_sandbox_quota failed for org=%s; failing open",
            organization_id,
            exc_info=True,
        )
        return True, None


async def _check_sandbox_quota_ee(
    *,
    organization_id: UUID,
    provider: str,
) -> tuple[bool, Optional[str]]:
    from ee.src.core.access.entitlements.types import Counter
    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        EntitlementsException,
    )
    from ee.src.core.meters.types import MeterScope

    sandbox_cfg = env.sandbox
    estimated_accrual_seconds = Decimal(
        sandbox_cfg.estimated_vcpu * sandbox_cfg.estimated_run_seconds
    )
    estimated_credits = to_credits(
        provider=provider,
        dimension=Dimension.CPU,
        raw_units=estimated_accrual_seconds,
    )
    estimated_millicredits = int(estimated_credits * Decimal("1000"))

    meter_scope = MeterScope(organization_id=organization_id)

    try:
        allowed, _, _ = await check_entitlements(
            key=Counter.SANDBOX_CREDITS,
            delta=estimated_millicredits,
            cache=True,
            scope=meter_scope,
        )
    except EntitlementsException:
        # Config / programming bug -- propagate so it surfaces clearly.
        raise

    if not allowed:
        return False, (
            "You have reached your sandbox usage quota for this billing period. "
            "Please upgrade your plan or wait for the quota to reset."
        )

    return True, None


async def check_sandbox_credits_true_up(
    *,
    organization_id: UUID,
) -> bool:
    """Layer 2: post-hoc true-up against SANDBOX_CREDITS.

    Call after `SandboxMeteringService.record_usage()` (which already wrote
    the meters via sink.py) to check whether the org is now over quota.
    `delta=0` -- this is a read/check, not a write; the authoritative
    adjust() already happened in the sink.

    Returns ``True`` when within quota, ``False`` when over. A ``False``
    return should trigger a sandbox kill (Layer 2b), but the kill endpoint
    is not yet implemented -- a WARNING is logged and the caller should
    treat this as a known gap.

    Fails open on infrastructure errors (non-`EntitlementsException`
    exceptions).
    """
    if not is_ee():
        return True

    try:
        return await _check_sandbox_credits_true_up_ee(organization_id=organization_id)
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[sandboxes] check_sandbox_credits_true_up failed for org=%s; failing open",
            organization_id,
            exc_info=True,
        )
        return True


async def _check_sandbox_credits_true_up_ee(
    *,
    organization_id: UUID,
) -> bool:
    from ee.src.core.access.entitlements.types import Counter
    from ee.src.core.access.entitlements.service import check_entitlements
    from ee.src.core.meters.types import MeterScope

    meter_scope = MeterScope(organization_id=organization_id)

    allowed, _, _ = await check_entitlements(
        key=Counter.SANDBOX_CREDITS,
        delta=0,
        cache=False,
        scope=meter_scope,
    )

    if not allowed:
        log.warning(
            "[sandboxes] over-quota org=%s counter=%s "
            "-- kill endpoint not yet implemented; skipping sandbox termination",
            organization_id,
            Counter.SANDBOX_CREDITS.value,
        )

    return allowed
