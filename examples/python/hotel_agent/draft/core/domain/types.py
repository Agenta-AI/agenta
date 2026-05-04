"""Domain Pydantic types.

These are the data contracts every layer agrees on. The PMS Protocol returns
them; the FakePMS materializes them; runtime adapters serialize them for the
LLM. SQLAlchemy rows are mapped *into* these types inside the integration
layer — callers never see ORM objects.

Identifiers are strings, not UUIDs. Real PMSs return opaque ids whose format
we do not control.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class GuestTier(str, Enum):
    STANDARD = "standard"
    GOLD = "gold"
    PLATINUM = "platinum"


class RateType(str, Enum):
    """The three rate-plan kinds. See policy.md §3."""

    FLEXIBLE = "flexible"
    ADVANCE = "advance"
    NON_REFUNDABLE = "non_refundable"


class ReservationStatus(str, Enum):
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    COMPLETED = "completed"


class ServiceTicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class _ImmutableModel(BaseModel):
    """All domain types are frozen — mutation happens only through the PMS."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class Guest(_ImmutableModel):
    id: str
    email: str
    first_name: str
    last_name: str
    tier: GuestTier = GuestTier.STANDARD


class RoomType(_ImmutableModel):
    """A category of room (e.g. Standard, Deluxe, Suite)."""

    code: str
    name: str
    description: str
    base_capacity: int = Field(ge=1)
    max_capacity: int = Field(ge=1)
    base_nightly_rate: Decimal
    tier_rank: int = Field(
        ge=1,
        description="Higher is fancier. Used for upgrade-path comparisons.",
    )


class Room(_ImmutableModel):
    """A specific physical room."""

    id: str
    room_number: str
    room_type: str  # FK into RoomType.code
    is_pet_friendly: bool = False


class RatePlan(_ImmutableModel):
    """A rate plan is a sellable combination of price and policy."""

    code: str
    name: str
    rate_type: RateType
    discount_pct: Decimal = Field(
        default=Decimal("0"),
        description="Discount off the room type's base nightly rate. 0.15 = 15% off.",
    )


class Offer(_ImmutableModel):
    """A row in availability search results.

    The agent typically uses this to summarize options to the guest. To get
    the full all-in price including taxes/fees, it must call rates.quote().
    """

    room_type: str
    rate_plan: str
    nightly_rate: Decimal
    available_units: int = Field(ge=0)


class QuoteLine(_ImmutableModel):
    """One line in an itemized quote (room, tax, resort fee, pet fee, addon)."""

    label: str
    amount: Decimal
    detail: Optional[str] = None


class Quote(_ImmutableModel):
    """An itemized, all-in price quote.

    The contract: total == sum(lines.amount). Rendering this in the agent's
    response is what the policy refers to as "quoting all-in totals" (§4).
    """

    room_type: str
    rate_plan: str
    check_in: date
    check_out: date
    guests: int
    nights: int
    lines: tuple[QuoteLine, ...]
    total: Decimal


class Reservation(_ImmutableModel):
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
    created_at: datetime
    cancelled_at: Optional[datetime] = None


class ReservationModify(_ImmutableModel):
    """Patch shape for ReservationsAPI.modify().

    Any field that is None is left unchanged.
    """

    check_in: Optional[date] = None
    check_out: Optional[date] = None
    room_type: Optional[str] = None
    rate_plan: Optional[str] = None
    guests: Optional[int] = None
    num_pets: Optional[int] = None


class ServiceCharge(_ImmutableModel):
    """An ancillary charge or service request attached to a reservation.

    The seed catalog (`ServiceCatalogItem` in the DB) defines what `service_code`
    values are valid; the PMS does not enforce that contract here.
    """

    id: str
    reservation_id: str
    service_code: str
    description: str
    amount: Decimal
    when: datetime
    status: ServiceTicketStatus = ServiceTicketStatus.OPEN
