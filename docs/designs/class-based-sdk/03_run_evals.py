"""Running an evaluation with class applications and evaluators. (POC, does not run.)

`ag.aevaluate` accepts classes, configured instances, and platform slugs
interchangeably. A class means "use the default Parameters". An instance means
"use these pinned Parameters". A slug means "use what is deployed on Agenta".
"""

import asyncio

import agenta as ag

from application import HotelAgent  # 01_application.py
from evaluators import (
    RubricJudge,
    StartsCapitalized,
    StaysUnderBudget,
)  # 02_evaluators.py


async def main():
    ag.init()

    result = await ag.aevaluate(
        name="hotel-agent-regression",
        # A testset slug from Agenta, or inline testcases. Columns map onto
        # HotelAgent.Inputs; extra columns (like expected_answer) flow to the
        # evaluators' Inputs.
        testset="hotel-faq-v2",
        application=HotelAgent,
        evaluators=[
            StartsCapitalized,
            RubricJudge(parameters={"judge_model": "gpt-4.1"}),
            StaysUnderBudget(parameters={"max_cost_usd": 0.005}),
            ag.evaluators.ExactMatch(correct_answer_key="expected_answer"),
        ],
    )

    print(result.url)  # link to the evaluation in the Agenta UI
    for scenario in result.scenarios:
        print(scenario.inputs, scenario.outputs, scenario.metrics)

    # Compare two configurations of the same application in one run.
    await ag.aevaluate(
        name="prompt-shootout",
        testset="hotel-faq-v2",
        applications=[
            HotelAgent,  # current defaults
            HotelAgent(parameters={"top_k": 8}),  # candidate config
        ],
        evaluators=[RubricJudge],
    )

    # Evaluate inline testcases without a stored testset. Handy in CI.
    await ag.aevaluate(
        application=HotelAgent,
        testcases=[
            {"message": "Do you have a pool?", "expected_answer": "Yes, 7am-10pm."},
            {"message": "Is parking free?", "expected_answer": "Yes, for guests."},
        ],
        evaluators=[StartsCapitalized],
    )


if __name__ == "__main__":
    asyncio.run(main())
