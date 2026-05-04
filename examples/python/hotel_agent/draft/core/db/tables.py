"""SQLAlchemy schema backing the FakePMS.

Tables map closely to the domain types in ``core.domain``. The mapping itself
lives in ``core.integrations.pms.fake`` — these tables are the storage; the
domain types are the contract.

All FK columns use string ids to mirror what real PMSs expose.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class GuestRow(Base):
    __tablename__ = "guests"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String)
    last_name: Mapped[str] = mapped_column(String)
    tier: Mapped[str] = mapped_column(String, default="standard")


class RoomTypeRow(Base):
    __tablename__ = "room_types"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    base_capacity: Mapped[int] = mapped_column(Integer)
    max_capacity: Mapped[int] = mapped_column(Integer)
    base_nightly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    tier_rank: Mapped[int] = mapped_column(Integer)


class RatePlanRow(Base):
    __tablename__ = "rate_plans"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    rate_type: Mapped[str] = mapped_column(String)
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0"))


class RoomRow(Base):
    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    room_number: Mapped[str] = mapped_column(String, unique=True)
    room_type: Mapped[str] = mapped_column(String, ForeignKey("room_types.code"))
    is_pet_friendly: Mapped[bool] = mapped_column(Boolean, default=False)


class ReservationRow(Base):
    __tablename__ = "reservations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    guest_id: Mapped[str] = mapped_column(String, ForeignKey("guests.id"), index=True)
    room_type: Mapped[str] = mapped_column(String, ForeignKey("room_types.code"))
    rate_plan: Mapped[str] = mapped_column(String, ForeignKey("rate_plans.code"))
    check_in: Mapped[date] = mapped_column(Date)
    check_out: Mapped[date] = mapped_column(Date)
    guests: Mapped[int] = mapped_column(Integer)
    num_pets: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="confirmed")
    modification_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    charges: Mapped[list["ServiceChargeRow"]] = relationship(
        back_populates="reservation",
        cascade="all, delete-orphan",
    )


class ServiceCatalogRow(Base):
    """Catalog of service codes the hotel offers (late checkout, housekeeping, etc.)."""

    __tablename__ = "service_catalog"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str] = mapped_column(Text)
    default_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))


class ServiceChargeRow(Base):
    __tablename__ = "service_charges"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    reservation_id: Mapped[str] = mapped_column(String, ForeignKey("reservations.id"), index=True)
    service_code: Mapped[str] = mapped_column(String, ForeignKey("service_catalog.code"))
    description: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    when: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, default="open")

    reservation: Mapped[ReservationRow] = relationship(back_populates="charges")
