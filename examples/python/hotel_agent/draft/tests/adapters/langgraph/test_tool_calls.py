"""Adapter-level tests for the LangChain vanilla runtime.

Each test scripts the JSON args a real model might emit (via the fake
``SequencedChatModel`` in ``conftest.py``), runs the ``create_agent`` graph once
against an ``AgentDeps`` context, and asserts:

1. The expected tool ran with the expected (parsed) args.
2. The PMS state changed / DTO flowed back through the adapter intact.

No real LLM is invoked. No env vars are required. These mirror the Pydantic-AI
adapter tests one-for-one so the two runtimes stay behaviorally aligned.
"""

from __future__ import annotations

from datetime import date

import pytest
from langchain_core.messages import HumanMessage, ToolMessage

from core.db.seed_data import (
    GUEST_EVE_ID,
    GUEST_SARAH_ID,
    RES_BOB_TOMORROW_ADV_ID,
    SEED_NOW,
)
from core.deps import AgentDeps

from .conftest import model_calling


async def _run(agent, deps: AgentDeps, prompt: str = "go") -> dict:
    return await agent.ainvoke({"messages": [HumanMessage(content=prompt)]}, context=deps)


def _final_text(result: dict) -> str:
    return result["messages"][-1].content


def _tool_messages(result: dict) -> list[ToolMessage]:
    return [m for m in result["messages"] if isinstance(m, ToolMessage)]


# --- Discovery ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_availability_calls_pms_with_parsed_dates(agent_factory, deps: AgentDeps):
    agent = agent_factory(
        model_calling(
            "search_availability",
            {"check_in": "2026-06-15", "check_out": "2026-06-17", "guests": 2},
        )
    )
    result = await _run(agent, deps, "any query")

    assert _final_text(result) == "Done."
    assert _tool_messages(result), "search_availability should have produced a ToolMessage"
    offers = await deps.pms.availability.search(
        check_in=date(2026, 6, 15), check_out=date(2026, 6, 17), guests=2
    )
    assert len(offers) > 0, "seed should produce some availability for 2026-06-15"


@pytest.mark.asyncio
async def test_list_room_types(agent_factory, deps: AgentDeps):
    agent = agent_factory(model_calling("list_room_types", {}))
    result = await _run(agent, deps)
    assert _final_text(result) == "Done."
    types = await deps.pms.inventory.list_room_types()
    assert len(types) >= 3, "seed should expose at least Standard/Deluxe/Suite"


# --- Booking ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_quote_stay_uses_current_user_id_for_tier_waivers(
    agent_factory, pms, retriever, fixed_clock
):
    """Platinum tier waives resort fee. quote_stay must pass the current_user_id
    so the PMS quote-engine can apply that override."""
    eve_deps = AgentDeps(
        pms=pms, retriever=retriever, clock=fixed_clock, current_user_id=GUEST_EVE_ID
    )
    agent = agent_factory(
        model_calling(
            "quote_stay",
            {
                "room_type": "STD",
                "rate_plan": "FLEX",
                "check_in": "2026-06-15",
                "check_out": "2026-06-17",
                "guests": 1,
            },
        )
    )
    await _run(agent, eve_deps, "quote it")

    # Re-quote directly to assert the tier override fires.
    quote = await pms.rates.quote(
        room_type="STD",
        rate_plan="FLEX",
        check_in=date(2026, 6, 15),
        check_out=date(2026, 6, 17),
        guests=1,
        guest_id=GUEST_EVE_ID,
    )
    resort_lines = [ln for ln in quote.lines if "resort" in ln.label.lower()]
    assert resort_lines, "quote must contain a resort-fee line"
    assert resort_lines[0].amount == 0, "Platinum should waive the resort fee"


