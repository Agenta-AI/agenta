"""Regression net for `period_from`.

`period_from(period=..., anchor=...)` builds a `MeterPeriod` for the
current moment at the requested granularity. `monthly_period_from` is
tested separately under `tests/manual/test_billing_period.py`; this file
exercises the wrapper that picks the right `MeterPeriod` shape per
`Period` enum value, plus the calendar-validation handoff to
`MeterPeriod`.

These tests don't pin absolute calendar values (the helper reads
`datetime.now`) — they assert shape and the relationship between the
returned `MeterPeriod` fields and the current moment / a frozen `now`
via patching.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from ee.src.core.entitlements.types import Period
from ee.src.core.meters.types import MeterPeriod
from ee.src.utils.entitlements import period_from


# ---------------------------------------------------------------------------
# Period.None → empty MeterPeriod (gauge — non-periodic).
# ---------------------------------------------------------------------------


def test_period_none_returns_empty_meter_period():
    """`period=None` is the "gauge" / non-periodic case. All three
    components must be None so the canonicalizer excludes them."""
    p = period_from(period=None)
    assert isinstance(p, MeterPeriod)
    assert p.year is None
    assert p.month is None
    assert p.day is None


# ---------------------------------------------------------------------------
# Period.YEARLY → only year set.
# ---------------------------------------------------------------------------


def test_period_yearly_sets_only_year():
    """YEARLY buckets the meter by year. Month/day must stay None so
    every row in the same year shares a `meter_id`."""
    fake_now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.YEARLY)

    assert p.year == 2026
    assert p.month is None
    assert p.day is None


# ---------------------------------------------------------------------------
# Period.MONTHLY → year + month, honors anchor.
# ---------------------------------------------------------------------------


def test_period_monthly_sets_year_and_month_without_anchor():
    """MONTHLY without an anchor returns the calendar (year, month)."""
    fake_now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.MONTHLY)

    assert (p.year, p.month) == (2026, 5)
    assert p.day is None


def test_period_monthly_advances_when_day_meets_anchor():
    """MONTHLY with `anchor=N` and `now.day >= N` rolls into next month
    — Stripe-style anchor semantics. Day=18, anchor=15 advances to June."""
    fake_now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.MONTHLY, anchor=15)

    assert (p.year, p.month) == (2026, 6)
    assert p.day is None


def test_period_monthly_stays_when_day_before_anchor():
    """MONTHLY with `now.day < anchor` stays in the current period."""
    fake_now = datetime(2026, 5, 10, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.MONTHLY, anchor=15)

    assert (p.year, p.month) == (2026, 5)
    assert p.day is None


def test_period_monthly_year_rollover_with_anchor():
    """Dec 20 + anchor=15 → next period is (2027, 1)."""
    fake_now = datetime(2026, 12, 20, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.MONTHLY, anchor=15)

    assert (p.year, p.month) == (2027, 1)


# ---------------------------------------------------------------------------
# Period.DAILY → full year/month/day. Anchor is ignored.
# ---------------------------------------------------------------------------


def test_period_daily_sets_full_calendar_date():
    """DAILY buckets the meter by full calendar day."""
    fake_now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p = period_from(period=Period.DAILY)

    assert (p.year, p.month, p.day) == (2026, 5, 18)


def test_period_daily_ignores_anchor():
    """DAILY is calendar-day-aligned; anchor only applies to MONTHLY.
    Same input with and without an anchor must produce the same bucket."""
    fake_now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=timezone.utc)
    with patch("ee.src.utils.entitlements.datetime") as mock_dt:
        mock_dt.now.return_value = fake_now
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)
        p_without = period_from(period=Period.DAILY)
        p_with = period_from(period=Period.DAILY, anchor=15)

    assert p_without == p_with


# ---------------------------------------------------------------------------
# Calendar validity is enforced by MeterPeriod (regression for the
# Feb-30-style invalid-date check).
# ---------------------------------------------------------------------------


def test_period_daily_constructs_valid_date():
    """`period_from(Period.DAILY)` reads `datetime.now()`, which is
    inherently a valid date. The MeterPeriod calendar validator must
    accept it. (Manual invalid-date construction is covered in
    `test_compute_meter_id.py`.)"""
    p = period_from(period=Period.DAILY)
    # If we got here, the MeterPeriod validator did not raise.
    assert p.year is not None and p.month is not None and p.day is not None


# ---------------------------------------------------------------------------
# Parametric: every Period maps to a consistent MeterPeriod shape.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "period, expected_set",
    [
        (None, set()),
        (Period.YEARLY, {"year"}),
        (Period.MONTHLY, {"year", "month"}),
        (Period.DAILY, {"year", "month", "day"}),
    ],
)
def test_period_shape_matches_granularity(period, expected_set):
    """Each period kind must populate exactly the fields its granularity
    implies — nothing more, nothing less. The canonicalizer relies on
    None-equals-not-applicable to keep meter identity additive."""
    p = period_from(period=period)
    actually_set = {
        name for name in ("year", "month", "day") if getattr(p, name) is not None
    }
    assert actually_set == expected_set
