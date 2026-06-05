"""Adapter-level tests for the OpenAI Agents SDK runtime.

Each test synthesizes the JSON args a real LLM might emit, invokes the tool the
way the SDK would (``tool.on_invoke_tool`` via ``call_tool``), and asserts:

1. The expected ``deps.pms.*`` / ``deps.retriever`` method ran with the
   expected (parsed) args.
2. The DTO returned flowed back through the adapter as JSON.

No real LLM is invoked. No env vars are required. These mirror the Pydantic-AI
adapter tests so the two runtimes stay behaviorally aligned.
"""

from __future__ import annotations

from datetime import date

import pytest

from core.db.seed_data import (
    GUEST_EVE_ID,
    GUEST_SARAH_ID,
    RES_BOB_TOMORROW_ADV_ID,
    SEED_NOW,
)
from core.deps import AgentDeps


# --- Discovery ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_availability_calls_pms_with_parsed_dates(call_tool, deps: AgentDeps):
    out = await call_tool(
        deps,
        "search_availability",
        {"check_in": "2026-06-15", "check_out": "2026-06-17", "guests": 2},
    )
    assert isinstance(out, list) and len(out) > 0
    # Re-run the underlying call to confirm the args reached the PMS unchanged.
    offers = await deps.pms.availability.search(
        check_in=date(2026, 6, 15),
        check_out=date(2026, 6, 17),
        guests=2,
    )
    assert len(offers) == len(out)


@pytest.mark.asyncio
async def test_list_room_types(call_tool, deps: AgentDeps):
    out = await call_tool(deps, "list_room_types", {})
    assert isinstance(out, list) and len(out) >= 3, "seed exposes at least Standard/Deluxe/Suite"


# --- Booking ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_quote_stay_uses_current_user_id_for_tier_waivers(
    call_tool,
    pms,
    retriever,
    fixed_clock,
):
    """Platinum waives the resort fee. quote_stay must pass current_user_id so
    the PMS quote-engine applies that override."""
    eve_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id=GUEST_EVE_ID,  # Platinum
    )
    quote = await call_tool(
        eve_deps,
        "quote_stay",
        {
            "room_type": "STD",
            "rate_plan": "FLEX",
            "check_in": "2026-06-15",
            "check_out": "2026-06-17",
            "guests": 1,
        },
    )
    resort_lines = [ln for ln in quote["lines"] if "resort" in ln["label"].lower()]
    assert resort_lines, "quote must contain a resort-fee line"
    assert float(resort_lines[0]["amount"]) == 0, "Platinum should waive the resort fee"


@pytest.mark.asyncio
async def test_create_reservation_uses_current_user_id(call_tool, deps: AgentDeps):
    before = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)
    new = await call_tool(
        deps,
        "create_reservation",
        {
            "room_type": "STD",
            "rate_plan": "FLEX",
            "check_in": "2026-06-15",
            "check_out": "2026-06-17",
            "guests": 1,
        },
    )
    after = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)

    assert len(after) == len(before) + 1, "exactly one new reservation for Sarah"
    assert new["guest_id"] == GUEST_SARAH_ID
    assert new["room_type"] == "STD"


@pytest.mark.asyncio
async def test_view_my_reservations(call_tool, deps: AgentDeps):
    out = await call_tool(deps, "view_my_reservations", {})
    assert isinstance(out, list)
    assert all(r["guest_id"] == GUEST_SARAH_ID for r in out)


@pytest.mark.asyncio
async def test_modify_reservation_passes_partial_patch(
    call_tool,
    pms,
    retriever,
    fixed_clock,
):
    """A date-shift modification flows through the adapter as a partial patch."""
    bob_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id="guest_bob",
    )
    before = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)
    await call_tool(
        bob_deps,
        "modify_reservation",
        {
            "reservation_id": RES_BOB_TOMORROW_ADV_ID,
            "check_in": "2026-06-04",
            "check_out": "2026-06-06",
        },
    )
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.check_in == date(2026, 6, 4)
    assert after.check_out == date(2026, 6, 6)
    assert after.modification_count == before.modification_count + 1


@pytest.mark.asyncio
async def test_cancel_reservation_marks_cancelled(
    call_tool,
    pms,
    retriever,
    fixed_clock,
):
    bob_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id="guest_bob",
    )
    await call_tool(bob_deps, "cancel_reservation", {"reservation_id": RES_BOB_TOMORROW_ADV_ID})
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.status.value == "cancelled"
    assert after.cancelled_at is not None
    assert after.cancelled_at == SEED_NOW


# --- Q&A ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_answer_question_hits_retriever(call_tool, deps: AgentDeps):
    out = await call_tool(
        deps,
        "answer_question",
        {"query": "cancellation policy 24 hours", "k": 3},
    )
    assert isinstance(out, list) and len(out) > 0
    assert any("cancel" in c["text"].lower() for c in out)


# --- Profile ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_guest_profile_uses_current_user_id(
    call_tool,
    pms,
    retriever,
    fixed_clock,
):
    eve_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id=GUEST_EVE_ID,
    )
    out = await call_tool(eve_deps, "get_guest_profile", {})
    assert out["tier"] == "platinum"


# --- Validation behaviour -----------------------------------------------------


@pytest.mark.asyncio
async def test_bad_date_string_is_recoverable(call_tool, deps: AgentDeps):
    """A bad date is parsed inside the tool, so the adapter raises a ValueError
    that the SDK turns into a recoverable message (our ``_tool_error``) rather
    than a hard failure. The model can read it and retry."""
    out = await call_tool(
        deps,
        "search_availability",
        {"check_in": "next monday", "check_out": "2026-06-17", "guests": 2},
    )
    assert isinstance(out, str)
    assert "ISO 8601" in out
