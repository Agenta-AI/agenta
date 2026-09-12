"""Unit tests for the pure, DB-free plan-change proration arithmetic in
`ee.src.core.wallets.proration`. No Postgres, no event loop — every case here is plain
integer/datetime math.
"""

from datetime import datetime, timezone
from uuid import uuid4

from ee.src.core.wallets.proration import (
    billing_period_bounds,
    compute_plan_change_proration,
)

PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)  # 31 days = 2_678_400 seconds


def test_prorate_rounds_down_at_the_fraction_boundary():
    """Rounding boundary: total=2s, remaining=1s (exactly half), amount=3musd.
    3 * 1 // 2 == 1, not 1.5 or 2 — floor division truncates toward zero, the ONE
    rounding point (`_prorate` in proration.py)."""
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=3,
        incoming_allowance_musd=3,
        period_start=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        period_end=datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc),
        now=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
    )

    assert result.outgoing_debit_amount_musd == 1
    assert result.incoming_credit_amount_musd == 1


def test_prorate_full_allowance_at_period_start():
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=100_000,
        incoming_allowance_musd=200_000,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=PERIOD_START,
    )

    assert result.outgoing_debit_amount_musd == 100_000
    assert result.incoming_credit_amount_musd == 200_000
    assert result.general_balance_delta == 100_000


def test_prorate_zero_at_or_after_period_end():
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=100_000,
        incoming_allowance_musd=200_000,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=PERIOD_END,
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0
    assert result.general_balance_delta == 0


def test_prorate_now_past_period_end_clamps_to_zero_not_negative():
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=100_000,
        incoming_allowance_musd=200_000,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0


def test_prorate_no_outgoing_credit_id_yields_zero_outgoing_regardless_of_allowance():
    result = compute_plan_change_proration(
        outgoing_credit_id=None,
        outgoing_allowance_musd=100_000,  # nonzero, but nothing to remove it from
        incoming_allowance_musd=200_000,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=PERIOD_START,
    )

    assert result.outgoing_credit_id is None
    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 200_000


def test_prorate_zero_allowance_mapping_moves_zero_value_same_code_path():
    """Today's product-undefined mapping (`plans.py`) is a constant 0 for every plan.
    That must exercise the exact same arithmetic and simply produce zero amounts — not a
    special branch keyed on plan identity."""
    credit_id = uuid4()
    result = compute_plan_change_proration(
        outgoing_credit_id=credit_id,
        outgoing_allowance_musd=0,
        incoming_allowance_musd=0,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=datetime(2026, 1, 16, tzinfo=timezone.utc),
    )

    assert result.outgoing_credit_id == credit_id  # the lookup still ran
    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0
    assert result.general_balance_delta == 0


def test_prorate_mid_period_general_balance_delta_is_incoming_minus_outgoing():
    # 31-day period, exactly 10 days remaining.
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=310_000,  # 10_000/day
        incoming_allowance_musd=620_000,  # 20_000/day
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),  # 10 days before period_end
    )

    assert result.outgoing_debit_amount_musd == 100_000  # 10 * 10_000
    assert result.incoming_credit_amount_musd == 200_000  # 10 * 20_000
    assert result.general_balance_delta == 100_000


def test_billing_period_bounds_natural_calendar_month_when_anchor_none():
    period_start, period_end = billing_period_bounds(
        now=datetime(2026, 1, 15, tzinfo=timezone.utc), anchor=None
    )
    assert period_start == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 2, 1, tzinfo=timezone.utc)


def test_billing_period_bounds_honors_anchor_day():
    period_start, period_end = billing_period_bounds(
        now=datetime(2026, 1, 20, tzinfo=timezone.utc), anchor=15
    )
    assert period_start == datetime(2026, 1, 15, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 2, 15, tzinfo=timezone.utc)


def test_billing_period_bounds_before_anchor_day_uses_previous_month():
    period_start, period_end = billing_period_bounds(
        now=datetime(2026, 1, 10, tzinfo=timezone.utc), anchor=15
    )
    assert period_start == datetime(2025, 12, 15, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 1, 15, tzinfo=timezone.utc)


def test_billing_period_bounds_clamps_anchor_to_short_month():
    # now.day(20) < anchor(31): the window started on the anchor day of the PREVIOUS
    # month (Jan 31) and ends on the anchor day of the current month, clamped to
    # February's 28 days in 2026 (not a leap year).
    period_start, period_end = billing_period_bounds(
        now=datetime(2026, 2, 20, tzinfo=timezone.utc), anchor=31
    )
    assert period_start == datetime(2026, 1, 31, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 2, 28, tzinfo=timezone.utc)
