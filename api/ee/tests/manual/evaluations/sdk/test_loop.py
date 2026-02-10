import asyncio
import random

from dotenv import load_dotenv

load_dotenv()

import agenta as ag  # noqa: E402

ag.init()

from agenta.sdk.decorators import application, evaluator  # noqa: E402
from agenta.sdk.workflows import builtin  # noqa: E402
from agenta.sdk.evaluations import aevaluate  # noqa: E402


my_testcases_data = [
    {
        "country": "Germany",
        "capital": "Berlin",
    },
    {
        "country": "France",
        "capital": "Paris",
    },
    {
        "country": "Spain",
        "capital": "Madrid",
    },
    {
        "country": "Italy",
        "capital": "Rome",
    },
]


@application(
    slug="my_application",
    #
    name="my_application",
    description="A simple workflow that returns the capital of a country",
    #
    parameters=dict(aloha="mahalo"),
)
async def my_application(capital: str, country: str):
    chance = random.choice([True, False, True])
    _outputs = capital if chance else "Aloha"

    return _outputs


@evaluator(
    slug="my_match_workflow",
    #
    name="my_match_workflow",
    description="A simple workflow that returns the capital of a country",
    #
    parameters=dict(aloha="mahalo"),
)
async def my_match_evaluator(capital: str, outputs: str):
    _outputs = {
        "score": outputs == capital and 1 or 0,
        "success": outputs == capital,
    }

    return _outputs


@evaluator(
    slug="my_random_evaluator",
    #
    name="my_random_evaluator",
    description="A simple evaluator that returns a random score",
)
async def my_random_evaluator(capital: str):
    score = random.randint(0, 100)
    _outputs = {
        "myscore": score,
        "success": score > 30,
    }

    return _outputs


my_llm_as_a_judge_evaluator = builtin.auto_ai_critique(
    slug="my_llm_as_a_judge_evaluator",
    #
    name="my_llm_as_a_judge_evaluator",
    description="Use an LLM to judge if the previous answer is correct",
    #
    correct_answer_key="capital",
    model="openai/gpt-4o-mini",
    prompt_template=[
        {
            "role": "system",
            "content": "You are a judge that evaluates if the previous answer is correct.",
        },
        {
            "role": "user",
            "content": (
                "The correct answer is {{capital}}.\n"
                "The previous answer is {{outputs}}.\n"
                "Is the previous answer correct? Answer with a decimal 'score' from 0.0 to 1.0. "
                "Nothing else, just a number, no boilerplate, nothing, JUST A FLOAT"
            ),
        },
    ],
)


async def run_evaluation():
    my_testset = await ag.testsets.aupsert(
        name="Capitals",
        #
        data=my_testcases_data,
    )

    if not my_testset or not my_testset.id:
        print("Failed to create or update testset")
        return None

    eval = await aevaluate(
        name="Capital Evaluation",
        description="An evaluation to test the capitals application",
        #
        testsets=[
            my_testset.id,
        ],
        applications=[
            my_application,
        ],
        evaluators=[
            my_match_evaluator,
            my_random_evaluator,
            my_llm_as_a_judge_evaluator,
        ],
    )

    return eval


async def main():
    eval_data = await run_evaluation()

    if not eval_data:
        exit(1)

    # await display(eval_data)


if __name__ == "__main__":
    asyncio.run(main())
