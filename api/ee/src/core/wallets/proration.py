"""Pure, DB-free plan-change proration arithmetic. Sibling to `plan_settlement` in
`types.py`: this module decides amounts; the DAO does the locking/writes around the
decision (see `WalletsDAOInterface.apply_plan_change`).

Rounding happens in exactly ONE place, `_prorate`, via integer floor division
(`//`) — truncation toward zero. Both the outgoing-remainder debit and the incoming-share
credit call the same `_prorate`, so a plan change never rounds in the organization's favor
on one side while rounding against it on the other; the platform consistently rounds every
prorated amount DOWN (never over-credits the incoming share, never over-debits the
outgoing remainder).
"""

from datetime import datetime
from typing import Optional


def _prorate(*, amount_musd: int, remaining_seconds: int, total_seconds: int) -> int:
    """ROUND HERE, once. Floor division truncates toward zero."""
    if amount_musd <= 0 or total_seconds <= 0 or remaining_seconds <= 0:
        return 0
    remaining_seconds = min(remaining_seconds, total_seconds)
    return (amount_musd * remaining_seconds) // total_seconds


def prorate_incoming_allowance(
    *,
    allowance_musd: int,
    period_start: datetime,
    period_end: datetime,
    now: datetime,
) -> int:
    """The share of a plan's full-period allowance still ahead of `now` in the billing
    period the new credit will cover. The period is the subscription's real one, as the
    billing provider reports it, and `now` is when the change took effect."""
    return _prorate(
        amount_musd=allowance_musd,
        remaining_seconds=int((period_end - now).total_seconds()),
        total_seconds=int((period_end - period_start).total_seconds()),
    )


def prorate_outgoing_allowance(
    *,
    credit_amount_musd: int,
    credit_start_time: Optional[datetime],
    credit_end_time: Optional[datetime],
    now: datetime,
) -> int:
    """The unused share of an allowance credit's own lifetime at `now`.

    The credit already records the window it pays for: it was minted at `start_time`
    carrying the allowance still ahead of it, and expires at `end_time`, the end of its
    billing period. Prorating its own amount over its own lifetime therefore equals
    prorating the plan's full allowance over the full period (up to rounding), without
    reconstructing a period the credit may no longer share with the subscription — the
    anchor can move, the plan can change twice, the subscription can be replaced.

    A credit without both bounds has no lifetime to prorate over and yields zero; every
    plan-allowance credit is minted with both."""
    if credit_start_time is None or credit_end_time is None:
        return 0
    return _prorate(
        amount_musd=credit_amount_musd,
        remaining_seconds=int((credit_end_time - now).total_seconds()),
        total_seconds=int((credit_end_time - credit_start_time).total_seconds()),
    )
