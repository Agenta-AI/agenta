"""
Exhaustive multivariate tests for compute_billing_period().

Tests all combinations of:
- All 12 months
- Various days (1, 14, 15, 28, 29, 30, 31)
- Various anchors (None, 0, 1, 15, 28, 29, 30, 31)
- Edge cases: Feb 28/29 (leap year), months with 30/31 days
"""

import pytest
from datetime import datetime, timezone

from ee.src.utils.billing import compute_billing_period


# ---- Helpers ----


def dt(year: int, month: int, day: int) -> datetime:
    """Create a timezone-aware UTC datetime."""
    return datetime(year, month, day, 12, 0, 0, tzinfo=timezone.utc)


def next_month(year: int, month: int):
    """Return (year, month) for the next month."""
    if month == 12:
        return year + 1, 1
    return year, month + 1


# ---- Core rule tests ----


class TestBillingPeriodBasicRules:
    """Test the three core rules of billing period computation."""

    def test_no_anchor_returns_current_period(self):
        """Rule: If anchor is None/0/falsy, return (now.year, now.month)."""
        for anchor in [None, 0]:
            for month in range(1, 13):
                now = dt(2025, month, 15)
                year, m = compute_billing_period(now=now, anchor=anchor)
                assert (year, m) == (2025, month), (
                    f"anchor={anchor}, month={month}: expected ({2025}, {month}), got ({year}, {m})"
                )

    def test_day_before_anchor_returns_current_period(self):
        """Rule: If now.day < anchor, the period is (now.year, now.month)."""
        now = dt(2025, 6, 10)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 6)

    def test_day_on_anchor_advances_to_next_month(self):
        """Rule: If now.day == anchor, the period advances to the next month."""
        now = dt(2025, 6, 15)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 7)

    def test_day_after_anchor_advances_to_next_month(self):
        """Rule: If now.day > anchor, the period advances to the next month."""
        now = dt(2025, 6, 20)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 7)

    def test_defaults_to_utcnow_when_no_now(self):
        """If now is not provided, should use UTC now."""
        year, month = compute_billing_period(anchor=None)
        now = datetime.now(timezone.utc)
        assert year == now.year
        assert month == now.month


# ---- December / year boundary tests ----


class TestBillingPeriodDecemberBoundary:
    """Test year rollover when current month is December."""

    def test_december_day_before_anchor(self):
        """Dec 10 with anchor=15 -> (2025, 12) (still current period)."""
        now = dt(2025, 12, 10)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 12)

    def test_december_day_on_anchor(self):
        """Dec 15 with anchor=15 -> (2026, 1) (next month = January next year)."""
        now = dt(2025, 12, 15)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2026, 1)

    def test_december_day_after_anchor(self):
        """Dec 20 with anchor=15 -> (2026, 1)."""
        now = dt(2025, 12, 20)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2026, 1)

    def test_december_31_anchor_1(self):
        """Dec 31 with anchor=1 -> (2026, 1)."""
        now = dt(2025, 12, 31)
        year, month = compute_billing_period(now=now, anchor=1)
        assert (year, month) == (2026, 1)

    def test_december_31_anchor_31(self):
        """Dec 31 with anchor=31 -> (2026, 1)."""
        now = dt(2025, 12, 31)
        year, month = compute_billing_period(now=now, anchor=31)
        assert (year, month) == (2026, 1)

    def test_december_1_anchor_1(self):
        """Dec 1 with anchor=1 -> (2026, 1)."""
        now = dt(2025, 12, 1)
        year, month = compute_billing_period(now=now, anchor=1)
        assert (year, month) == (2026, 1)


# ---- November (the month before December) ----


class TestBillingPeriodNovember:
    """Test November to ensure proper transition to December (same year)."""

    def test_november_on_anchor(self):
        """Nov 15 with anchor=15 -> (2025, 12)."""
        now = dt(2025, 11, 15)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 12)

    def test_november_after_anchor(self):
        """Nov 20 with anchor=15 -> (2025, 12)."""
        now = dt(2025, 11, 20)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 12)

    def test_november_before_anchor(self):
        """Nov 10 with anchor=15 -> (2025, 11)."""
        now = dt(2025, 11, 10)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 11)


# ---- February edge cases (28/29 days, anchor > days in month) ----


