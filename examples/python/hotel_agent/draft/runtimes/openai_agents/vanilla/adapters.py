"""Tool adapters: thin shims over ``AgentDeps`` for the OpenAI Agents SDK agent.

This mirrors ``runtimes/pydanticai/vanilla/adapters.py`` one-for-one. Same 11
tools, same names, same docstrings — so the system prompt, the frontend tool
rendering, and the Agenta config all line up across runtimes. Only the binding
mechanism differs:

- The first parameter is ``RunContextWrapper[AgentDeps]``. The SDK detects this
  by type and hides it from the LLM-facing schema; ``ctx.context`` is the
  ``AgentDeps`` we pass as ``Runner.run(..., context=deps)``.
- Tools return a **JSON string**. The Agents SDK only converts known structured
  shapes; anything else is ``str()``- d (Python repr) before the model sees it.
  Returning JSON keeps the model input clean and lets the frontend re-parse it.
- Date arguments are typed as ``str`` (ISO 8601 ``YYYY-MM-DD``) and parsed
  inside. A bad date raises ``ValueError``; ``_tool_error`` turns it into a
  message the model can recover from, the same intent as Pydantic-AI's
  ``ModelRetry``.

Policy is NOT enforced here. Refusal logic lives in the system prompt.
"""

from __future__ import annotations

import json
from datetime import date
from functools import partial
from typing import Any, Optional

from agents import RunContextWrapper, function_tool
from pydantic import BaseModel

from core.deps import AgentDeps
from core.domain import ReservationModify
from core.integrations.pms.protocol import PMSError


# --- serialization ------------------------------------------------------------


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _dump(value: Any) -> str:
    """Serialize a domain DTO (or list of them) to a JSON string for the model."""
    return json.dumps(_jsonable(value), default=str)


def _tool_error(ctx: RunContextWrapper[AgentDeps], error: Exception) -> str:
    """Surface the real error text to the model instead of a generic message."""
    return f"Tool error: {error}"


# ``@hotel_tool`` == ``@function_tool`` with our error handler wired in, so the
# model sees actionable messages (e.g. a date-format hint) and can retry.
hotel_tool = partial(function_tool, failure_error_function=_tool_error)


# --- helpers ------------------------------------------------------------------


