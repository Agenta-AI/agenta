"""Running an evaluation with function workflows. (POC, does not run.)

`ag.aevaluate` accepts handles, pinned handles, and platform slugs
interchangeably. A bare handle means "use the default parameters". A pinned
handle (`.pin(...)`) means "use these baked-in parameters". A slug means "use
what is deployed on Agenta".

This is identical to the class proposal, with one simplification: there is no
"class vs instance" distinction. There is one kind of thing — a handle — and
`.pin()` produces another handle. Default and pinned are the same type.
"""

import asyncio

import agenta as ag

from application import hotel_agent  # 01_application.py
from evaluators import (  # 02_evaluators.py
    rubric_judge,
    starts_capitalized,
    stays_under_budget,
)


async def main():
    ag.init()

    result = await ag.aevaluate(
        name="hotel-agent-regression",
        # A testset slug from Agenta, or inline testcases. Columns map onto
        # the application's Inputs; extra columns (like expected_answer) flow
        # to the evaluators' inputs.
        testset="hotel-faq-v2",
        application=hotel_agent,
        evaluators=[
            starts_capitalized,
            rubric_judge.pin(judge_model="gpt-4.1"),
            stays_under_budget.pin(max_cost_usd=0.005),
            ag.evaluators.exact_match(correct_answer_key="expected_answer"),
        ],
    )

    print(result.url)  # link to the evaluation in the Agenta UI
    for scenario in result.scenarios:
        print(scenario.inputs, scenario.outputs, scenario.metrics)

    # Compare two configurations of the same application in one run. Both are
    # handles; the second is just a partial of the first.
    await ag.aevaluate(
        name="prompt-shootout",
        testset="hotel-faq-v2",
        applications=[
            hotel_agent,  # current defaults
            hotel_agent.pin(top_k=8),  # candidate config
        ],
        evaluators=[rubric_judge],
    )

    # Evaluate inline testcases without a stored testset. Handy in CI.
    await ag.aevaluate(
        application=hotel_agent,
        testcases=[
            {"message": "Do you have a pool?", "expected_answer": "Yes, 7am-10pm."},
            {"message": "Is parking free?", "expected_answer": "Yes, for guests."},
        ],
        evaluators=[starts_capitalized],
    )


if __name__ == "__main__":
    asyncio.run(main())
