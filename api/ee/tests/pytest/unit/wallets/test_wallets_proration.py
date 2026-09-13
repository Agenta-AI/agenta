"""Unit tests for the pure, DB-free plan-change proration arithmetic in
`ee.src.core.wallets.proration`. No Postgres, no event loop — every case here is plain
integer/datetime math.
"""

import calendar
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
        outgoing_period_start=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        outgoing_period_end=datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc),
        incoming_period_start=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        incoming_period_end=datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc),
        now=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
    )

    assert result.outgoing_debit_amount_musd == 1
    assert result.incoming_credit_amount_musd == 1


def test_prorate_full_allowance_at_period_start():
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=100_000,
        incoming_allowance_musd=200_000,
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
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
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
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
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
        now=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )

    assert result.outgoing_debit_amount_musd == 0
    assert result.incoming_credit_amount_musd == 0


def test_prorate_no_outgoing_credit_id_yields_zero_outgoing_regardless_of_allowance():
    result = compute_plan_change_proration(
        outgoing_credit_id=None,
        outgoing_allowance_musd=100_000,  # nonzero, but nothing to remove it from
        incoming_allowance_musd=200_000,
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
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
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
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
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
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


def test_billing_period_bounds_on_the_clamped_anchor_day_starts_the_new_period():
    """Anchor 31 means the 28th in a (non-leap) February, so on 28 February the CURRENT
    period has already started. Comparing `now.day` against the raw 31 instead returned
    31 January -> 28 February 00:00, a window that ends before `now`."""
    period_start, period_end = billing_period_bounds(
        now=datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc), anchor=31
    )
    assert period_start == datetime(2026, 2, 28, tzinfo=timezone.utc)
    assert period_end == datetime(2026, 3, 31, tzinfo=timezone.utc)


def test_billing_period_bounds_leap_february_clamps_to_the_29th():
    period_start, period_end = billing_period_bounds(
        now=datetime(2028, 2, 29, 6, 30, tzinfo=timezone.utc), anchor=30
    )
    assert period_start == datetime(2028, 2, 29, tzinfo=timezone.utc)
    assert period_end == datetime(2028, 3, 30, tzinfo=timezone.utc)


def test_billing_period_bounds_always_contain_now():
    """The window this function returns is the one CONTAINING `now`, for every anchor and
    every day of every month — `period_start <= now < period_end`. A window ending before
    `now` gives `compute_plan_change_proration` a non-positive remainder, which silently
    prorates the outgoing plan's whole allowance away."""
    for anchor in range(1, 32):
        for month in range(1, 13):
            for day in (1, 15, 28, calendar.monthrange(2026, month)[1]):
                now = datetime(2026, month, day, 12, 0, tzinfo=timezone.utc)
                period_start, period_end = billing_period_bounds(now=now, anchor=anchor)
                assert period_start <= now < period_end, (
                    f"anchor={anchor} now={now.isoformat()} "
                    f"window={period_start.isoformat()}..{period_end.isoformat()}"
                )


def test_month_end_anchor_prorates_the_remaining_period_not_zero():
    """The defect end to end: on 28 February 12:00 with anchor 31, a plan change must
    prorate over the 31 days and 12 hours still left in the period that just started —
    not over a window that already closed, which yields nothing at all."""
    now = datetime(2026, 2, 28, 12, 0, tzinfo=timezone.utc)
    period_start, period_end = billing_period_bounds(now=now, anchor=31)

    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=100_000,
        incoming_allowance_musd=200_000,
        outgoing_period_start=period_start,
        outgoing_period_end=period_end,
        incoming_period_start=period_start,
        incoming_period_end=period_end,
        now=now,
    )

    # 28 Feb 00:00 -> 31 Mar 00:00 is 31 days; 12 hours of it are already spent.
    total_seconds = 31 * 86_400
    remaining_seconds = total_seconds - 43_200
    assert total_seconds == 2_678_400
    assert remaining_seconds == 2_635_200
    assert result.outgoing_debit_amount_musd == (
        100_000 * remaining_seconds // total_seconds
    )
    assert result.outgoing_debit_amount_musd == 98_387
    assert result.incoming_credit_amount_musd == 196_774
    assert result.general_balance_delta == 98_387


# The anchor moved: the old subscription billed on the 15th, the new one bills on the
# 14th (Stripe's `billing_cycle_anchor` on the new subscription), and the change lands on
# 14 March 12:00.
OUTGOING_WINDOW = (
    datetime(2026, 2, 15, tzinfo=timezone.utc),
    datetime(2026, 3, 15, tzinfo=timezone.utc),  # 28 days = 2_419_200 seconds
)
INCOMING_WINDOW = (
    datetime(2026, 3, 14, tzinfo=timezone.utc),
    datetime(2026, 4, 14, tzinfo=timezone.utc),  # 31 days = 2_678_400 seconds
)
ANCHOR_MOVE_NOW = datetime(2026, 3, 14, 12, 0, tzinfo=timezone.utc)


def test_each_side_prorates_over_its_own_window_when_the_anchor_moves():
    """Each allowance is prorated over the period it belongs to: the outgoing remainder
    over the period it was GRANTED for (12 hours left of 28 days), the incoming share over
    the period it will COVER (30 days 12 hours of 31). Sharing the outgoing window would
    have sized the incoming $50 grant at 892_857 musd — a fiftieth of what the customer
    just started paying for."""
    result = compute_plan_change_proration(
        outgoing_credit_id=uuid4(),
        outgoing_allowance_musd=5_000_000,  # $5/period, the outgoing plan
        incoming_allowance_musd=50_000_000,  # $50/period, the incoming plan
        outgoing_period_start=OUTGOING_WINDOW[0],
        outgoing_period_end=OUTGOING_WINDOW[1],
        incoming_period_start=INCOMING_WINDOW[0],
        incoming_period_end=INCOMING_WINDOW[1],
        now=ANCHOR_MOVE_NOW,
    )

    assert (
        result.outgoing_debit_amount_musd == 89_285
    )  # 5_000_000 * 43_200 // 2_419_200
    assert (
        result.incoming_credit_amount_musd == 49_193_548
    )  # 50_000_000 * 2_635_200 // 2_678_400
    assert result.general_balance_delta == 49_193_548 - 89_285


def test_identical_windows_are_exactly_the_single_window_arithmetic():
    """The invariant that keeps the split safe: when the anchor does not move — every
    `SUBSCRIPTION_SWITCHED`, which never touches it — both sides see the same window and
    the result is the same as before the split."""
    shared = compute_plan_change_proration(
        outgoing_credit_id=None,
        outgoing_allowance_musd=5_000_000,
        incoming_allowance_musd=50_000_000,
        outgoing_period_start=PERIOD_START,
        outgoing_period_end=PERIOD_END,
        incoming_period_start=PERIOD_START,
        incoming_period_end=PERIOD_END,
        now=datetime(2026, 1, 16, tzinfo=timezone.utc),
    )

    # 16 of the 31 days remain: 1_382_400 of 2_678_400 seconds, both sides.
    assert shared.incoming_credit_amount_musd == 50_000_000 * 1_382_400 // 2_678_400
    assert shared.incoming_credit_amount_musd == 25_806_451
    assert (
        shared.outgoing_debit_amount_musd == 0
    )  # no outgoing credit to claw back from
    assert shared.general_balance_delta == 25_806_451
