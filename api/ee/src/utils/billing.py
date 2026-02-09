"""
Shared billing period computation utility.

The billing period is anchored to a specific day of the month (the "anchor day"),
derived from the Stripe billing_cycle_anchor when the subscription was created.

Rules:
  - If the current day is BEFORE the anchor day, the billing period is
    (year, month) = (now.year, now.month).
  - If the current day is ON or AFTER the anchor day, the billing period
    advances to the NEXT month: (year, month) computed accordingly.
  - If anchor is None/0/falsy, the billing period is simply (now.year, now.month).

The returned (year, month) is used as the composite key for meter rows in the DB.
"""

from typing import Tuple, Optional
from datetime import datetime, timezone


def compute_billing_period(
    *,
    now: Optional[datetime] = None,
    anchor: Optional[int] = None,
) -> Tuple[int, int]:
    """Compute the current billing period (year, month) based on the anchor day.

    Args:
        now: The current datetime (defaults to utcnow). Must be timezone-aware.
        anchor: The anchor day of the month (1-31). If None/0, ignored.

    Returns:
        Tuple of (year, month) representing the billing period.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    if not anchor or now.day < anchor:
        return now.year, now.month

    # Advance to next month
    if now.month == 12:
        return now.year + 1, 1
    else:
        return now.year, now.month + 1
