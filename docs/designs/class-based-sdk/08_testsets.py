"""Testsets as classes. (POC, does not run.)

A testset class declares its columns as a Pydantic model. That buys:
- the platform validates rows against the schema, on upload and on edit
- typed iteration in code, no dict["colunm_typo"] surprises
- fail-fast compatibility checks: before an evaluation runs anything, the
  testset columns are checked against the application's Inputs and every
  evaluator's Inputs

The schema compiles into the same JSON Schema machinery as everything else
in this POC, so the testset UI can render typed cells (numbers, enums,
nested JSON) instead of treating every column as text.
"""

import asyncio

from pydantic import BaseModel, Field

import agenta as ag

from application import HotelAgent  # 01_application.py
from evaluators import RubricJudge  # 02_evaluators.py


class HotelFAQ(ag.Testset):
    slug = "hotel-faq"
    name = "Hotel FAQ"

    class Case(BaseModel):
        """One row. Becomes the testset's column schema."""

        message: str
        persona: str = "guest"
        expected_answer: str
        difficulty: int = Field(1, ge=1, le=3)

    # Optional seed data, committed with the class on first push.
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

    # Typed access. Editors keep working in the UI; this pulls their edits.
    testset = await HotelFAQ.afetch()
    for case in testset:
        print(case.message, case.difficulty)

    # Append programmatically, validated against Case.
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
