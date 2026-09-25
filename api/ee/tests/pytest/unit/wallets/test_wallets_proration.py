"""Unit tests for the pure, DB-free plan-change proration arithmetic in
`ee.src.core.wallets.proration`. No Postgres, no event loop — every case here is plain
integer/datetime math.
"""

from datetime import datetime, timezone

from ee.src.core.wallets.proration import (
    prorate_incoming_allowance,
    prorate_outgoing_allowance,
)

PERIOD_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 2, 1, tzinfo=timezone.utc)  # 31 days = 2_678_400 seconds


def test_prorate_rounds_down_at_the_fraction_boundary():
    """Rounding boundary: total=2s, remaining=1s (exactly half), amount=3musd.
    3 * 1 // 2 == 1, not 1.5 or 2 — floor division truncates toward zero, the ONE
    rounding point (`_prorate` in proration.py), on both sides."""
    start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 1, 1, 0, 0, 2, tzinfo=timezone.utc)
    now = datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc)

    assert (
        prorate_incoming_allowance(
            allowance_musd=3, period_start=start, period_end=end, now=now
        )
        == 1
    )
    assert (
        prorate_outgoing_allowance(
            credit_amount_musd=3, credit_start_time=start, credit_end_time=end, now=now
        )
        == 1
    )


def test_incoming_full_allowance_at_period_start():
    assert (
        prorate_incoming_allowance(
            allowance_musd=200_000,
            period_start=PERIOD_START,
            period_end=PERIOD_END,
            now=PERIOD_START,
        )
        == 200_000
    )


def test_incoming_zero_at_or_after_period_end():
    for now in (PERIOD_END, datetime(2026, 3, 1, tzinfo=timezone.utc)):
        assert (
            prorate_incoming_allowance(
                allowance_musd=200_000,
                period_start=PERIOD_START,
                period_end=PERIOD_END,
                now=now,
            )
            == 0
        )


def test_incoming_is_prorated_from_the_real_period_start_not_midnight():
    """Stripe periods start at the second the subscription started, not at midnight. A
    subscription created at 15:00 and applied at 15:00 gets its full allowance; the old
    midnight reconstruction took 15 hours off it before the customer had used anything."""
    start = datetime(2026, 3, 14, 15, 0, tzinfo=timezone.utc)
    end = datetime(2026, 4, 14, 15, 0, tzinfo=timezone.utc)

    assert (
        prorate_incoming_allowance(
            allowance_musd=5_000_000, period_start=start, period_end=end, now=start
        )
        == 5_000_000
    )


def test_incoming_mid_period():
    # 31-day period, exactly 10 days remaining.
    assert (
        prorate_incoming_allowance(
            allowance_musd=620_000,
            period_start=PERIOD_START,
            period_end=PERIOD_END,
            now=datetime(2026, 1, 22, tzinfo=timezone.utc),
        )
        == 200_000
    )


def test_outgoing_prorates_the_credit_over_its_own_lifetime():
    """A credit minted on 11 January for the rest of the period carries 21 days of
    allowance. Ten days before its end, half-ish of it is unused: 10/21 of its own
    amount, which equals 10/31 of the plan's full-period allowance."""
    minted_at = datetime(2026, 1, 11, tzinfo=timezone.utc)
    full_allowance = 310_000  # 10_000/day over 31 days
    credit_amount = prorate_incoming_allowance(
        allowance_musd=full_allowance,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        now=minted_at,
    )
    assert credit_amount == 210_000

    clawed = prorate_outgoing_allowance(
        credit_amount_musd=credit_amount,
        credit_start_time=minted_at,
        credit_end_time=PERIOD_END,
        now=datetime(2026, 1, 22, tzinfo=timezone.utc),
    )

    assert clawed == 100_000  # 10 remaining days of 10_000/day


def test_outgoing_is_zero_once_the_credit_expired():
    assert (
        prorate_outgoing_allowance(
            credit_amount_musd=100_000,
            credit_start_time=PERIOD_START,
            credit_end_time=PERIOD_END,
            now=datetime(2026, 3, 1, tzinfo=timezone.utc),
        )
        == 0
    )


def test_outgoing_before_the_credit_started_claws_at_most_its_whole_amount():
    assert (
        prorate_outgoing_allowance(
            credit_amount_musd=100_000,
            credit_start_time=PERIOD_START,
            credit_end_time=PERIOD_END,
            now=datetime(2025, 12, 1, tzinfo=timezone.utc),
        )
        == 100_000
    )


def test_outgoing_without_bounds_has_nothing_to_prorate():
    assert (
        prorate_outgoing_allowance(
            credit_amount_musd=100_000,
            credit_start_time=None,
            credit_end_time=PERIOD_END,
            now=PERIOD_START,
        )
        == 0
    )
