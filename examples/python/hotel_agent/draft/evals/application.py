"""The LangGraph vanilla agent, wrapped as an Agenta application.

`call_setup()` (in `tracing`) turns on the OpenInference LangChain
instrumentation, so the agent run emits a real trace: the workflow span, the
LangGraph chain, each ChatOpenAI call, and each tool call, every one with inputs
and outputs. Evaluators read which tools ran from those real spans.

The application takes `message` and `persona` from a test case, runs the agent,
and returns the answer string.

Determinism: `build_default_deps` defaults to `SystemClock`, but the seed data is
anchored at `SEED_NOW`. We pin `FixedClock(SEED_NOW)` so cutoff and timing
reasoning match the fixtures, and build a fresh seeded database per case so writes
do not leak across cases.
"""

from __future__ import annotations

import agenta as ag

from core.clock import FixedClock
from core.container import build_default_deps
from core.db.seed_data import SEED_NOW
from runtimes.langgraph.vanilla import agent, build_input_messages

from .tracing import call_setup

__all__ = ["call_setup", "hotel_langgraph_vanilla"]


@ag.application(
    slug="hotel_langgraph_vanilla",
    name="Hotel Agent (LangGraph, vanilla)",
    description="Concierge agent over the shared core, no Agenta prompt management.",
)
async def hotel_langgraph_vanilla(message: str, persona: str = "guest_sarah") -> str:
    deps = await build_default_deps(
        current_user_id=persona,
        clock=FixedClock(SEED_NOW),
    )
    messages = await build_input_messages(deps, history=[], user_msg=message)
    # Handle the agent's own errors so one failing case is recorded as a failed
    # answer rather than crashing the whole run. The released SDK does not isolate
    # a raising application: a thrown exception makes `aevaluate` abort later in
    # `metrics.arefresh` with an opaque IndexError (status.md issue 1). Catching
    # here keeps the run going and still surfaces the failure in the scores.
    try:
        result = await agent.ainvoke({"messages": messages}, context=deps)
    except Exception as e:  # noqa: BLE001
        return f"<agent error: {e}>"
    msgs = result["messages"]
    return msgs[-1].content if msgs else ""
