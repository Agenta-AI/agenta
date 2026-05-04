"""AvailabilityAPI tests."""

from __future__ import annotations

from datetime import timedelta

from core.db import seed_data as S
from core.integrations.pms.fake import FakePMS


async def test_search_returns_offers_for_capacity(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    offers = await pms.availability.search(
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    # Should have offers for room types that hold ≥ 2 guests.
    assert len(offers) > 0
    # Every returned offer must have at least one available unit.
    assert all(o.available_units >= 1 for o in offers)


async def test_search_offer_fields_consistent(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    offers = await pms.availability.search(
        check_in=check_in,
        check_out=check_out,
        guests=2,
    )
    valid_room_types = {S.RT_STANDARD, S.RT_DELUXE, S.RT_SUITE, S.RT_FAMILY, S.RT_PRESIDENTIAL}
    valid_rate_plans = {S.RP_FLEXIBLE, S.RP_ADVANCE, S.RP_NON_REFUNDABLE}
    for offer in offers:
        assert offer.room_type in valid_room_types
        assert offer.rate_plan in valid_rate_plans
        assert offer.nightly_rate > 0
        assert offer.available_units >= 0


async def test_search_pet_friendly_only(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    offers = await pms.availability.search(
        check_in=check_in,
        check_out=check_out,
        guests=2,
        pet_friendly_only=True,
    )
    # Only room types with pet-friendly inventory: STD, DLX, FAM, STE.
    pet_friendly_types = {S.RT_STANDARD, S.RT_DELUXE, S.RT_FAMILY, S.RT_SUITE}
    for offer in offers:
        assert offer.room_type in pet_friendly_types


async def test_search_over_max_capacity_returns_none(pms: FakePMS) -> None:
    check_in = S.SEED_TODAY + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    # Presidential max_capacity = 6, ask for 8.
    offers = await pms.availability.search(
        check_in=check_in,
        check_out=check_out,
        guests=8,
        room_type=S.RT_PRESIDENTIAL,
    )
    assert offers == []


async def test_search_overlapping_reservation_reduces_units(pms: FakePMS) -> None:
    # Eve's current presidential stay runs T-1 → T+2; ask for dates inside that
    # window — Presidential availability should drop relative to a clean window.
    overlap_in = S.SEED_TODAY
    overlap_out = S.SEED_TODAY + timedelta(days=1)
    overlap_offers = await pms.availability.search(
        check_in=overlap_in,
        check_out=overlap_out,
        guests=2,
        room_type=S.RT_PRESIDENTIAL,
    )

    clean_in = S.SEED_TODAY + timedelta(days=60)
    clean_out = clean_in + timedelta(days=1)
    clean_offers = await pms.availability.search(
        check_in=clean_in,
        check_out=clean_out,
        guests=2,
        room_type=S.RT_PRESIDENTIAL,
    )

    overlap_units = sum(o.available_units for o in overlap_offers)
    clean_units = sum(o.available_units for o in clean_offers)
    assert overlap_units < clean_units
