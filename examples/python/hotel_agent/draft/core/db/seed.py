"""Loader: walks the constants in seed_data.py and writes them to a fresh DB.

The loader is mechanical. To extend the seed, add entries in seed_data.py;
do NOT add bespoke logic here.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from core.db import seed_data as S
from core.db.tables import (
    GuestRow,
    RatePlanRow,
    ReservationRow,
    RoomRow,
    RoomTypeRow,
    ServiceCatalogRow,
    ServiceChargeRow,
)


async def seed_database(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Populate a freshly-created schema with deterministic seed data."""

    async with session_factory() as session:
        # Order matters: parents before children.
        for g in S.GUESTS:
            session.add(
                GuestRow(
                    id=g.id,
                    email=g.email,
                    first_name=g.first_name,
                    last_name=g.last_name,
                    tier=g.tier.value,
                )
            )
        for rt in S.ROOM_TYPES:
            session.add(
                RoomTypeRow(
                    code=rt.code,
                    name=rt.name,
                    description=rt.description,
                    base_capacity=rt.base_capacity,
                    max_capacity=rt.max_capacity,
                    base_nightly_rate=rt.base_nightly_rate,
                    tier_rank=rt.tier_rank,
                )
            )
        for rp in S.RATE_PLANS:
            session.add(
                RatePlanRow(
                    code=rp.code,
                    name=rp.name,
                    rate_type=rp.rate_type.value,
                    discount_pct=rp.discount_pct,
                )
            )
        for room in S.ROOMS:
            session.add(
                RoomRow(
                    id=room.id,
                    room_number=room.room_number,
                    room_type=room.room_type,
                    is_pet_friendly=room.is_pet_friendly,
                )
            )
        for svc in S.SERVICE_CATALOG:
            session.add(
                ServiceCatalogRow(
                    code=svc.code,
                    description=svc.description,
                    default_amount=svc.default_amount,
                )
            )
        for res in S.RESERVATIONS:
            session.add(
                ReservationRow(
                    id=res.id,
                    guest_id=res.guest_id,
                    room_type=res.room_type,
                    rate_plan=res.rate_plan,
                    check_in=res.check_in,
                    check_out=res.check_out,
                    guests=res.guests,
                    num_pets=res.num_pets,
                    status=res.status.value,
                    modification_count=res.modification_count,
                    created_at=res.created_at,
                )
            )
        for charge in S.SERVICE_CHARGES:
            session.add(
                ServiceChargeRow(
                    id=charge.id,
                    reservation_id=charge.reservation_id,
                    service_code=charge.service_code,
                    description=charge.description,
                    amount=charge.amount,
                    when=charge.when,
                    status=charge.status,
                )
            )
        await session.commit()
