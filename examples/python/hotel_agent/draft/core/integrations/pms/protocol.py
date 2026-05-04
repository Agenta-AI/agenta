"""PMS Protocols — the contract every PMS implementation satisfies.

Six concerns, each its own Protocol, aggregated into ``PMSClient``. Callers
see one surface; implementations can split or share internal state.

Design rules (see architecture.md §The integration layer):

- The PMS does not enforce policy. ``cancel(reservation_id)`` always cancels
  if the reservation exists. The agent is responsible for refusing in
  policy-violating cases.

- Times are explicit. Time-sensitive operations either accept ``when`` or read
  from an injected Clock — never from ``datetime.now()`` directly.

- Identifiers are strings. Real PMSs return opaque ids whose format we do not
  control.

- Methods raise ``PMSError`` subclasses (not generic exceptions) so callers
  can distinguish "this row doesn't exist" from network errors etc.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional, Protocol, runtime_checkable

from core.domain import (
    Guest,
    Offer,
    Quote,
    RatePlan,
    Reservation,
    ReservationModify,
    RoomType,
    ServiceCharge,
)


# --- Exceptions ---------------------------------------------------------------


class PMSError(Exception):
    """Base for any error raised out of the PMS layer."""


class ReservationNotFoundError(PMSError):
    def __init__(self, reservation_id: str):
        self.reservation_id = reservation_id
        super().__init__(f"Reservation not found: {reservation_id}")


class GuestNotFoundError(PMSError):
    def __init__(self, guest_id: str):
        self.guest_id = guest_id
        super().__init__(f"Guest not found: {guest_id}")


class RoomTypeNotFoundError(PMSError):
    def __init__(self, room_type_code: str):
        self.room_type_code = room_type_code
        super().__init__(f"Room type not found: {room_type_code}")


class RatePlanNotFoundError(PMSError):
    def __init__(self, rate_plan_code: str):
        self.rate_plan_code = rate_plan_code
        super().__init__(f"Rate plan not found: {rate_plan_code}")


class InvalidDatesError(PMSError):
    """Raised when check-in is on/after check-out, or dates are otherwise invalid."""


# --- Sub-API Protocols --------------------------------------------------------


@runtime_checkable
class InventoryAPI(Protocol):
    async def list_room_types(self) -> list[RoomType]: ...
    async def get_room_type(self, code: str) -> RoomType: ...


@runtime_checkable
class RatesAPI(Protocol):
    async def list_rate_plans(
        self,
        *,
        room_type: Optional[str] = None,
    ) -> list[RatePlan]: ...

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
        """All-in itemized price.

        ``guest_id`` is optional so anonymous browsing works; if supplied, the
        quote applies any tier-based fee waivers (e.g. Platinum resort fee per
        policy.md §4).
        """
        ...


@runtime_checkable
class AvailabilityAPI(Protocol):
    async def search(
        self,
        *,
        check_in: date,
        check_out: date,
        guests: int,
        room_type: Optional[str] = None,
        pet_friendly_only: bool = False,
    ) -> list[Offer]: ...


@runtime_checkable
class ReservationsAPI(Protocol):
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
    ) -> Reservation: ...

    async def get(self, reservation_id: str) -> Reservation: ...

    async def list_for_guest(
        self,
        guest_id: str,
        *,
        status: Optional[str] = None,
    ) -> list[Reservation]: ...

    async def modify(
        self,
        reservation_id: str,
        changes: ReservationModify,
    ) -> Reservation:
        """Apply patch and increment modification_count.

        Does NOT enforce the 2-modification cap or the 48h window — those are
        agent-side policy concerns.
        """
        ...

    async def cancel(self, reservation_id: str) -> Reservation:
        """Mark CANCELLED. Does NOT enforce cutoff. Does not re-cancel."""
        ...


@runtime_checkable
class GuestsAPI(Protocol):
    async def get(self, guest_id: str) -> Guest: ...
    async def get_by_email(self, email: str) -> Optional[Guest]: ...


@runtime_checkable
class ServicesAPI(Protocol):
    async def add_to_reservation(
        self,
        reservation_id: str,
        service_code: str,
        *,
        when: Optional[datetime] = None,
    ) -> ServiceCharge:
        """Attach a service charge. ``when`` defaults to clock.now() if not given."""
        ...

    async def list_for_reservation(
        self,
        reservation_id: str,
    ) -> list[ServiceCharge]: ...


# --- Aggregate Protocol -------------------------------------------------------


class PMSClient(Protocol):
    """The single surface every runtime adapter sees."""

    inventory: InventoryAPI
    rates: RatesAPI
    availability: AvailabilityAPI
    reservations: ReservationsAPI
    guests: GuestsAPI
    services: ServicesAPI
