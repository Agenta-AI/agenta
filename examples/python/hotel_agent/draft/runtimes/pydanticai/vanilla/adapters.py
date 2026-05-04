"""Tool adapters: thin shims over ``AgentDeps`` for the Pydantic-AI agent.

Each function is a 5-to-15-line wrapper that:

- Receives ``RunContext[AgentDeps]`` from Pydantic-AI.
- Parses the LLM-emitted args into core domain types where useful.
- Calls the appropriate ``deps.pms.*`` or ``deps.retriever.*`` method.
- Returns the unmodified Pydantic DTO. Pydantic-AI serializes for the LLM.

Date arguments are typed as ``str`` (ISO 8601 ``YYYY-MM-DD``) and parsed inside,
because Pydantic-AI's pre-tool validation is unrecoverable (pydantic-ai #3008);
parsing inside lets us return a graceful error string the LLM can react to.

Policy is NOT enforced here. Refusal logic lives in the system prompt.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic_ai import ModelRetry, RunContext

from core.deps import AgentDeps
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
from core.integrations.pms.protocol import PMSError
from core.retrieval import Chunk


# --- helpers ------------------------------------------------------------------


def _parse_date(label: str, value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as e:
        raise ModelRetry(f"{label} must be ISO 8601 (YYYY-MM-DD), got {value!r}") from e


# --- Discovery ----------------------------------------------------------------


async def search_availability(
    ctx: RunContext[AgentDeps],
    check_in: str,
    check_out: str,
    guests: int,
    room_type: Optional[str] = None,
    pet_friendly_only: bool = False,
) -> list[Offer]:
    """Search available rooms by date range. Returns nightly base rate per option.

    Use ``quote_stay`` afterwards to get the all-in price including taxes/fees.
    """
    return await ctx.deps.pms.availability.search(
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        room_type=room_type,
        pet_friendly_only=pet_friendly_only,
    )


async def list_room_types(ctx: RunContext[AgentDeps]) -> list[RoomType]:
    """List every sellable room type with capacity, base rate, and tier rank.

    Use this to compare options or to identify a single-tier-up room for
    upgrade conversations.
    """
    return await ctx.deps.pms.inventory.list_room_types()


# --- Booking lifecycle --------------------------------------------------------


async def quote_stay(
    ctx: RunContext[AgentDeps],
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    num_pets: int = 0,
) -> Quote:
    """Get an itemized all-in quote (room + tax + resort fee + pet fee).

    Always quote before confirming a booking. Tier-based fee waivers are
    applied automatically when the current guest qualifies (Platinum waives
    resort fee).
    """
    return await ctx.deps.pms.rates.quote(
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        num_pets=num_pets,
        guest_id=ctx.deps.current_user_id,
    )


async def create_reservation(
    ctx: RunContext[AgentDeps],
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    num_pets: int = 0,
) -> Reservation:
    """Confirm and persist a booking for the current guest.

    Only call after the guest has accepted the all-in quote from
    ``quote_stay``. The PMS does not re-verify policy (pet limits, capacity
    caps) — the agent is responsible for refusing on policy grounds first.
    """
    return await ctx.deps.pms.reservations.create(
        guest_id=ctx.deps.current_user_id,
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        num_pets=num_pets,
    )


async def view_my_reservations(
    ctx: RunContext[AgentDeps],
    status: Optional[str] = None,
) -> list[Reservation]:
    """List the current guest's reservations.

    Optional ``status`` filter: confirmed | cancelled | no_show | completed.
    """
    return await ctx.deps.pms.reservations.list_for_guest(
        ctx.deps.current_user_id,
        status=status,
    )


async def modify_reservation(
    ctx: RunContext[AgentDeps],
    reservation_id: str,
    check_in: Optional[str] = None,
    check_out: Optional[str] = None,
    room_type: Optional[str] = None,
    rate_plan: Optional[str] = None,
    guests: Optional[int] = None,
    num_pets: Optional[int] = None,
) -> Reservation:
    """Apply a patch to an existing reservation. Increments modification_count.

    The agent must check the modification cap (2) and the 48h free-modification
    window before calling. The PMS will not refuse for policy reasons.
    """
    changes = ReservationModify(
        check_in=_parse_date("check_in", check_in) if check_in else None,
        check_out=_parse_date("check_out", check_out) if check_out else None,
        room_type=room_type,
        rate_plan=rate_plan,
        guests=guests,
        num_pets=num_pets,
    )
    return await ctx.deps.pms.reservations.modify(reservation_id, changes)


async def cancel_reservation(
    ctx: RunContext[AgentDeps],
    reservation_id: str,
) -> Reservation:
    """Cancel a reservation. Sets status=cancelled and stamps cancelled_at.

    The agent must check the cancellation cutoff and the rate-type refund
    rules before calling. Cancelling inside the cutoff or a non-refundable
    rate must be refused (or escalated). The PMS will not refuse for policy.
    Idempotent — re-cancelling returns the existing row unchanged.
    """
    return await ctx.deps.pms.reservations.cancel(reservation_id)


# --- In-stay services ---------------------------------------------------------


async def request_service(
    ctx: RunContext[AgentDeps],
    reservation_id: str,
    service_code: str,
) -> ServiceCharge:
    """File an in-stay service ticket (housekeeping, late checkout, etc.).

    The fee is read from the service catalog by ``service_code``. The agent
    must enforce policy (e.g., late-checkout tier overrides) before calling.
    Common service codes:

    - ``late_checkout_1pm`` (free) / ``late_checkout_2pm`` (free for Gold/Platinum,
      $25 for Standard) / ``late_checkout_3pm`` / ``late_checkout_4pm``
    - ``housekeeping_request`` (free)
    - ``wakeup_call`` (free)
    - ``maintenance_report`` (free)
    """
    return await ctx.deps.pms.services.add_to_reservation(reservation_id, service_code)


# --- Q&A ----------------------------------------------------------------------


async def answer_question(
    ctx: RunContext[AgentDeps],
    query: str,
    k: int = 5,
) -> list[Chunk]:
    """Search the knowledge base (policy rationales, amenities, FAQ, neighborhood).

    Use for *rationales*, *examples*, and edge-case context. Don't use for the
    *rules* themselves — those are in the system prompt and are authoritative.
    """
    return await ctx.deps.retriever.search(query, k=k)


# --- Profile ------------------------------------------------------------------


async def get_guest_profile(ctx: RunContext[AgentDeps]) -> Guest:
    """Look up the current guest's profile (name, email, tier).

    Use the returned ``tier`` to decide whether tier-based overrides apply
    (Gold/Platinum cancellation cutoffs, Platinum resort-fee waiver, etc.).
    """
    try:
        return await ctx.deps.pms.guests.get(ctx.deps.current_user_id)
    except PMSError as e:
        raise ValueError(f"Could not load guest profile: {e}") from e


# --- Rates --------------------------------------------------------------------


async def list_rate_plans(
    ctx: RunContext[AgentDeps],
    room_type: Optional[str] = None,
) -> list[RatePlan]:
    """List active rate plans, optionally filtered to one room type.

    Use this to surface tradeoffs (Flexible vs Advance vs Non-refundable) and
    cite the discount percentage when comparing.
    """
    return await ctx.deps.pms.rates.list_rate_plans(room_type=room_type)


# --- Registration -------------------------------------------------------------


ALL_TOOLS = (
    # Discovery
    search_availability,
    list_room_types,
    # Booking
    quote_stay,
    create_reservation,
    view_my_reservations,
    modify_reservation,
    cancel_reservation,
    # In-stay
    request_service,
    # Q&A
    answer_question,
    # Profile
    get_guest_profile,
    # Rates
    list_rate_plans,
)


def register_tools(agent) -> None:
    """Attach all 11 tools to a Pydantic-AI ``Agent`` instance.

    Exposed as a function so tests can build a fresh ``Agent`` and override
    its model without reusing module state.
    """
    for fn in ALL_TOOLS:
        agent.tool(fn)
