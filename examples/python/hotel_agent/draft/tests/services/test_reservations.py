"""ReservationsAPI tests.

Critical separation: PMS persists, but does NOT enforce policy. Tests here
prove that:
  - modify always succeeds — no 2-mod cap, no 48h window, at the PMS level.
  - cancel always succeeds — no cutoff, at the PMS level.

Those rules are the agent's job, not the PMS's.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from core.db import seed_data as S
from core.domain import ReservationModify, ReservationStatus
from core.integrations.pms.fake import FakePMS
from core.integrations.pms.protocol import ReservationNotFoundError


# --- create -------------------------------------------------------------------


async def test_create_returns_confirmed_reservation(pms: FakePMS, fixed_clock) -> None:
    check_in = S.SEED_TODAY + timedelta(days=14)
    check_out = check_in + timedelta(days=2)
    res = await pms.reservations.create(
        guest_id=S.GUEST_GRACE_ID,
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    assert res.status == ReservationStatus.CONFIRMED
    assert res.modification_count == 0
    assert res.created_at == fixed_clock.now()
    assert res.guest_id == S.GUEST_GRACE_ID
    assert res.room_type == S.RT_STANDARD
    assert res.rate_plan == S.RP_FLEXIBLE
    assert res.check_in == check_in
    assert res.check_out == check_out


# --- get ----------------------------------------------------------------------


async def test_get_seeded_reservation(pms: FakePMS) -> None:
    res = await pms.reservations.get(S.RES_SARAH_FUTURE_FLEX_ID)
    assert res.id == S.RES_SARAH_FUTURE_FLEX_ID
    assert res.guest_id == S.GUEST_SARAH_ID
    assert res.room_type == S.RT_STANDARD
    assert res.rate_plan == S.RP_FLEXIBLE
    assert res.check_in == S.SEED_TODAY + timedelta(days=7)
    assert res.check_out == S.SEED_TODAY + timedelta(days=9)
    assert res.guests == 2
    assert res.status == ReservationStatus.CONFIRMED


async def test_get_unknown_raises(pms: FakePMS) -> None:
    with pytest.raises(ReservationNotFoundError):
        await pms.reservations.get("nope")


# --- list_for_guest -----------------------------------------------------------


async def test_list_for_guest_returns_all_for_bob(pms: FakePMS) -> None:
    rows = await pms.reservations.list_for_guest(S.GUEST_BOB_ID)
    ids = {r.id for r in rows}
    assert ids == {S.RES_BOB_TOMORROW_ADV_ID, S.RES_BOB_INSIDE_CUTOFF_ID}


async def test_list_for_guest_filters_by_status(pms: FakePMS) -> None:
    rows = await pms.reservations.list_for_guest(S.GUEST_BOB_ID, status="confirmed")
    assert len(rows) == 2
    assert all(r.status == ReservationStatus.CONFIRMED for r in rows)


async def test_list_for_guest_no_reservations(pms: FakePMS) -> None:
    rows = await pms.reservations.list_for_guest(S.GUEST_FRANK_ID)
    assert rows == []


# --- modify -------------------------------------------------------------------


async def test_modify_increments_count_and_applies_patch(pms: FakePMS) -> None:
    new_check_out = S.SEED_TODAY + timedelta(days=10)
    patch = ReservationModify(check_out=new_check_out)
    res = await pms.reservations.modify(S.RES_SARAH_FUTURE_FLEX_ID, patch)
    assert res.modification_count == 1
    assert res.check_out == new_check_out
    # Untouched fields remain.
    assert res.check_in == S.SEED_TODAY + timedelta(days=7)
    assert res.room_type == S.RT_STANDARD
    assert res.rate_plan == S.RP_FLEXIBLE
    assert res.guests == 2


async def test_modify_does_not_enforce_two_mod_cap(pms: FakePMS) -> None:
    """The 2-modification cap is policy enforced by the agent, not the PMS."""
    patch = ReservationModify(guests=2)
    for _ in range(3):
        res = await pms.reservations.modify(S.RES_SARAH_FUTURE_FLEX_ID, patch)
    assert res.modification_count == 3


async def test_modify_does_not_enforce_time_window(pms: FakePMS) -> None:
    """Bob's reservation that is inside the 24h cutoff still modifies fine here."""
    patch = ReservationModify(guests=1)
    res = await pms.reservations.modify(S.RES_BOB_INSIDE_CUTOFF_ID, patch)
    assert res.modification_count == 1
    assert res.guests == 1


async def test_modify_unknown_raises(pms: FakePMS) -> None:
    with pytest.raises(ReservationNotFoundError):
        await pms.reservations.modify("nope", ReservationModify(guests=1))


# --- cancel -------------------------------------------------------------------


async def test_cancel_marks_cancelled_with_clock(pms: FakePMS, fixed_clock) -> None:
    res = await pms.reservations.cancel(S.RES_SARAH_FUTURE_FLEX_ID)
    assert res.status == ReservationStatus.CANCELLED
    assert res.cancelled_at == fixed_clock.now()


async def test_cancel_does_not_enforce_cutoff(pms: FakePMS) -> None:
    """Cancelling a non-refundable inside cutoff still succeeds at the PMS layer.

    This is the policy-vs-PMS separation per architecture.md §Summary.
    """
    res = await pms.reservations.cancel(S.RES_CARLA_FUTURE_NONREF_ID)
    assert res.status == ReservationStatus.CANCELLED


async def test_cancel_already_cancelled_is_idempotent(pms: FakePMS) -> None:
    first = await pms.reservations.cancel(S.RES_SARAH_FUTURE_FLEX_ID)
    second = await pms.reservations.cancel(S.RES_SARAH_FUTURE_FLEX_ID)
    assert first.id == second.id
    assert second.status == ReservationStatus.CANCELLED
    # cancelled_at should not be re-stamped on a no-op.
    assert second.cancelled_at == first.cancelled_at


async def test_cancel_unknown_raises(pms: FakePMS) -> None:
    with pytest.raises(ReservationNotFoundError):
        await pms.reservations.cancel("nope")
