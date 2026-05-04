"""RatesAPI tests — list_rate_plans and quote.

Quote pricing rules under test (from policy.md §4):
  - Room rate × nights, per rate type discount
  - Occupancy tax: 14% on the room rate (not on resort fee)
  - Resort fee: $35/night (waived for Platinum)
  - Pet fee: $100/stay/pet
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from core.db import seed_data as S
from core.integrations.pms.fake import FakePMS
from core.integrations.pms.protocol import (
    InvalidDatesError,
    RatePlanNotFoundError,
    RoomTypeNotFoundError,
)


# --- list_rate_plans ----------------------------------------------------------


async def test_list_rate_plans_returns_all_three(pms: FakePMS) -> None:
    plans = await pms.rates.list_rate_plans()
    codes = {p.code for p in plans}
    assert codes == {S.RP_FLEXIBLE, S.RP_ADVANCE, S.RP_NON_REFUNDABLE}


async def test_list_rate_plans_filtered_by_room_type(pms: FakePMS) -> None:
    # v1: all plans apply to all room types — but the call shape must work.
    plans = await pms.rates.list_rate_plans(room_type=S.RT_STANDARD)
    codes = {p.code for p in plans}
    assert codes == {S.RP_FLEXIBLE, S.RP_ADVANCE, S.RP_NON_REFUNDABLE}


# --- quote: invariants and line items -----------------------------------------


async def test_quote_total_equals_sum_of_lines(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    assert quote.total == sum((line.amount for line in quote.lines), Decimal("0"))
    assert quote.nights == 2


async def test_quote_includes_room_tax_and_resort_fee_lines(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    # Standard: $180 × 2 nights = $360 room
    room_total = sum(
        (line.amount for line in quote.lines if "room" in line.label.lower()),
        Decimal("0"),
    )
    assert room_total == Decimal("360.00")
    # Tax = 14% of room
    tax_total = sum(
        (line.amount for line in quote.lines if "tax" in line.label.lower()),
        Decimal("0"),
    )
    assert tax_total == Decimal("360.00") * Decimal("0.14")
    # Resort fee = $35 × 2 nights = $70
    resort_total = sum(
        (line.amount for line in quote.lines if "resort" in line.label.lower()),
        Decimal("0"),
    )
    assert resort_total == Decimal("70.00")


async def test_quote_includes_pet_fee_when_pets(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_FAMILY,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=3,
        num_pets=1,
    )
    pet_total = sum(
        (line.amount for line in quote.lines if "pet" in line.label.lower()),
        Decimal("0"),
    )
    # $100/stay/pet, 1 pet → $100
    assert pet_total == Decimal("100.00")


async def test_quote_no_pet_fee_when_no_pets(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
        num_pets=0,
    )
    pet_lines = [line for line in quote.lines if "pet" in line.label.lower()]
    # Either no pet line at all, or zero amount.
    assert all(line.amount == Decimal("0") for line in pet_lines)


# --- Tier-based fee waivers ---------------------------------------------------


async def test_quote_platinum_resort_fee_waived(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
        guest_id=S.GUEST_EVE_ID,
    )
    resort_lines = [line for line in quote.lines if "resort" in line.label.lower()]
    # Either omitted entirely or set to 0 — either is acceptable per the spec.
    assert all(line.amount == Decimal("0") for line in resort_lines)


async def test_quote_gold_pays_full_resort_fee(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
        guest_id=S.GUEST_CARLA_ID,
    )
    resort_total = sum(
        (line.amount for line in quote.lines if "resort" in line.label.lower()),
        Decimal("0"),
    )
    # 2 nights × $35
    assert resort_total == Decimal("70.00")


# --- Rate plan discount comparison --------------------------------------------


async def _flex_room_subtotal(pms: FakePMS) -> Decimal:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=S.RP_FLEXIBLE,
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    return sum(
        (line.amount for line in quote.lines if "room" in line.label.lower()),
        Decimal("0"),
    )


async def _room_subtotal(pms: FakePMS, rate_plan: str) -> Decimal:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    quote = await pms.rates.quote(
        room_type=S.RT_STANDARD,
        rate_plan=rate_plan,
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    return sum(
        (line.amount for line in quote.lines if "room" in line.label.lower()),
        Decimal("0"),
    )


async def test_advance_rate_is_about_15_percent_cheaper(pms: FakePMS) -> None:
    flex = await _flex_room_subtotal(pms)
    advance = await _room_subtotal(pms, S.RP_ADVANCE)
    # Expect ~15% off the room subtotal
    assert advance == flex * (Decimal("1") - Decimal("0.15"))


async def test_non_refundable_rate_is_about_25_percent_cheaper(pms: FakePMS) -> None:
    flex = await _flex_room_subtotal(pms)
    nonref = await _room_subtotal(pms, S.RP_NON_REFUNDABLE)
    assert nonref == flex * (Decimal("1") - Decimal("0.25"))


# --- Validation errors --------------------------------------------------------


async def test_quote_invalid_dates_raises(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in - timedelta(days=1)  # before check-in
    with pytest.raises(InvalidDatesError):
        await pms.rates.quote(
            room_type=S.RT_STANDARD,
            rate_plan=S.RP_FLEXIBLE,
            check_in=check_in,
            check_out=check_out,
            guests=2,
        )


async def test_quote_unknown_room_type_raises(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    with pytest.raises(RoomTypeNotFoundError):
        await pms.rates.quote(
            room_type="NOPE",
            rate_plan=S.RP_FLEXIBLE,
            check_in=check_in,
            check_out=check_out,
            guests=2,
        )


async def test_quote_unknown_rate_plan_raises(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=7)
    check_out = check_in + timedelta(days=2)
    with pytest.raises(RatePlanNotFoundError):
        await pms.rates.quote(
            room_type=S.RT_STANDARD,
            rate_plan="NOPE",
            check_in=check_in,
            check_out=check_out,
            guests=2,
        )
