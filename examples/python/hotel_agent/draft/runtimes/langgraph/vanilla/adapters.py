"""Tool adapters: thin shims over ``AgentDeps`` for the LangChain agent.

LangChain 1.0 injects per-run dependencies through ``ToolRuntime``: any tool
parameter typed ``ToolRuntime`` is filled by the framework and excluded from the
LLM-facing schema. We pass an ``AgentDeps`` instance as the run ``context`` (see
``agent.py``), so every tool reads ``runtime.context`` to reach the PMS,
retriever, and clock.

Each function is a 5-to-15-line wrapper that:

- Receives ``runtime: ToolRuntime`` from LangChain.
- Parses the LLM-emitted args into core domain types where useful.
- Calls the appropriate ``deps.pms.*`` or ``deps.retriever.*`` method.
- Returns a JSON string. LangChain places it verbatim in the ToolMessage the
  model reads back; the server also re-parses it for the chat UI.

Date arguments are typed as ``str`` (ISO 8601 ``YYYY-MM-DD``) and parsed inside.
``create_agent`` re-raises tool exceptions instead of feeding them back to the
model, so a bad date is caught here and returned as a graceful error string the
LLM can react to (rather than crashing the run).

Policy is NOT enforced here. Refusal logic lives in the system prompt.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Optional

from langchain.tools import ToolRuntime, tool

from core.deps import AgentDeps
from core.domain import ReservationModify
from core.integrations.pms.protocol import PMSError


# --- helpers ------------------------------------------------------------------


class _BadInput(Exception):
    """Raised on un-parseable tool arguments. Caught inside the tool body."""


def _parse_date(label: str, value: str) -> date:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError) as e:
        raise _BadInput(f"{label} must be ISO 8601 (YYYY-MM-DD), got {value!r}") from e


def _dump(value: Any) -> str:
    """Serialize a domain DTO (or list of them) to a JSON string for the LLM."""

    def one(o: Any) -> Any:
        return o.model_dump(mode="json") if hasattr(o, "model_dump") else o

    data = [one(o) for o in value] if isinstance(value, list) else one(value)
    return json.dumps(data, default=str)


def _err(message: str) -> str:
    return json.dumps({"error": message})


def _deps(runtime: ToolRuntime) -> AgentDeps:
    return runtime.context


# --- Discovery ----------------------------------------------------------------


@tool
async def search_availability(
    check_in: str,
    check_out: str,
    guests: int,
    runtime: ToolRuntime,
    room_type: Optional[str] = None,
    pet_friendly_only: bool = False,
) -> str:
    """Search available rooms by date range. Returns nightly base rate per option.

    Use ``quote_stay`` afterwards to get the all-in price including taxes/fees.
    """
    try:
        ci = _parse_date("check_in", check_in)
        co = _parse_date("check_out", check_out)
    except _BadInput as e:
        return _err(str(e))
    offers = await _deps(runtime).pms.availability.search(
        check_in=ci,
        check_out=co,
        guests=guests,
        room_type=room_type,
        pet_friendly_only=pet_friendly_only,
    )
    return _dump(offers)


@tool
async def list_room_types(runtime: ToolRuntime) -> str:
    """List every sellable room type with capacity, base rate, and tier rank.

    Use this to compare options or to identify a single-tier-up room for
    upgrade conversations.
    """
    return _dump(await _deps(runtime).pms.inventory.list_room_types())


# --- Booking lifecycle --------------------------------------------------------


@tool
async def quote_stay(
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    runtime: ToolRuntime,
    num_pets: int = 0,
) -> str:
    """Get an itemized all-in quote (room + tax + resort fee + pet fee).

    Always quote before confirming a booking. Tier-based fee waivers are
    applied automatically when the current guest qualifies (Platinum waives
    resort fee).
    """
    try:
        ci = _parse_date("check_in", check_in)
        co = _parse_date("check_out", check_out)
    except _BadInput as e:
        return _err(str(e))
    deps = _deps(runtime)
    quote = await deps.pms.rates.quote(
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=ci,
        check_out=co,
        guests=guests,
        num_pets=num_pets,
        guest_id=deps.current_user_id,
    )
    return _dump(quote)


@tool
async def create_reservation(
    room_type: str,
    rate_plan: str,
    check_in: str,
    check_out: str,
    guests: int,
    runtime: ToolRuntime,
    num_pets: int = 0,
) -> str:
    """Confirm and persist a booking for the current guest.

    Only call after the guest has accepted the all-in quote from
    ``quote_stay``. The PMS does not re-verify policy (pet limits, capacity
    caps) — the agent is responsible for refusing on policy grounds first.
    """
    try:
        ci = _parse_date("check_in", check_in)
        co = _parse_date("check_out", check_out)
    except _BadInput as e:
        return _err(str(e))
    deps = _deps(runtime)
    reservation = await deps.pms.reservations.create(
        guest_id=deps.current_user_id,
        room_type=room_type,
        rate_plan=rate_plan,
        check_in=ci,
        check_out=co,
        guests=guests,
        num_pets=num_pets,
    )
    return _dump(reservation)


@tool
async def view_my_reservations(runtime: ToolRuntime, status: Optional[str] = None) -> str:
    """List the current guest's reservations.

    Optional ``status`` filter: confirmed | cancelled | no_show | completed.
    """
    deps = _deps(runtime)
    reservations = await deps.pms.reservations.list_for_guest(
        deps.current_user_id,
        status=status,
    )
    return _dump(reservations)


@tool
async def modify_reservation(
    reservation_id: str,
    runtime: ToolRuntime,
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
    try:
        changes = ReservationModify(
            check_in=_parse_date("check_in", check_in) if check_in else None,
            check_out=_parse_date("check_out", check_out) if check_out else None,
            room_type=room_type,
            rate_plan=rate_plan,
            guests=guests,
            num_pets=num_pets,
        )
    except _BadInput as e:
        return _err(str(e))
    reservation = await _deps(runtime).pms.reservations.modify(reservation_id, changes)
    return _dump(reservation)


@tool
async def cancel_reservation(reservation_id: str, runtime: ToolRuntime) -> str:
    """Cancel a reservation. Sets status=cancelled and stamps cancelled_at.

    The agent must check the cancellation cutoff and the rate-type refund
    rules before calling. Cancelling inside the cutoff or a non-refundable
    rate must be refused (or escalated). The PMS will not refuse for policy.
    Idempotent — re-cancelling returns the existing row unchanged.
    """
    return _dump(await _deps(runtime).pms.reservations.cancel(reservation_id))


# --- In-stay services ---------------------------------------------------------


@tool
async def request_service(reservation_id: str, service_code: str, runtime: ToolRuntime) -> str:
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
    charge = await _deps(runtime).pms.services.add_to_reservation(reservation_id, service_code)
    return _dump(charge)


# --- Q&A ----------------------------------------------------------------------


@tool
async def answer_question(query: str, runtime: ToolRuntime, k: int = 5) -> str:
    """Search the knowledge base (policy rationales, amenities, FAQ, neighborhood).

    Use for *rationales*, *examples*, and edge-case context. Don't use for the
    *rules* themselves — those are in the system prompt and are authoritative.
    """
    return _dump(await _deps(runtime).retriever.search(query, k=k))


# --- Profile ------------------------------------------------------------------


@tool
async def get_guest_profile(runtime: ToolRuntime) -> str:
    """Look up the current guest's profile (name, email, tier).

    Use the returned ``tier`` to decide whether tier-based overrides apply
    (Gold/Platinum cancellation cutoffs, Platinum resort-fee waiver, etc.).
    """
    deps = _deps(runtime)
    try:
        return _dump(await deps.pms.guests.get(deps.current_user_id))
    except PMSError as e:
        return _err(f"Could not load guest profile: {e}")


# --- Rates --------------------------------------------------------------------


@tool
async def list_rate_plans(runtime: ToolRuntime, room_type: Optional[str] = None) -> str:
    """List active rate plans, optionally filtered to one room type.

    Use this to surface tradeoffs (Flexible vs Advance vs Non-refundable) and
    cite the discount percentage when comparing.
    """
    return _dump(await _deps(runtime).pms.rates.list_rate_plans(room_type=room_type))


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