class TestBillingPeriodFebruary:
    """Test February with anchors that exceed the number of days in February."""

    def test_feb28_non_leap_anchor_30(self):
        """Feb 28 (non-leap) with anchor=30.
        Since anchor=30 > max day in Feb (28), now.day (28) < anchor (30),
        so we stay in current period: (2025, 2).
        """
        now = dt(2025, 2, 28)
        year, month = compute_billing_period(now=now, anchor=30)
        assert (year, month) == (2025, 2)

    def test_feb28_non_leap_anchor_28(self):
        """Feb 28 (non-leap) with anchor=28.
        now.day (28) == anchor (28), so advance: (2025, 3).
        """
        now = dt(2025, 2, 28)
        year, month = compute_billing_period(now=now, anchor=28)
        assert (year, month) == (2025, 3)

    def test_feb28_non_leap_anchor_29(self):
        """Feb 28 (non-leap) with anchor=29.
        now.day (28) < anchor (29), so stay: (2025, 2).
        """
        now = dt(2025, 2, 28)
        year, month = compute_billing_period(now=now, anchor=29)
        assert (year, month) == (2025, 2)

    def test_feb29_leap_anchor_29(self):
        """Feb 29 (leap year) with anchor=29.
        now.day (29) == anchor (29), so advance: (2024, 3).
        """
        now = dt(2024, 2, 29)
        year, month = compute_billing_period(now=now, anchor=29)
        assert (year, month) == (2024, 3)

    def test_feb29_leap_anchor_30(self):
        """Feb 29 (leap year) with anchor=30.
        now.day (29) < anchor (30), so stay: (2024, 2).
        """
        now = dt(2024, 2, 29)
        year, month = compute_billing_period(now=now, anchor=30)
        assert (year, month) == (2024, 2)

    def test_feb29_leap_anchor_28(self):
        """Feb 29 (leap year) with anchor=28.
        now.day (29) >= anchor (28), so advance: (2024, 3).
        """
        now = dt(2024, 2, 29)
        year, month = compute_billing_period(now=now, anchor=28)
        assert (year, month) == (2024, 3)

    def test_feb1_anchor_15(self):
        """Feb 1 with anchor=15 -> (2025, 2)."""
        now = dt(2025, 2, 1)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 2)

    def test_feb15_anchor_15(self):
        """Feb 15 with anchor=15 -> (2025, 3)."""
        now = dt(2025, 2, 15)
        year, month = compute_billing_period(now=now, anchor=15)
        assert (year, month) == (2025, 3)


# ---- Months with 30 days (Apr, Jun, Sep, Nov) ----


class TestBillingPeriod30DayMonths:
    """Test months with 30 days when anchor is 31."""

    def test_april_30_anchor_31(self):
        """Apr 30 with anchor=31.
        now.day (30) < anchor (31), so stay: (2025, 4).
        """
        now = dt(2025, 4, 30)
        year, month = compute_billing_period(now=now, anchor=31)
        assert (year, month) == (2025, 4)

    def test_june_30_anchor_31(self):
        """Jun 30 with anchor=31.
        now.day (30) < anchor (31), so stay: (2025, 6).
        """
        now = dt(2025, 6, 30)
        year, month = compute_billing_period(now=now, anchor=31)
        assert (year, month) == (2025, 6)

    def test_april_30_anchor_30(self):
        """Apr 30 with anchor=30.
        now.day (30) >= anchor (30), so advance: (2025, 5).
        """
        now = dt(2025, 4, 30)
        year, month = compute_billing_period(now=now, anchor=30)
        assert (year, month) == (2025, 5)


# ---- January boundary (anchor=1) ----


class TestBillingPeriodJanuary:
    """Test January with anchor=1 (every day on or after 1st advances)."""

    def test_jan1_anchor_1(self):
        """Jan 1 with anchor=1 -> (2025, 2)."""
        now = dt(2025, 1, 1)
        year, month = compute_billing_period(now=now, anchor=1)
        assert (year, month) == (2025, 2)

    def test_jan31_anchor_1(self):
        """Jan 31 with anchor=1 -> (2025, 2)."""
        now = dt(2025, 1, 31)
        year, month = compute_billing_period(now=now, anchor=1)
        assert (year, month) == (2025, 2)


# ---- Exhaustive multivariate test ----

# All days that exist in at least one month
DAYS = [1, 2, 10, 14, 15, 20, 27, 28, 29, 30, 31]

# Anchors to test (including falsy and boundary values)
ANCHORS = [None, 0, 1, 2, 10, 15, 20, 28, 29, 30, 31]

# Days in each month for non-leap and leap years
import calendar  # noqa: E402


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


class TestBillingPeriodExhaustive:
    """Exhaustive multivariate test across all months, days, and anchors."""

    @pytest.mark.parametrize("year", [2024, 2025])  # 2024 is leap year
    @pytest.mark.parametrize("month", range(1, 13))
    @pytest.mark.parametrize("day", DAYS)
    @pytest.mark.parametrize("anchor", ANCHORS)
    def test_all_combinations(self, year, month, day, anchor):
        """Verify billing period for every valid combination of year/month/day/anchor."""
        max_day = days_in_month(year, month)

        if day > max_day:
            pytest.skip(f"Day {day} doesn't exist in {year}-{month:02d}")

        now = dt(year, month, day)
        result_year, result_month = compute_billing_period(now=now, anchor=anchor)

        # Expected behavior:
        if not anchor or day < anchor:
            # Stay in current period
            expected = (year, month)
        else:
            # Advance to next month
            expected = next_month(year, month)

        assert (result_year, result_month) == expected, (
            f"year={year}, month={month}, day={day}, anchor={anchor}: "
            f"expected {expected}, got ({result_year}, {result_month})"
        )

    def test_coverage_summary(self):
        """Verify we test a meaningful number of combinations."""
        count = 0
        for year in [2024, 2025]:
            for month in range(1, 13):
                max_day = days_in_month(year, month)
                for day in DAYS:
                    if day > max_day:
                        continue
                    for anchor in ANCHORS:
                        count += 1
        # Should have at least 2000 test cases
        assert count > 2000, f"Only {count} test cases — need broader coverage"
