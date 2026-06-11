"""Testsets as functions. (POC, does not run.)

A testset declares its columns as a Pydantic model, passed to `ag.testset(...)`.
That buys exactly what the class version buys:
- the platform validates rows against the schema, on upload and on edit
- typed iteration in code, no dict["colunm_typo"] surprises
- fail-fast compatibility checks: before an evaluation runs anything, the
  testset columns are checked against the application's inputs and every
  evaluator's inputs

The schema compiles into the same JSON Schema machinery as everything else in
this POC, so the testset UI can render typed cells (numbers, enums, nested
JSON) instead of treating every column as text.

`ag.testset()` returns a handle with `.push`, `.fetch`, `.add`, `.from_traces`
— the same handle shape as applications and evaluators. The row model is a
module-level type you reference directly, so there is no `Class.Case`
namespacing to reach for.
"""

import asyncio
from typing import Optional

from pydantic import BaseModel, Field

import agenta as ag

from application import hotel_agent  # 01_application.py
from evaluators import rubric_judge  # 02_evaluators.py


class HotelFAQCase(BaseModel):
    """One row. Becomes the testset's column schema."""

    message: str
    persona: str = "guest"
    expected_answer: str
    difficulty: Optional[int] = Field(1, ge=1, le=3)


hotel_faq = ag.testset(
    slug="hotel-faq",
    name="Hotel FAQ",
    case=HotelFAQCase,
    # Optional seed data, committed on first push.
    cases=[
        HotelFAQCase(
            message="Do you have a pool?",
            expected_answer="Yes, open 7am to 10pm.",
        ),
        HotelFAQCase(
            message="Can I check in at 6am?",
            expected_answer="Early check-in depends on availability.",
            difficulty=2,
        ),
    ],
)


async def main():
    ag.init()

    await hotel_faq.push()

    # Typed access. Editors keep working in the UI; this pulls their edits.
    testset = await hotel_faq.fetch()
    for case in testset:
        print(case.message, case.difficulty)

    # Append programmatically, validated against HotelFAQCase.
    await hotel_faq.add(
        cases=[HotelFAQCase(message="Is parking free?", expected_answer="Yes.")]
    )

    # Curate from production traces: map spans onto typed cases.
    await hotel_faq.from_traces(
        filter=ag.TraceFilter(
            application="hotel-agent", annotations={"thumbs": "down"}
        ),
        map=lambda span: HotelFAQCase(
            message=span.inputs["message"],
            expected_answer=span.annotations["corrected_answer"],
        ),
    )

    # The payoff: compatibility is checked before anything runs.
    #   HotelFAQCase covers hotel_agent's inputs (message, persona)?     yes
    #   HotelFAQCase covers rubric_judge's inputs (expected_answer)?      yes
    # A missing or mistyped column raises here, not after 200 LLM calls.
    await ag.aevaluate(
        testset=hotel_faq,
        application=hotel_agent,
        evaluators=[rubric_judge],
    )

    # Mismatches fail loudly and early:
    #
    #   await ag.aevaluate(testset=hotel_faq, application=flight_agent, ...)
    #   IncompatibleTestsetError: flight_agent inputs require column
    #   'origin' (str); testset 'hotel-faq' has columns
    #   [message, persona, expected_answer, difficulty]


if __name__ == "__main__":
    asyncio.run(main())