def _parse_date(label: str, value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as e:
        raise ValueError(f"{label} must be ISO 8601 (YYYY-MM-DD), got {value!r}") from e


# --- Discovery ----------------------------------------------------------------


@hotel_tool
async def search_availability(
    ctx: RunContextWrapper[AgentDeps],
    check_in: str,
    check_out: str,
    guests: int,
    room_type: Optional[str] = None,
    pet_friendly_only: bool = False,
) -> str:
    """Search available rooms by date range. Returns nightly base rate per option.

    Use ``quote_stay`` afterwards to get the all-in price including taxes/fees.
    """
    offers = await ctx.context.pms.availability.search(
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        room_type=room_type,
        pet_friendly_only=pet_friendly_only,
    )
    return _dump(offers)


@hotel_tool
async def list_room_types(ctx: RunContextWrapper[AgentDeps]) -> str:
    """List every sellable room type with capacity, base rate, and tier rank.

    Use this to compare options or to identify a single-tier-up room for
    upgrade conversations.
    """
    return _dump(await ctx.context.pms.inventory.list_room_types())


# --- Booking lifecycle --------------------------------------------------------


@hotel_tool
async def quote_stay(
    ctx: RunContextWrapper[AgentDeps],
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    num_pets: int = 0,
) -> str:
    """Get an itemized all-in quote (room + tax + resort fee + pet fee).

    Always quote before confirming a booking. Tier-based fee waivers are
    applied automatically when the current guest qualifies (Platinum waives
    resort fee).
    """
    quote = await ctx.context.pms.rates.quote(
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        num_pets=num_pets,
        guest_id=ctx.context.current_user_id,
    )
    return _dump(quote)


@hotel_tool
async def create_reservation(
    ctx: RunContextWrapper[AgentDeps],
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    num_pets: int = 0,
) -> str:
    """Confirm and persist a booking for the current guest.

    Only call after the guest has accepted the all-in quote from
    ``quote_stay``. The PMS does not re-verify policy (pet limits, capacity
    caps) — the agent is responsible for refusing on policy grounds first.
    """
    reservation = await ctx.context.pms.reservations.create(
        guest_id=ctx.context.current_user_id,
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=_parse_date("check_in", check_in),
        check_out=_parse_date("check_out", check_out),
        guests=guests,
        num_pets=num_pets,
    )
    return _dump(reservation)


@hotel_tool
async def view_my_reservations(
    ctx: RunContextWrapper[AgentDeps],
    status: Optional[str] = None,
) -> str:
    """List the current guest's reservations.

    Optional ``status`` filter: confirmed | cancelled | no_show | completed.
    """
    reservations = await ctx.context.pms.reservations.list_for_guest(
        ctx.context.current_user_id,
        status=status,
    )
    return _dump(reservations)


@hotel_tool
async def modify_reservation(
    ctx: RunContextWrapper[AgentDeps],
    reservation_id: str,
    check_in: Optional[str] = None,
    check_out: Optional[str] = None,
    room_type: Optional[str] = None,
    rate_plan: Optional[str] = None,
    guests: Optional[int] = None,
    num_pets: Optional[int] = None,
) -> str:
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
    return _dump(await ctx.context.pms.reservations.modify(reservation_id, changes))


@hotel_tool
async def cancel_reservation(
    ctx: RunContextWrapper[AgentDeps],
    reservation_id: str,
) -> str:
    """Cancel a reservation. Sets status=cancelled and stamps cancelled_at.

    The agent must check the cancellation cutoff and the rate-type refund
    rules before calling. Cancelling inside the cutoff or a non-refundable
    rate must be refused (or escalated). The PMS will not refuse for policy.
    Idempotent — re-cancelling returns the existing row unchanged.
    """
    return _dump(await ctx.context.pms.reservations.cancel(reservation_id))


# --- In-stay services ---------------------------------------------------------


@hotel_tool
async def request_service(
    ctx: RunContextWrapper[AgentDeps],
    reservation_id: str,
    service_code: str,
) -> str:
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
    charge = await ctx.context.pms.services.add_to_reservation(reservation_id, service_code)
    return _dump(charge)


# --- Q&A ----------------------------------------------------------------------


@hotel_tool
async def answer_question(
    ctx: RunContextWrapper[AgentDeps],
    query: str,
    k: int = 5,
) -> str:
    """Search the knowledge base (policy rationales, amenities, FAQ, neighborhood).

    Use for *rationales*, *examples*, and edge-case context. Don't use for the
    *rules* themselves — those are in the system prompt and are authoritative.
    """
    return _dump(await ctx.context.retriever.search(query, k=k))


# --- Profile ------------------------------------------------------------------


@hotel_tool
async def get_guest_profile(ctx: RunContextWrapper[AgentDeps]) -> str:
    """Look up the current guest's profile (name, email, tier).

    Use the returned ``tier`` to decide whether tier-based overrides apply
    (Gold/Platinum cancellation cutoffs, Platinum resort-fee waiver, etc.).
    """
    try:
        guest = await ctx.context.pms.guests.get(ctx.context.current_user_id)
    except PMSError as e:
        raise ValueError(f"Could not load guest profile: {e}") from e
    return _dump(guest)


# --- Rates --------------------------------------------------------------------


@hotel_tool
async def list_rate_plans(
    ctx: RunContextWrapper[AgentDeps],
    room_type: Optional[str] = None,
) -> str:
    """List active rate plans, optionally filtered to one room type.

    Use this to surface tradeoffs (Flexible vs Advance vs Non-refundable) and
    cite the discount percentage when comparing.
    """
    return _dump(await ctx.context.pms.rates.list_rate_plans(room_type=room_type))


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
