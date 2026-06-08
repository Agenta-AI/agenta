"""Run the LangGraph evals against Agenta.

    cd examples/python/hotel_agent/draft
    uv run python evals/run.py

Needs draft/.env populated with OPENAI_API_KEY, AGENTA_API_KEY, AGENTA_HOST.
The testset is upserted by name, so re-running updates it in place rather than
piling up duplicates.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")
sys.path.insert(0, str(_DRAFT_ROOT))

import agenta as ag  # noqa: E402
from agenta.sdk.evaluations import aevaluate  # noqa: E402

from evals.application import call_setup, hotel_langgraph_vanilla  # noqa: E402
from evals.evaluators import (  # noqa: E402
    faithful_pricing,
    rubric_correctness,
    tool_usage,
)
from evals.summarize import main as summarize  # noqa: E402
from evals.testset import TESTCASES  # noqa: E402

TESTSET_NAME = "hotel-langgraph-eval-v1"


async def main() -> None:
    call_setup()  # ag.init() plus LangChain instrumentation

    testset = await ag.testsets.aupsert(name=TESTSET_NAME, data=TESTCASES)
    print(f"Testset: {testset.name} ({len(TESTCASES)} cases) revision={testset.id}")

    result = await aevaluate(
        name="LangGraph vanilla: rubrics, tools, faithful pricing",
        description="12 single-turn cases. Per-case rubrics, tool assertions, price faithfulness.",
        testsets=[testset.id],
        applications=[hotel_langgraph_vanilla],
        evaluators=[rubric_correctness, tool_usage, faithful_pricing],
    )

    run_id = str(result["run"].id)
    print(f"\nRun id: {run_id}")
    print(f"Status: {getattr(result['metrics'], 'status', 'see UI')}")

    # Per-case, per-evaluator breakdown, read back from the run's traces.
    summarize(run_id)


if __name__ == "__main__":
    asyncio.run(main())