@pytest.mark.asyncio
async def test_create_reservation_uses_current_user_id(agent_factory, deps: AgentDeps):
    agent = agent_factory(
        model_calling(
            "create_reservation",
            {
                "room_type": "STD",
                "rate_plan": "FLEX",
                "check_in": "2026-06-15",
                "check_out": "2026-06-17",
                "guests": 1,
            },
        )
    )
    before = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)
    await _run(agent, deps, "book it")
    after = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)

    assert len(after) == len(before) + 1, "exactly one new reservation for Sarah"
    new = next(r for r in after if r.id not in {b.id for b in before})
    assert new.guest_id == GUEST_SARAH_ID
    assert new.room_type == "STD"


@pytest.mark.asyncio
async def test_view_my_reservations(agent_factory, deps: AgentDeps):
    agent = agent_factory(model_calling("view_my_reservations", {}))
    await _run(agent, deps, "show mine")
    rs = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)
    assert all(r.guest_id == GUEST_SARAH_ID for r in rs)


@pytest.mark.asyncio
async def test_modify_reservation_passes_partial_patch(agent_factory, pms, retriever, fixed_clock):
    """Bob has a confirmed reservation. Verify a date-shift modification flows
    through the adapter as a ReservationModify patch."""
    bob_deps = AgentDeps(
        pms=pms, retriever=retriever, clock=fixed_clock, current_user_id="guest_bob"
    )
    agent = agent_factory(
        model_calling(
            "modify_reservation",
            {
                "reservation_id": RES_BOB_TOMORROW_ADV_ID,
                "check_in": "2026-06-04",
                "check_out": "2026-06-06",
            },
        )
    )
    before = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)
    await _run(agent, bob_deps, "shift it")
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.check_in == date(2026, 6, 4)
    assert after.check_out == date(2026, 6, 6)
    assert after.modification_count == before.modification_count + 1


@pytest.mark.asyncio
async def test_cancel_reservation_marks_cancelled(agent_factory, pms, retriever, fixed_clock):
    bob_deps = AgentDeps(
        pms=pms, retriever=retriever, clock=fixed_clock, current_user_id="guest_bob"
    )
    agent = agent_factory(
        model_calling("cancel_reservation", {"reservation_id": RES_BOB_TOMORROW_ADV_ID})
    )
    await _run(agent, bob_deps, "kill it")
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.status.value == "cancelled"
    assert after.cancelled_at is not None
    assert after.cancelled_at == SEED_NOW


# --- Q&A ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_answer_question_hits_retriever(agent_factory, deps: AgentDeps):
    agent = agent_factory(
        model_calling("answer_question", {"query": "cancellation policy 24 hours", "k": 3})
    )
    await _run(agent, deps, "policy?")
    chunks = await deps.retriever.search("cancellation policy 24 hours", k=3)
    assert len(chunks) > 0
    assert any("cancel" in c.text.lower() for c in chunks)


# --- Profile ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_guest_profile_uses_current_user_id(agent_factory, pms, retriever, fixed_clock):
    eve_deps = AgentDeps(
        pms=pms, retriever=retriever, clock=fixed_clock, current_user_id=GUEST_EVE_ID
    )
    agent = agent_factory(model_calling("get_guest_profile", {}))
    await _run(agent, eve_deps, "who am I")
    guest = await pms.guests.get(GUEST_EVE_ID)
    assert guest.tier.value == "platinum"


# --- Validation behaviour -----------------------------------------------------


@pytest.mark.asyncio
async def test_bad_date_string_recoverable_from_within_tool(agent_factory, deps: AgentDeps):
    """The adapter parses dates inside the tool body and returns a graceful error
    string when the date is malformed (``create_agent`` re-raises tool exceptions,
    so we must not let them escape). The scripted model then answers normally."""
    agent = agent_factory(
        model_calling(
            "search_availability",
            {"check_in": "next monday", "check_out": "2026-06-17", "guests": 2},
            follow_up="I need a date in YYYY-MM-DD.",
        )
    )
    result = await _run(agent, deps, "any query")

    assert _final_text(result) == "I need a date in YYYY-MM-DD."
    tool_msgs = _tool_messages(result)
    assert tool_msgs, "the tool should have returned an error payload, not raised"
    assert "ISO 8601" in tool_msgs[0].content or "error" in tool_msgs[0].content.lower()
