"""ag.Testset — NOT a Workflow. (POC, does not run.)

Diff this against ../function-based-sdk/08_testsets.py (functional original) and
../class-based-sdk/08_testsets.py (class proposal).

A testset is shaped differently from the runnable workflows: an inner `Case`
model (the row schema) + optional `cases` seed data, no Parameters and no
handler. It is absent from `WorkflowFlags` and does NOT subclass `Workflow`. In
00_core.py it gets its own tiny base, separate from the Application/Evaluator/
Configuration front-ends. That separation is the point: the type hierarchy
matches the data model instead of forcing a non-workflow under `Workflow`.

PART B is ../class-based-sdk/08_testsets.py running verbatim on the shim.
"""

from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

import agenta as ag

from core import Testset  # 00_core.py — its own base, NOT a Workflow

from application import HotelAgent  # 01_application.py (the compatibility check)
from evaluators import RubricJudge  # 02_evaluators.py

# =========================================================================
# PART A — no base to define. ag.Testset is the standalone Testset base from
# 00_core.py (deliberately not under Workflow), bound onto `ag`.
# =========================================================================

ag.Testset = Testset  # type: ignore[attr-defined]


# =========================================================================
# PART B — ../../class-based-sdk/08_testsets.py, verbatim, on the shim.
# =========================================================================


class HotelFAQ(ag.Testset):
    slug = "hotel-faq"
    name = "Hotel FAQ"

    class Case(BaseModel):
        """One row. Becomes the testset's column schema."""

        message: str
        persona: str = "guest"
        expected_answer: str
        difficulty: int = Field(1, ge=1, le=3)

    cases = [
        Case(
            message="Do you have a pool?",
            expected_answer="Yes, open 7am to 10pm.",
        ),
        Case(
            message="Can I check in at 6am?",
            expected_answer="Early check-in depends on availability.",
            difficulty=2,
        ),
    ]


async def main():
    ag.init()

    await HotelFAQ.apush()

    testset = await HotelFAQ.afetch()
    for case in testset:
        print(case.message, case.difficulty)

    await HotelFAQ.aadd(
        cases=[HotelFAQ.Case(message="Is parking free?", expected_answer="Yes.")]
    )

    # Curate from production traces: map spans onto typed cases.
    await HotelFAQ.afrom_traces(
        filter=ag.TraceFilter(
            application="hotel-agent", annotations={"thumbs": "down"}
        ),
        map=lambda span: HotelFAQ.Case(
            message=span.inputs["message"],
            expected_answer=span.annotations["corrected_answer"],
        ),
    )

    # The payoff: compatibility is checked before anything runs.
    #   HotelFAQ.Case covers HotelAgent.Inputs (message, persona)?      yes
    #   HotelFAQ.Case covers RubricJudge.Inputs (expected_answer)?      yes
    # A missing or mistyped column raises here, not after 200 LLM calls.
    await ag.aevaluate(
        testset=HotelFAQ,
        application=HotelAgent,
        evaluators=[RubricJudge],
    )

    # Mismatches fail loudly and early:
    #
    #   await ag.aevaluate(testset=HotelFAQ, application=FlightAgent, ...)
    #   IncompatibleTestsetError: FlightAgent.Inputs requires column
    #   'origin' (str); testset 'hotel-faq' has columns
    #   [message, persona, expected_answer, difficulty]


if __name__ == "__main__":
    asyncio.run(main())
