"""FakePMS — a SQLite-backed implementation of the PMS Protocols.

Implementation rules (architecture.md §The fake implementation):

1. All persistence is via the SQLAlchemy session over the configured DB. No
   in-memory dicts that drift out of sync.
2. Time comes from the injected ``Clock``, never ``datetime.now()`` directly.
3. Methods return ``core.domain`` Pydantic types, not ORM rows. The mapping
   happens here.
4. The fake does NOT enforce policy. Cancel/modify always succeed if the
   row exists (modulo typed errors for missing rows / invalid args).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.clock import Clock
from core.db.tables import (
    GuestRow,
    RatePlanRow,
    ReservationRow,
    RoomRow,
    RoomTypeRow,
    ServiceCatalogRow,
    ServiceChargeRow,
)
from core.domain import (
    Guest,
    GuestTier,
    Offer,
    Quote,
    QuoteLine,
    RatePlan,
    RateType,
    Reservation,
    ReservationModify,
    ReservationStatus,
    RoomType,
    ServiceCharge,
    ServiceTicketStatus,
)
from core.integrations.pms.protocol import (
    AvailabilityAPI,
    GuestNotFoundError,
    GuestsAPI,
    InvalidDatesError,
    InventoryAPI,
    RatePlanNotFoundError,
    RatesAPI,
    ReservationNotFoundError,
    ReservationsAPI,
    RoomTypeNotFoundError,
    ServicesAPI,
)


# ---- Policy-document constants used by the rates calculator ------------------
# These mirror the numbers in policy.md §4. Centralized here so a single
# change updates the price math everywhere.

OCCUPANCY_TAX_RATE = Decimal("0.14")  # 14% on room rate only
RESORT_FEE_PER_NIGHT = Decimal("35.00")  # waived for Platinum
PET_FEE_PER_STAY = Decimal("100.00")  # per pet, per stay
TWO_DP = Decimal("0.01")


def _money(d: Decimal) -> Decimal:
    return d.quantize(TWO_DP, rounding=ROUND_HALF_UP)


# ---- Mappers (DBE → DTO) -----------------------------------------------------


def _guest_from_row(row: GuestRow) -> Guest:
    return Guest(
        id=row.id,
        email=row.email,
        first_name=row.first_name,
        last_name=row.last_name,
        tier=GuestTier(row.tier),
    )


def _room_type_from_row(row: RoomTypeRow) -> RoomType:
    return RoomType(
        code=row.code,
        name=row.name,
        description=row.description,
        base_capacity=row.base_capacity,
        max_capacity=row.max_capacity,
        base_nightly_rate=Decimal(row.base_nightly_rate),
        tier_rank=row.tier_rank,
    )


def _rate_plan_from_row(row: RatePlanRow) -> RatePlan:
    return RatePlan(
        code=row.code,
        name=row.name,
        rate_type=RateType(row.rate_type),
        discount_pct=Decimal(row.discount_pct),
    )


def _reservation_from_row(row: ReservationRow) -> Reservation:
    return Reservation(
        id=row.id,
        guest_id=row.guest_id,
        room_type=row.room_type,
        rate_plan=row.rate_plan,
        check_in=row.check_in,
        check_out=row.check_out,
        guests=row.guests,
        num_pets=row.num_pets,
        status=ReservationStatus(row.status),
        modification_count=row.modification_count,
        created_at=row.created_at,
        cancelled_at=row.cancelled_at,
    )


def _service_charge_from_row(row: ServiceChargeRow) -> ServiceCharge:
    return ServiceCharge(
        id=row.id,
        reservation_id=row.reservation_id,
        service_code=row.service_code,
        description=row.description,
        amount=Decimal(row.amount),
        when=row.when,
        status=ServiceTicketStatus(row.status),
    )


# ---- Sub-API implementations -------------------------------------------------


class _BaseAPI:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._sf = session_factory

    def _session(self) -> AsyncSession:
        return self._sf()


class FakeInventoryAPI(_BaseAPI):
    async def list_room_types(self) -> list[RoomType]:
        async with self._session() as s:
            rows = (
                (await s.execute(select(RoomTypeRow).order_by(RoomTypeRow.tier_rank)))
                .scalars()
                .all()
            )
        return [_room_type_from_row(r) for r in rows]

    async def get_room_type(self, code: str) -> RoomType:
        async with self._session() as s:
            row = (
                await s.execute(select(RoomTypeRow).where(RoomTypeRow.code == code))
            ).scalar_one_or_none()
        if row is None:
            raise RoomTypeNotFoundError(code)
        return _room_type_from_row(row)


class FakeRatesAPI(_BaseAPI):
    async def list_rate_plans(self, *, room_type: Optional[str] = None) -> list[RatePlan]:
        # v1 contract: every rate plan applies to every room type. We accept
        # the filter argument so the call shape works; future versions can
        # actually constrain.
        async with self._session() as s:
            if room_type is not None:
                rt = (
                    await s.execute(select(RoomTypeRow).where(RoomTypeRow.code == room_type))
                ).scalar_one_or_none()
                if rt is None:
                    raise RoomTypeNotFoundError(room_type)
            rows = (await s.execute(select(RatePlanRow).order_by(RatePlanRow.code))).scalars().all()
        return [_rate_plan_from_row(r) for r in rows]

    async def quote(
        self,
        *,
        room_type: str,
        rate_plan: str,
        check_in: date,
        check_out: date,
        guests: int,
        num_pets: int = 0,
        guest_id: Optional[str] = None,
    ) -> Quote:
        if check_out <= check_in:
            raise InvalidDatesError(
                f"check_out ({check_out}) must be strictly after check_in ({check_in})"
            )
        nights = (check_out - check_in).days

        async with self._session() as s:
            rt = (
                await s.execute(select(RoomTypeRow).where(RoomTypeRow.code == room_type))
            ).scalar_one_or_none()
            if rt is None:
                raise RoomTypeNotFoundError(room_type)
            rp = (
                await s.execute(select(RatePlanRow).where(RatePlanRow.code == rate_plan))
            ).scalar_one_or_none()
            if rp is None:
                raise RatePlanNotFoundError(rate_plan)

            tier = GuestTier.STANDARD
            if guest_id is not None:
                guest_row = (
                    await s.execute(select(GuestRow).where(GuestRow.id == guest_id))
                ).scalar_one_or_none()
                if guest_row is not None:
                    tier = GuestTier(guest_row.tier)

        nightly_rate = _money(
            Decimal(rt.base_nightly_rate) * (Decimal("1") - Decimal(rp.discount_pct))
        )
        room_total = _money(nightly_rate * nights)
        tax = _money(room_total * OCCUPANCY_TAX_RATE)

        platinum_waiver = tier == GuestTier.PLATINUM
        resort_fee_total = (
            Decimal("0") if platinum_waiver else _money(RESORT_FEE_PER_NIGHT * nights)
        )
        pet_fee_total = _money(PET_FEE_PER_STAY * num_pets) if num_pets else Decimal("0")

        lines: list[QuoteLine] = [
            QuoteLine(
                label="Room",
                amount=room_total,
                detail=f"${nightly_rate} × {nights} night{'s' if nights != 1 else ''}",
            ),
            QuoteLine(
                label="Occupancy tax",
                amount=tax,
                detail="14% on room rate",
            ),
            QuoteLine(
                label="Resort fee",
                amount=resort_fee_total,
                detail=(
                    "Waived (Platinum tier)"
                    if platinum_waiver
                    else f"${RESORT_FEE_PER_NIGHT}/night × {nights}"
                ),
            ),
        ]
        if num_pets:
            lines.append(
                QuoteLine(
                    label="Pet fee",
                    amount=pet_fee_total,
                    detail=f"${PET_FEE_PER_STAY}/stay × {num_pets} pet{'s' if num_pets != 1 else ''}",
                )
            )

        total = _money(sum((line.amount for line in lines), Decimal("0")))

        return Quote(
            room_type=room_type,
            rate_plan=rate_plan,
            check_in=check_in,
            check_out=check_out,
            guests=guests,
            nights=nights,
            lines=tuple(lines),
            total=total,
        )


class FakeAvailabilityAPI(_BaseAPI):
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        rates: FakeRatesAPI,
    ):
        super().__init__(session_factory)
        self._rates = rates

    async def search(
        self,
        *,
        check_in: date,
        check_out: date,
        guests: int,
        room_type: Optional[str] = None,
        pet_friendly_only: bool = False,
    ) -> list[Offer]:
        if check_out <= check_in:
            raise InvalidDatesError(
                f"check_out ({check_out}) must be strictly after check_in ({check_in})"
            )

        async with self._session() as s:
            # Pull room types of sufficient capacity, optionally filtered.
            rt_q = select(RoomTypeRow).where(RoomTypeRow.max_capacity >= guests)
            if room_type is not None:
                rt_q = rt_q.where(RoomTypeRow.code == room_type)
            room_types = (await s.execute(rt_q)).scalars().all()

            # All rate plans (v1: every plan applies to every type).
            rate_plans = (await s.execute(select(RatePlanRow))).scalars().all()

            # Inventory counts by room type.
            room_q = select(RoomRow)
            if pet_friendly_only:
                room_q = room_q.where(RoomRow.is_pet_friendly.is_(True))
            rooms = (await s.execute(room_q)).scalars().all()

            inventory_by_type: dict[str, int] = {}
            for r in rooms:
                inventory_by_type[r.room_type] = inventory_by_type.get(r.room_type, 0) + 1

            # Confirmed reservations overlapping [check_in, check_out).
            overlap = and_(
                ReservationRow.status == ReservationStatus.CONFIRMED.value,
                ReservationRow.check_in < check_out,
                ReservationRow.check_out > check_in,
            )
            blocked = (await s.execute(select(ReservationRow).where(overlap))).scalars().all()
            blocked_by_type: dict[str, int] = {}
            for r in blocked:
                blocked_by_type[r.room_type] = blocked_by_type.get(r.room_type, 0) + 1

        offers: list[Offer] = []
        for rt in room_types:
            available = inventory_by_type.get(rt.code, 0) - blocked_by_type.get(rt.code, 0)
            if available <= 0:
                continue
            for rp in rate_plans:
                nightly = _money(
                    Decimal(rt.base_nightly_rate) * (Decimal("1") - Decimal(rp.discount_pct))
                )
                offers.append(
                    Offer(
                        room_type=rt.code,
                        rate_plan=rp.code,
                        nightly_rate=nightly,
                        available_units=available,
                    )
                )

        return offers


class FakeReservationsAPI(_BaseAPI):
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        clock: Clock,
    ):
        super().__init__(session_factory)
        self._clock = clock

    async def create(
        self,
        *,
        guest_id: str,
        room_type: str,
        rate_plan: str,
        check_in: date,
        check_out: date,
        guests: int,
        num_pets: int = 0,
    ) -> Reservation:
        if check_out <= check_in:
            raise InvalidDatesError(
                f"check_out ({check_out}) must be strictly after check_in ({check_in})"
            )

        async with self._session() as s:
            # FK validation — fast typed errors instead of opaque IntegrityError.
            if not (
                await s.execute(select(GuestRow).where(GuestRow.id == guest_id))
            ).scalar_one_or_none():
                raise GuestNotFoundError(guest_id)
            if not (
                await s.execute(select(RoomTypeRow).where(RoomTypeRow.code == room_type))
            ).scalar_one_or_none():
                raise RoomTypeNotFoundError(room_type)
            if not (
                await s.execute(select(RatePlanRow).where(RatePlanRow.code == rate_plan))
            ).scalar_one_or_none():
                raise RatePlanNotFoundError(rate_plan)

            row = ReservationRow(
                id=f"res_{uuid.uuid4().hex[:12]}",
                guest_id=guest_id,
                room_type=room_type,
                rate_plan=rate_plan,
                check_in=check_in,
                check_out=check_out,
                guests=guests,
                num_pets=num_pets,
                status=ReservationStatus.CONFIRMED.value,
                modification_count=0,
                created_at=self._clock.now(),
            )
            s.add(row)
            await s.commit()
            await s.refresh(row)
            return _reservation_from_row(row)

    async def get(self, reservation_id: str) -> Reservation:
        async with self._session() as s:
            row = await s.get(ReservationRow, reservation_id)
        if row is None:
            raise ReservationNotFoundError(reservation_id)
        return _reservation_from_row(row)

    async def list_for_guest(
        self,
        guest_id: str,
        *,
        status: Optional[str] = None,
    ) -> list[Reservation]:
        async with self._session() as s:
            q = (
                select(ReservationRow)
                .where(ReservationRow.guest_id == guest_id)
                .order_by(ReservationRow.check_in)
            )
            if status is not None:
                q = q.where(ReservationRow.status == status)
            rows = (await s.execute(q)).scalars().all()
        return [_reservation_from_row(r) for r in rows]

    async def modify(self, reservation_id: str, changes: ReservationModify) -> Reservation:
        async with self._session() as s:
            row = await s.get(ReservationRow, reservation_id)
            if row is None:
                raise ReservationNotFoundError(reservation_id)

            if changes.check_in is not None:
                row.check_in = changes.check_in
            if changes.check_out is not None:
                row.check_out = changes.check_out
            if changes.room_type is not None:
                row.room_type = changes.room_type
            if changes.rate_plan is not None:
                row.rate_plan = changes.rate_plan
            if changes.guests is not None:
                row.guests = changes.guests
            if changes.num_pets is not None:
                row.num_pets = changes.num_pets

            # Cross-field validation — invalid post-state, not policy.
            if row.check_out <= row.check_in:
                raise InvalidDatesError(
                    f"After modification, check_out ({row.check_out}) "
                    f"would not be strictly after check_in ({row.check_in})"
                )

            row.modification_count = row.modification_count + 1
            await s.commit()
            await s.refresh(row)
            return _reservation_from_row(row)

    async def cancel(self, reservation_id: str) -> Reservation:
        async with self._session() as s:
            row = await s.get(ReservationRow, reservation_id)
            if row is None:
                raise ReservationNotFoundError(reservation_id)

            # Idempotent: re-cancelling returns the existing row.
            if row.status != ReservationStatus.CANCELLED.value:
                row.status = ReservationStatus.CANCELLED.value
                row.cancelled_at = self._clock.now()
                await s.commit()
                await s.refresh(row)
            return _reservation_from_row(row)


class FakeGuestsAPI(_BaseAPI):
    async def get(self, guest_id: str) -> Guest:
        async with self._session() as s:
            row = await s.get(GuestRow, guest_id)
        if row is None:
            raise GuestNotFoundError(guest_id)
        return _guest_from_row(row)

    async def get_by_email(self, email: str) -> Optional[Guest]:
        async with self._session() as s:
            row = (
                await s.execute(select(GuestRow).where(GuestRow.email == email))
            ).scalar_one_or_none()
        return _guest_from_row(row) if row else None


class FakeServicesAPI(_BaseAPI):
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        clock: Clock,
    ):
        super().__init__(session_factory)
        self._clock = clock

    async def add_to_reservation(
        self,
        reservation_id: str,
        service_code: str,
        *,
        when: Optional[datetime] = None,
    ) -> ServiceCharge:
        async with self._session() as s:
            res = await s.get(ReservationRow, reservation_id)
            if res is None:
                raise ReservationNotFoundError(reservation_id)
            catalog = await s.get(ServiceCatalogRow, service_code)
            if catalog is None:
                # ServiceCatalog isn't a domain type per se; raise a generic PMSError.
                from core.integrations.pms.protocol import PMSError

                raise PMSError(f"Service code not found: {service_code}")

            row = ServiceChargeRow(
                id=f"svc_{uuid.uuid4().hex[:12]}",
                reservation_id=reservation_id,
                service_code=service_code,
                description=catalog.description,
                amount=Decimal(catalog.default_amount),
                when=when if when is not None else self._clock.now(),
                status=ServiceTicketStatus.OPEN.value,
            )
            s.add(row)
            await s.commit()
            await s.refresh(row)
            return _service_charge_from_row(row)

    async def list_for_reservation(
        self,
        reservation_id: str,
    ) -> list[ServiceCharge]:
        async with self._session() as s:
            res = await s.get(ReservationRow, reservation_id)
            if res is None:
                raise ReservationNotFoundError(reservation_id)
            rows = (
                (
                    await s.execute(
                        select(ServiceChargeRow)
                        .where(ServiceChargeRow.reservation_id == reservation_id)
                        .order_by(ServiceChargeRow.when)
                    )
                )
                .scalars()
                .all()
            )
        return [_service_charge_from_row(r) for r in rows]


# ---- Aggregate ---------------------------------------------------------------


class FakePMS:
    """Composes the six sub-APIs into a single object that satisfies PMSClient.

    Attributes are annotated with the Protocol types (not the concrete Fake*
    classes) so FakePMS structurally matches PMSClient under invariance —
    Protocol mutable attributes are invariant, so the declared type must be
    exactly the Protocol type, not a subtype.
    """

    inventory: InventoryAPI
    rates: RatesAPI
    availability: AvailabilityAPI
    reservations: ReservationsAPI
    guests: GuestsAPI
    services: ServicesAPI

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        clock: Clock,
    ):
        rates = FakeRatesAPI(session_factory)
        self.inventory = FakeInventoryAPI(session_factory)
        self.rates = rates
        self.availability = FakeAvailabilityAPI(session_factory, rates)
        self.reservations = FakeReservationsAPI(session_factory, clock)
        self.guests = FakeGuestsAPI(session_factory)
        self.services = FakeServicesAPI(session_factory, clock)
