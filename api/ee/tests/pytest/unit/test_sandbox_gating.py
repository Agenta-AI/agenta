"""Unit tests for ee.src.core.sandboxes.gating.

These tests mock `check_entitlements` / `is_ee` so no live DB or Redis is
needed. The goal is to pin the logic that:

- `check_sandbox_quota` returns (False, reason) when the entitlements check
  is denied, and (True, None) when allowed.
- `check_sandbox_credits_true_up` returns False when SANDBOX_CREDITS is
  over-quota, True when within quota.
- Both functions fail open (return allowed=True) on unexpected exceptions.
- SANDBOX_CREDITS is the only sandbox meter reported to Stripe.
"""

import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4


_ORG_ID = uuid4()


@pytest.mark.asyncio
async def test_check_sandbox_quota_allowed():
    """Layer 1: entitlements returns True -> quota check passes."""
    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_quota_ee",
            new_callable=AsyncMock,
            return_value=(True, None),
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_quota

        allowed, reason = await check_sandbox_quota(organization_id=_ORG_ID)

    assert allowed is True
    assert reason is None


@pytest.mark.asyncio
async def test_check_sandbox_quota_denied():
    """Layer 1: entitlements returns False -> quota check blocks."""
    msg = "You have reached your sandbox usage quota for this billing period."

    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_quota_ee",
            new_callable=AsyncMock,
            return_value=(False, msg),
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_quota

        allowed, reason = await check_sandbox_quota(organization_id=_ORG_ID)

    assert allowed is False
    assert reason == msg


@pytest.mark.asyncio
async def test_check_sandbox_quota_fails_open():
    """Layer 1: unexpected error -> fail open (True, None)."""
    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_quota_ee",
            new_callable=AsyncMock,
            side_effect=RuntimeError("redis down"),
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_quota

        allowed, reason = await check_sandbox_quota(organization_id=_ORG_ID)

    assert allowed is True
    assert reason is None


@pytest.mark.asyncio
async def test_check_sandbox_quota_oss_passthrough():
    """Non-EE deployments always get (True, None)."""
    with patch("ee.src.core.sandboxes.gating.is_ee", return_value=False):
        from ee.src.core.sandboxes.gating import check_sandbox_quota

        allowed, reason = await check_sandbox_quota(organization_id=_ORG_ID)

    assert allowed is True
    assert reason is None


@pytest.mark.asyncio
async def test_true_up_within_quota():
    """Layer 2: within quota -> returns True."""
    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_credits_true_up_ee",
            new_callable=AsyncMock,
            return_value=True,
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_credits_true_up

        result = await check_sandbox_credits_true_up(organization_id=_ORG_ID)

    assert result is True


@pytest.mark.asyncio
async def test_true_up_over_quota():
    """Layer 2: over quota -> returns False."""
    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_credits_true_up_ee",
            new_callable=AsyncMock,
            return_value=False,
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_credits_true_up

        result = await check_sandbox_credits_true_up(organization_id=_ORG_ID)

    assert result is False


@pytest.mark.asyncio
async def test_true_up_fails_open():
    """Layer 2: unexpected error -> fail open (True)."""
    with (
        patch("ee.src.core.sandboxes.gating.is_ee", return_value=True),
        patch(
            "ee.src.core.sandboxes.gating._check_sandbox_credits_true_up_ee",
            new_callable=AsyncMock,
            side_effect=ConnectionError("db unreachable"),
        ),
    ):
        from ee.src.core.sandboxes.gating import check_sandbox_credits_true_up

        result = await check_sandbox_credits_true_up(organization_id=_ORG_ID)

    assert result is True


@pytest.mark.asyncio
async def test_true_up_oss_passthrough():
    """Non-EE deployments always get True."""
    with patch("ee.src.core.sandboxes.gating.is_ee", return_value=False):
        from ee.src.core.sandboxes.gating import check_sandbox_credits_true_up

        result = await check_sandbox_credits_true_up(organization_id=_ORG_ID)

    assert result is True


def test_sandbox_credit_counter_values():
    """Confirm the credit Counter slugs match the Meters enum values."""
    from ee.src.core.access.entitlements.types import Counter
    from ee.src.core.meters.types import Meters

    assert Meters["SANDBOX_CPU_CREDITS"].value == Counter.SANDBOX_CPU_CREDITS.value
    assert Meters["SANDBOX_RAM_CREDITS"].value == Counter.SANDBOX_RAM_CREDITS.value
    assert Meters["SANDBOX_SSD_CREDITS"].value == Counter.SANDBOX_SSD_CREDITS.value
    assert Meters["SANDBOX_GPU_CREDITS"].value == Counter.SANDBOX_GPU_CREDITS.value
    assert Meters["SANDBOX_CREDITS"].value == Counter.SANDBOX_CREDITS.value


def test_sandbox_credits_in_reports():
    """SANDBOX_CREDITS must be in REPORTS; nothing else sandbox-related is."""
    from ee.src.core.access.entitlements.types import Counter, REPORTS

    assert Counter.SANDBOX_CREDITS.value in REPORTS
    assert REPORTS[Counter.SANDBOX_CREDITS.value] == "sandbox_credits"

    assert Counter.SANDBOX_CPU_SECONDS.value not in REPORTS
    assert Counter.SANDBOX_RAM_SECONDS.value not in REPORTS
    assert Counter.SANDBOX_SSD_SECONDS.value not in REPORTS
    assert Counter.SANDBOX_GPU_SECONDS.value not in REPORTS
    assert Counter.SANDBOX_CPU_CREDITS.value not in REPORTS
    assert Counter.SANDBOX_RAM_CREDITS.value not in REPORTS
    assert Counter.SANDBOX_SSD_CREDITS.value not in REPORTS
    assert Counter.SANDBOX_GPU_CREDITS.value not in REPORTS


def test_sandbox_credit_counters_in_read_only_constraint():
    """All sandbox credit counters must be in CONSTRAINTS[READ_ONLY][COUNTERS]."""
    from ee.src.core.access.entitlements.types import (
        Counter,
        CONSTRAINTS,
        Constraint,
        Tracker,
    )

    read_only_counters = CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]
    for counter in (
        Counter.SANDBOX_CPU_CREDITS,
        Counter.SANDBOX_RAM_CREDITS,
        Counter.SANDBOX_SSD_CREDITS,
        Counter.SANDBOX_GPU_CREDITS,
        Counter.SANDBOX_CREDITS,
    ):
        assert counter in read_only_counters, f"{counter} missing from READ_ONLY"


def test_all_plans_have_sandbox_credit_quotas():
    """Every default plan must carry a Quota for all 5 credit counters."""
    from ee.src.core.access.entitlements.types import (
        Counter,
        DEFAULT_ENTITLEMENTS,
        Tracker,
    )

    for plan, entitlements in DEFAULT_ENTITLEMENTS.items():
        counters = entitlements[Tracker.COUNTERS]
        for counter in (
            Counter.SANDBOX_CPU_CREDITS,
            Counter.SANDBOX_RAM_CREDITS,
            Counter.SANDBOX_SSD_CREDITS,
            Counter.SANDBOX_GPU_CREDITS,
            Counter.SANDBOX_CREDITS,
        ):
            assert counter in counters, f"{plan}: missing {counter}"
