"""Deterministic seed data for the FakePMS.

This module is the single source of truth for what the demo hotel looks like.
**Adding new fixtures = adding entries to one of the lists below.** Nothing
elsewhere needs to change; ``seed.py`` just walks these lists.

Patterns to keep stable:

- Every record uses an explicit string id. No autogeneration. Tests assert
  against these ids.
- Dates are expressed as offsets from ``SEED_NOW`` using
  ``timedelta(days=...)``. This lets tests set a ``FixedClock(SEED_NOW)`` and
  reason about "tomorrow" / "next week" deterministically.
- Constants are exported by name (``GUEST_SARAH_ID``, ``RES_SARAH_FUTURE_ID``,
  etc.) so tests reference them directly instead of magic strings.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from core.domain import GuestTier, RateType, ReservationStatus

# ---- Anchor ------------------------------------------------------------------

#: Reference "now". Tests pin a FixedClock here. All relative dates derive
#: from this.
SEED_NOW: datetime = datetime(2026, 6, 1, 12, 0, 0)
SEED_TODAY: date = SEED_NOW.date()


# ---- Lightweight fixture dataclasses -----------------------------------------
# We use plain dataclasses (not the Pydantic domain types) for seed records
# because some include FK references and absolute timestamps that the loader
# needs in their raw form.


@dataclass(frozen=True)
class _GuestSeed:
    id: str
    email: str
    first_name: str
    last_name: str
    tier: GuestTier


@dataclass(frozen=True)
class _RoomTypeSeed:
    code: str
    name: str
    description: str
    base_capacity: int
    max_capacity: int
    base_nightly_rate: Decimal
    tier_rank: int


@dataclass(frozen=True)
class _RatePlanSeed:
    code: str
    name: str
    rate_type: RateType
    discount_pct: Decimal


@dataclass(frozen=True)
class _RoomSeed:
    id: str
    room_number: str
    room_type: str
    is_pet_friendly: bool


@dataclass(frozen=True)
class _ReservationSeed:
    id: str
    guest_id: str
    room_type: str
    rate_plan: str
    check_in: date
    check_out: date
    guests: int
    num_pets: int = 0
    status: ReservationStatus = ReservationStatus.CONFIRMED
    modification_count: int = 0
    created_at: datetime = SEED_NOW - timedelta(days=14)


@dataclass(frozen=True)
class _ServiceCatalogSeed:
    code: str
    description: str
    default_amount: Decimal


@dataclass(frozen=True)
class _ServiceChargeSeed:
    id: str
    reservation_id: str
    service_code: str
    description: str
    amount: Decimal
    when: datetime
    status: str = "open"


# ---- Named ids (exported, stable across runs) --------------------------------

# Guests
GUEST_SARAH_ID = "guest_sarah"  # Standard tier
GUEST_BOB_ID = "guest_bob"  # Standard tier
GUEST_CARLA_ID = "guest_carla"  # Gold
GUEST_DAN_ID = "guest_dan"  # Gold
GUEST_EVE_ID = "guest_eve"  # Platinum
GUEST_FRANK_ID = "guest_frank"  # Platinum, no reservations
GUEST_GRACE_ID = "guest_grace"  # Standard, no reservations

# Room types
RT_STANDARD = "STD"
RT_DELUXE = "DLX"
RT_SUITE = "STE"
RT_FAMILY = "FAM"
RT_PRESIDENTIAL = "PRES"

# Rate plans
RP_FLEXIBLE = "FLEX"
RP_ADVANCE = "ADV"
RP_NON_REFUNDABLE = "NONREF"

# Service codes
SVC_LATE_CHECKOUT_1PM = "late_checkout_1pm"
SVC_LATE_CHECKOUT_2PM = "late_checkout_2pm"
SVC_LATE_CHECKOUT_3PM = "late_checkout_3pm"
SVC_LATE_CHECKOUT_4PM = "late_checkout_4pm"
SVC_HOUSEKEEPING = "housekeeping_request"
SVC_WAKE_UP = "wake_up_call"
SVC_ROOM_SERVICE = "room_service"
SVC_BREAKFAST = "breakfast_addon"
SVC_PARKING = "parking_per_night"

# Reservations
RES_SARAH_FUTURE_FLEX_ID = "res_sarah_future_flex"  # 7 days out, flexible
RES_BOB_TOMORROW_ADV_ID = "res_bob_tomorrow_adv"  # 1 day out, advance
RES_BOB_INSIDE_CUTOFF_ID = "res_bob_inside_cutoff"  # 12h out, flexible (inside Std cutoff)
RES_CARLA_PAST_COMPLETE_ID = "res_carla_past_complete"  # 30 days ago, completed
RES_CARLA_FUTURE_NONREF_ID = "res_carla_future_nonref"  # 14 days out, non-refundable
RES_DAN_FUTURE_FLEX_ID = "res_dan_future_flex"  # 21 days out, flexible
RES_EVE_FUTURE_FLEX_ID = "res_eve_future_flex"  # 10 days out, flexible (Platinum)
RES_EVE_CURRENT_STAY_ID = "res_eve_current_stay"  # in-stay (T-1 → T+2)


# ---- Seed lists --------------------------------------------------------------

GUESTS: tuple[_GuestSeed, ...] = (
    _GuestSeed(GUEST_SARAH_ID, "sarah@example.com", "Sarah", "Smith", GuestTier.STANDARD),
    _GuestSeed(GUEST_BOB_ID, "bob@example.com", "Bob", "Brown", GuestTier.STANDARD),
    _GuestSeed(GUEST_CARLA_ID, "carla@example.com", "Carla", "Chen", GuestTier.GOLD),
    _GuestSeed(GUEST_DAN_ID, "dan@example.com", "Dan", "Davis", GuestTier.GOLD),
    _GuestSeed(GUEST_EVE_ID, "eve@example.com", "Eve", "Edwards", GuestTier.PLATINUM),
    _GuestSeed(GUEST_FRANK_ID, "frank@example.com", "Frank", "Foster", GuestTier.PLATINUM),
    _GuestSeed(GUEST_GRACE_ID, "grace@example.com", "Grace", "Green", GuestTier.STANDARD),
)


ROOM_TYPES: tuple[_RoomTypeSeed, ...] = (
    _RoomTypeSeed(
        code=RT_STANDARD,
        name="Standard Room",
        description="Cozy room with one queen bed.",
        base_capacity=2,
        max_capacity=2,
        base_nightly_rate=Decimal("180.00"),
        tier_rank=1,
    ),
    _RoomTypeSeed(
        code=RT_DELUXE,
        name="Deluxe Room",
        description="Spacious room with king bed and city view.",
        base_capacity=2,
        max_capacity=3,
        base_nightly_rate=Decimal("260.00"),
        tier_rank=2,
    ),
    _RoomTypeSeed(
        code=RT_SUITE,
        name="Suite",
        description="Separate living area, king bedroom, two bathrooms.",
        base_capacity=2,
        max_capacity=4,
        base_nightly_rate=Decimal("420.00"),
        tier_rank=3,
    ),
    _RoomTypeSeed(
        code=RT_FAMILY,
        name="Family Room",
        description="Two queen beds, sleeper sofa, kitchenette.",
        base_capacity=4,
        max_capacity=6,
        base_nightly_rate=Decimal("340.00"),
        tier_rank=2,
    ),
    _RoomTypeSeed(
        code=RT_PRESIDENTIAL,
        name="Presidential Suite",
        description="Top-floor suite with private terrace and butler service.",
        base_capacity=2,
        max_capacity=6,
        base_nightly_rate=Decimal("980.00"),
        tier_rank=4,
    ),
)


RATE_PLANS: tuple[_RatePlanSeed, ...] = (
    _RatePlanSeed(RP_FLEXIBLE, "Flexible Rate", RateType.FLEXIBLE, Decimal("0")),
    _RatePlanSeed(RP_ADVANCE, "Advance Purchase", RateType.ADVANCE, Decimal("0.15")),
    _RatePlanSeed(RP_NON_REFUNDABLE, "Non-Refundable", RateType.NON_REFUNDABLE, Decimal("0.25")),
)


def _rooms() -> tuple[_RoomSeed, ...]:
    """Build ~20 rooms across the five types. Some pet-friendly per policy.md §10."""

    layout: list[tuple[str, int, int]] = [
        # (room_type, count, pet_friendly_count)
        (RT_STANDARD, 6, 2),
        (RT_DELUXE, 5, 2),
        (RT_FAMILY, 4, 2),
        (RT_SUITE, 3, 1),
        (RT_PRESIDENTIAL, 2, 0),
    ]
    rooms: list[_RoomSeed] = []
    floor = 1
    for room_type, count, pet_count in layout:
        floor += 1
        for i in range(count):
            number = f"{floor}{i:02d}"
            rooms.append(
                _RoomSeed(
                    id=f"room_{room_type.lower()}_{number}",
                    room_number=number,
                    room_type=room_type,
                    is_pet_friendly=i < pet_count,
                )
            )
    return tuple(rooms)


ROOMS: tuple[_RoomSeed, ...] = _rooms()


SERVICE_CATALOG: tuple[_ServiceCatalogSeed, ...] = (
    _ServiceCatalogSeed(SVC_LATE_CHECKOUT_1PM, "Late checkout to 1pm (free)", Decimal("0")),
    _ServiceCatalogSeed(SVC_LATE_CHECKOUT_2PM, "Late checkout to 2pm", Decimal("25.00")),
    _ServiceCatalogSeed(SVC_LATE_CHECKOUT_3PM, "Late checkout to 3pm", Decimal("50.00")),
    _ServiceCatalogSeed(SVC_LATE_CHECKOUT_4PM, "Late checkout to 4pm", Decimal("75.00")),
    _ServiceCatalogSeed(SVC_HOUSEKEEPING, "Housekeeping request", Decimal("0")),
    _ServiceCatalogSeed(SVC_WAKE_UP, "Wake-up call", Decimal("0")),
    _ServiceCatalogSeed(SVC_ROOM_SERVICE, "Room service order (menu prices)", Decimal("0")),
    _ServiceCatalogSeed(SVC_BREAKFAST, "Breakfast add-on (per night)", Decimal("28.00")),
    _ServiceCatalogSeed(SVC_PARKING, "Parking (per night)", Decimal("35.00")),
)


def _reservations() -> tuple[_ReservationSeed, ...]:
    nights = lambda d, n: d + timedelta(days=n)  # noqa: E731
    return (
        _ReservationSeed(
            id=RES_SARAH_FUTURE_FLEX_ID,
            guest_id=GUEST_SARAH_ID,
            room_type=RT_STANDARD,
            rate_plan=RP_FLEXIBLE,
            check_in=SEED_TODAY + timedelta(days=7),
            check_out=nights(SEED_TODAY + timedelta(days=7), 2),
            guests=2,
        ),
        _ReservationSeed(
            id=RES_BOB_TOMORROW_ADV_ID,
            guest_id=GUEST_BOB_ID,
            room_type=RT_DELUXE,
            rate_plan=RP_ADVANCE,
            check_in=SEED_TODAY + timedelta(days=1),
            check_out=SEED_TODAY + timedelta(days=4),
            guests=2,
        ),
        _ReservationSeed(
            id=RES_BOB_INSIDE_CUTOFF_ID,
            guest_id=GUEST_BOB_ID,
            room_type=RT_STANDARD,
            rate_plan=RP_FLEXIBLE,
            # check-in is "today, 24:00" — 12h after SEED_NOW is 00:00 next day,
            # which means at SEED_NOW we are still inside the 24h Standard cutoff.
            check_in=SEED_TODAY + timedelta(days=1),
            check_out=SEED_TODAY + timedelta(days=2),
            guests=1,
        ),
        _ReservationSeed(
            id=RES_CARLA_PAST_COMPLETE_ID,
            guest_id=GUEST_CARLA_ID,
            room_type=RT_DELUXE,
            rate_plan=RP_FLEXIBLE,
            check_in=SEED_TODAY - timedelta(days=30),
            check_out=SEED_TODAY - timedelta(days=27),
            guests=2,
            status=ReservationStatus.COMPLETED,
            created_at=SEED_NOW - timedelta(days=60),
        ),
        _ReservationSeed(
            id=RES_CARLA_FUTURE_NONREF_ID,
            guest_id=GUEST_CARLA_ID,
            room_type=RT_SUITE,
            rate_plan=RP_NON_REFUNDABLE,
            check_in=SEED_TODAY + timedelta(days=14),
            check_out=SEED_TODAY + timedelta(days=17),
            guests=2,
        ),
        _ReservationSeed(
            id=RES_DAN_FUTURE_FLEX_ID,
            guest_id=GUEST_DAN_ID,
            room_type=RT_FAMILY,
            rate_plan=RP_FLEXIBLE,
            check_in=SEED_TODAY + timedelta(days=21),
            check_out=SEED_TODAY + timedelta(days=24),
            guests=4,
            num_pets=1,
        ),
        _ReservationSeed(
            id=RES_EVE_FUTURE_FLEX_ID,
            guest_id=GUEST_EVE_ID,
            room_type=RT_DELUXE,
            rate_plan=RP_FLEXIBLE,
            check_in=SEED_TODAY + timedelta(days=10),
            check_out=SEED_TODAY + timedelta(days=12),
            guests=2,
        ),
        _ReservationSeed(
            id=RES_EVE_CURRENT_STAY_ID,
            guest_id=GUEST_EVE_ID,
            room_type=RT_PRESIDENTIAL,
            rate_plan=RP_FLEXIBLE,
            check_in=SEED_TODAY - timedelta(days=1),
            check_out=SEED_TODAY + timedelta(days=2),
            guests=2,
            created_at=SEED_NOW - timedelta(days=21),
        ),
    )


RESERVATIONS: tuple[_ReservationSeed, ...] = _reservations()


# Pre-existing service charges (e.g. on Eve's current stay)
SERVICE_CHARGES: tuple[_ServiceChargeSeed, ...] = (
    _ServiceChargeSeed(
        id="svc_eve_breakfast_day1",
        reservation_id=RES_EVE_CURRENT_STAY_ID,
        service_code=SVC_BREAKFAST,
        description="Breakfast add-on",
        amount=Decimal("28.00"),
        when=SEED_NOW - timedelta(hours=5),
    ),
)
