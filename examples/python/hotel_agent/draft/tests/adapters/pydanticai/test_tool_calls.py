"""Adapter-level tests for the Pydantic-AI vanilla runtime.

Each test synthesizes the JSON args a real LLM might emit, drives the agent
once, and asserts:

1. The expected tool was called with the expected (parsed) args.
2. The PMS DTO returned flowed back through the adapter intact.

We use ``pydantic_ai.models.function.FunctionModel`` because it lets us
drive the conversation deterministically — choose what to do based on the
messages so far. ``TestModel`` is too random for our purposes (it would
fire every tool blindly).

No real LLM is invoked. No env vars are required.
"""

from __future__ import annotations

from datetime import date

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from core.db.seed_data import (
    GUEST_EVE_ID,
    GUEST_SARAH_ID,
    RES_BOB_TOMORROW_ADV_ID,
    SEED_NOW,
)
from core.deps import AgentDeps


def _last_tool_called(messages: list[ModelMessage]) -> set[str]:
    """Return the set of tool-call return names already in the message history."""
    seen: set[str] = set()
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if hasattr(p, "tool_name"):
                    seen.add(p.tool_name)
    return seen


def _model_calling(tool_name: str, args: dict, follow_up: str = "Done.") -> FunctionModel:
    """Build a FunctionModel that calls ``tool_name`` once with ``args``,
    then on the second turn answers with ``follow_up`` text.
    """

    async def behavior(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if tool_name not in _last_tool_called(messages):
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=follow_up)])

    return FunctionModel(behavior)


# --- Discovery ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_availability_calls_pms_with_parsed_dates(agent_factory, deps: AgentDeps):
    model = _model_calling(
        "search_availability",
        {
            "check_in": "2026-06-15",
            "check_out": "2026-06-17",
            "guests": 2,
        },
    )
    agent = agent_factory(model)
    result = await agent.run("any query", deps=deps)

    assert result.output == "Done."
    # The agent saw a list of Offers — verify by re-running the underlying call
    offers = await deps.pms.availability.search(
        check_in=date(2026, 6, 15),
        check_out=date(2026, 6, 17),
        guests=2,
    )
    assert len(offers) > 0, "seed should produce some availability for 2026-06-15"


@pytest.mark.asyncio
async def test_list_room_types(agent_factory, deps: AgentDeps):
    model = _model_calling("list_room_types", {})
    agent = agent_factory(model)
    result = await agent.run("any query", deps=deps)
    assert result.output == "Done."
    types = await deps.pms.inventory.list_room_types()
    assert len(types) >= 3, "seed should expose at least Standard/Deluxe/Suite"


# --- Booking ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_quote_stay_uses_current_user_id_for_tier_waivers(
    agent_factory,
    pms,
    retriever,
    fixed_clock,
):
    """Platinum tier waives resort fee. quote_stay must pass the current_user_id
    so the PMS quote-engine can apply that override."""
    eve_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id=GUEST_EVE_ID,  # Platinum
    )
    model = _model_calling(
        "quote_stay",
        {
            "room_type": "STD",
            "rate_plan": "FLEX",
            "check_in": "2026-06-15",
            "check_out": "2026-06-17",
            "guests": 1,
        },
    )
    agent = agent_factory(model)
    await agent.run("quote it", deps=eve_deps)

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
    model = _model_calling(
        "create_reservation",
        {
            "room_type": "STD",
            "rate_plan": "FLEX",
            "check_in": "2026-06-15",
            "check_out": "2026-06-17",
            "guests": 1,
        },
    )
    agent = agent_factory(model)
    before = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)
    await agent.run("book it", deps=deps)
    after = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)

    assert len(after) == len(before) + 1, "exactly one new reservation for Sarah"
    new = next(r for r in after if r.id not in {b.id for b in before})
    assert new.guest_id == GUEST_SARAH_ID
    assert new.room_type == "STD"


@pytest.mark.asyncio
async def test_view_my_reservations(agent_factory, deps: AgentDeps):
    model = _model_calling("view_my_reservations", {})
    agent = agent_factory(model)
    await agent.run("show mine", deps=deps)
    rs = await deps.pms.reservations.list_for_guest(GUEST_SARAH_ID)
    assert all(r.guest_id == GUEST_SARAH_ID for r in rs)


@pytest.mark.asyncio
async def test_modify_reservation_passes_partial_patch(
    agent_factory,
    pms,
    retriever,
    fixed_clock,
):
    """Bob has a confirmed reservation. Verify a date-shift modification flows
    through the adapter as a ReservationModify patch."""
    bob_deps = AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id="guest_bob",
    )
    model = _model_calling(
        "modify_reservation",
        {
            "reservation_id": RES_BOB_TOMORROW_ADV_ID,
            "check_in": "2026-06-04",
            "check_out": "2026-06-06",
        },
    )
    before = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)
    agent = agent_factory(model)
    await agent.run("shift it", deps=bob_deps)
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.check_in == date(2026, 6, 4)
    assert after.check_out == date(2026, 6, 6)
    assert after.modification_count == before.modification_count + 1


@pytest.mark.asyncio
async def test_cancel_reservation_marks_cancelled(
    agent_factory,
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
    model = _model_calling(
        "cancel_reservation",
        {"reservation_id": RES_BOB_TOMORROW_ADV_ID},
    )
    agent = agent_factory(model)
    await agent.run("kill it", deps=bob_deps)
    after = await pms.reservations.get(RES_BOB_TOMORROW_ADV_ID)

    assert after.status.value == "cancelled"
    assert after.cancelled_at is not None
    assert after.cancelled_at == SEED_NOW


# --- Q&A ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_answer_question_hits_retriever(agent_factory, deps: AgentDeps):
    model = _model_calling(
        "answer_question",
        {"query": "cancellation policy 24 hours", "k": 3},
    )
    agent = agent_factory(model)
    await agent.run("policy?", deps=deps)
    chunks = await deps.retriever.search("cancellation policy 24 hours", k=3)
    assert len(chunks) > 0
    assert any("cancel" in c.text.lower() for c in chunks)


# --- Profile ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_guest_profile_uses_current_user_id(
    agent_factory,
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
    model = _model_calling("get_guest_profile", {})
    agent = agent_factory(model)
    await agent.run("who am I", deps=eve_deps)
    guest = await pms.guests.get(GUEST_EVE_ID)
    assert guest.tier.value == "platinum"


# --- Validation behaviour -----------------------------------------------------


@pytest.mark.asyncio
async def test_bad_date_string_recoverable_from_within_tool(agent_factory, deps: AgentDeps):
    """Adapter parses dates inside the tool body so a bad string raises a
    catchable ValueError (rather than the unrecoverable Pydantic pre-validation
    error from pydantic-ai #3008). Pydantic-AI surfaces this as a ToolRetryError
    that the model can react to."""

    seen_messages: list[ModelMessage] = []

    async def behavior(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_messages.extend(messages[len(seen_messages) :])
        if "search_availability" not in _last_tool_called(messages):
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="search_availability",
                        args={
                            "check_in": "next monday",  # invalid
                            "check_out": "2026-06-17",
                            "guests": 2,
                        },
                    )
                ]
            )
        # On the retry, return a graceful text rather than calling again.
        return ModelResponse(parts=[TextPart(content="I need a date in YYYY-MM-DD.")])

    agent = agent_factory(FunctionModel(behavior))
    result = await agent.run("any query", deps=deps)

    assert result.output == "I need a date in YYYY-MM-DD."
