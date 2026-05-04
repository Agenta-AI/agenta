"""Domain types — the shared vocabulary every layer uses.

Pure Pydantic data bags, no behavior. Mirrors what a real PMS adapter would
parse out of HTTP responses.
"""

from core.domain.types import (
    GuestTier,
    RateType,
    ReservationStatus,
    ServiceTicketStatus,
    Guest,
    RoomType,
    Room,
    RatePlan,
    Offer,
    QuoteLine,
    Quote,
    Reservation,
    ReservationModify,
    ServiceCharge,
)

__all__ = [
    "GuestTier",
    "RateType",
    "ReservationStatus",
    "ServiceTicketStatus",
    "Guest",
    "RoomType",
    "Room",
    "RatePlan",
    "Offer",
    "QuoteLine",
    "Quote",
    "Reservation",
    "ReservationModify",
    "ServiceCharge",
]
