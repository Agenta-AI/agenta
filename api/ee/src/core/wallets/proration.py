"""Pure, DB-free plan-change proration arithmetic and billing-period-boundary math.
Sibling to `plan_settlement` in `types.py`: this module decides amounts; the DAO does the
locking/writes around the decision (see `WalletsDAOInterface.apply_plan_change`).

Rounding happens in exactly ONE place, `_prorate`, via integer floor division
(`//`) — truncation toward zero. Both the outgoing-remainder debit and the incoming-share
credit call the same `_prorate`, so a plan change never rounds in the organization's favor
on one side while rounding against it on the other; the platform consistently rounds every
prorated amount DOWN (never over-credits the incoming share, never over-debits the
outgoing remainder).
"""

import calendar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Tuple
from uuid import UUID


@dataclass(frozen=True)
class PlanChangeProrationResult:
    outgoing_credit_id: Optional[UUID]
    outgoing_debit_amount_musd: int
    incoming_credit_amount_musd: int
    # incoming minus outgoing; the net general-balance adjustment this change applies.
    general_balance_delta: int


def _prorate(*, amount_musd: int, remaining_seconds: int, total_seconds: int) -> int:
    """ROUND HERE, once. Floor division truncates toward zero."""
    if amount_musd <= 0 or total_seconds <= 0 or remaining_seconds <= 0:
        return 0
    remaining_seconds = min(remaining_seconds, total_seconds)
    return (amount_musd * remaining_seconds) // total_seconds


def compute_plan_change_proration(
    *,
    outgoing_credit_id: Optional[UUID],
    outgoing_allowance_musd: int,
    incoming_allowance_musd: int,
    outgoing_period_start: datetime,
    outgoing_period_end: datetime,
    incoming_period_start: datetime,
    incoming_period_end: datetime,
    now: datetime,
) -> PlanChangeProrationResult:
    """Prorate by the REMAINING FRACTION of a billing period, applied independently to
    each plan's full-period allowance. No I/O, no locking, no idempotency decision — the
    DAO's `apply_plan_change` owns the replay guard and the actual writes.

    EACH SIDE GETS ITS OWN WINDOW. The outgoing remainder is clawed back out of the period
    the outgoing allowance was GRANTED for, and the incoming share pays for the period the
    new credit will COVER. A plan change that also moves the billing anchor (Stripe sends
    a new `billing_cycle_anchor` on a new subscription) makes those two different windows;
    prorating the incoming grant over the outgoing window would size it — and expire it —
    against a period the customer is no longer billed on. When the anchor does not move,
    the two windows are identical and this is exactly the single-window arithmetic.

    `outgoing_credit_id=None` (no active plan-allowance credit found for the organization)
    always yields `outgoing_debit_amount_musd=0` — there is nothing to remove a remainder
    from. A zero `outgoing_allowance_musd`/`incoming_allowance_musd` (today's mapping,
    see `plans.py`) exercises this exact same arithmetic and simply yields a zero amount;
    it is a data fact, not a branch on plan identity.
    """
    outgoing_debit_amount_musd = 0
    if outgoing_credit_id is not None:
        outgoing_debit_amount_musd = _prorate(
            amount_musd=outgoing_allowance_musd,
            remaining_seconds=int((outgoing_period_end - now).total_seconds()),
            total_seconds=int(
                (outgoing_period_end - outgoing_period_start).total_seconds()
            ),
        )

    incoming_credit_amount_musd = _prorate(
        amount_musd=incoming_allowance_musd,
        remaining_seconds=int((incoming_period_end - now).total_seconds()),
        total_seconds=int(
            (incoming_period_end - incoming_period_start).total_seconds()
        ),
    )

    return PlanChangeProrationResult(
        outgoing_credit_id=outgoing_credit_id,
        outgoing_debit_amount_musd=outgoing_debit_amount_musd,
        incoming_credit_amount_musd=incoming_credit_amount_musd,
        general_balance_delta=incoming_credit_amount_musd - outgoing_debit_amount_musd,
    )


def billing_period_bounds(
    *,
    now: datetime,
    anchor: Optional[int],
) -> Tuple[datetime, datetime]:
    """Return `(period_start, period_end)`, the Stripe-style anchor-day billing window
    containing `now`. `anchor` `None`/`0` means "natural calendar month" (the 1st).
    Mirrors the anchor-day advance rule in `ee.src.dbs.postgres.meters.dao` /
    `ee.src.core.access.entitlements.service.monthly_period_from` (same rule, restated
    here as exact datetimes rather than a `(year, month)` bucket, since proration needs
    real second-level boundaries, not a period key).

    The anchor is clamped to the CURRENT month's length before the comparison, not only
    when building the dates: anchor 31 means "the 28th" in a February, so on 28 February
    the current period has already started. Comparing against the raw 31 instead would
    place the window in January and end it on 28 February 00:00 — a window that ends
    before `now`, giving the caller a zero or negative remainder to prorate over."""
    anchor_day = anchor or 1
    current_month_anchor = min(anchor_day, calendar.monthrange(now.year, now.month)[1])

    if now.day >= current_month_anchor:
        start_year, start_month = now.year, now.month
    else:
        start_year, start_month = (
            (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
        )

    start_day = min(anchor_day, calendar.monthrange(start_year, start_month)[1])
    period_start = datetime(start_year, start_month, start_day, tzinfo=timezone.utc)

    end_year, end_month = (
        (start_year, start_month + 1) if start_month < 12 else (start_year + 1, 1)
    )
    end_day = min(anchor_day, calendar.monthrange(end_year, end_month)[1])
    period_end = datetime(end_year, end_month, end_day, tzinfo=timezone.utc)

    return period_start, period_end
