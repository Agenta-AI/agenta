"""Running evals — identical to the class version, because consuming a handle
is the same whether it came from a class or a function. (POC, does not run.)

Diff this against ../function-based-sdk/03_run_evals.py and
../class-based-sdk/03_run_evals.py. This file defines no base — it imports the
class workflows from 01/02 (which are sugar over the functional core) and uses
them. There is nothing kind-specific here; the three folders converge.
"""

import asyncio

import agenta as ag

from application import HotelAgent  # 01_application.py (class over functional core)
from evaluators import (  # 02_evaluators.py
    RubricJudge,
    StartsCapitalized,
    StaysUnderBudget,
)


async def main():
    ag.init()

    result = await ag.aevaluate(
        name="hotel-agent-regression",
        testset="hotel-faq-v2",
        application=HotelAgent,
        evaluators=[
            StartsCapitalized,
            RubricJudge(parameters={"judge_model": "gpt-4.1"}),
            StaysUnderBudget(parameters={"max_cost_usd": 0.005}),
            ag.evaluators.ExactMatch(correct_answer_key="expected_answer"),
        ],
    )

    print(result.url)
    for scenario in result.scenarios:
        print(scenario.inputs, scenario.outputs, scenario.metrics)

    # Compare two configurations of the same application in one run.
    await ag.aevaluate(
        name="prompt-shootout",
        testset="hotel-faq-v2",
        applications=[
            HotelAgent,  # current defaults
            HotelAgent(parameters={"top_k": 8}),  # candidate config (pin)
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
