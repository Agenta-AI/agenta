import asyncio
import random

from dotenv import load_dotenv

load_dotenv()

import agenta as ag  # noqa: E402

ag.init()

from agenta.sdk.decorators import application, evaluator  # noqa: E402
from agenta.sdk.workflows import builtin  # noqa: E402
from agenta.sdk.evaluations import aevaluate  # noqa: E402

from agents import Runner  # noqa: E402
from agents.exceptions import InputGuardrailTripwireTriggered  # noqa: E402

from openai_agent import triage_agent  # noqa: E402

from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor  # noqa: E402

OpenAIAgentsInstrumentor().instrument()


my_testcases_data = [
    {
        "question": "What is agenta?",
        "rubic": "The answer should mention llmops platform and open-source",
        "guardrail": False,
    },
    {
        "question": "How much does agenta cost?",
        "rubic": "The answer should mention the three pricing tiers, the cost in usd, how much traces costs, retention periods, features,  and the free tier",
        "guardrail": False,
    },
    {
        "question": "How do I use azure in Agenta?",
        "rubic": "The answer should mention the azure provider and the steps to set it up in the model hub",
        "guardrail": False,
    },
    {
        "question": "What is the meaning of life?",
        "rubic": "The agent should refuse to answer",
        "guardrail": True,
    },
]


@application(
    slug="agenta_agent",
    #
    name="agenta_agent",
    description="A simple workflow that returns the answer to a question",
)
async def agenta_agent(
    question: str,
):
    try:
        outputs = await Runner.run(triage_agent, question)
        return outputs.final_output
    except InputGuardrailTripwireTriggered:
        return "I'm sorry, I can't answer that question."


@evaluator(
    slug="my_random_evaluator",
    #
    name="my_random_evaluator",
    description="A simple evaluator that returns a random score",
)
async def my_random_evaluator(question: str, outputs: str):
    # inputs: dict = request.data.inputs  # type:ignore
    score = random.randint(0, 100)
    _outputs = {
        "myscore": score,
        "success": score > 30,
    }

    return _outputs


@evaluator(
    slug="guardrail_span_evaluator",
    #
    name="guardrail_span_evaluator",
    description="Evaluates if the agent's guardrail logic was correctly triggered by inspecting the trace for the 'is_agenta_question' flag.",
)
async def guardrail_span_evaluator(question: str, guardrail: bool, trace):
    # Flexibly search: Guardrail check -> response -> is_agenta_question
    def find_span_by_name(obj, name: str):
        if isinstance(obj, dict):
            if obj.get("span_name") == name:
                return obj
            for value in obj.values():
                found = find_span_by_name(value, name)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = find_span_by_name(item, name)
                if found is not None:
                    return found
        return None

    def find_value_by_key(obj, key: str):
        if isinstance(obj, dict):
            if key in obj:
                return obj[key]
            for value in obj.values():
                found = find_value_by_key(value, key)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = find_value_by_key(item, key)
                if found is not None:
                    return found
        return None

    guardrail_span = find_span_by_name(trace, "Guardrail check")
    response_span = (
        find_span_by_name(guardrail_span, "response") if guardrail_span else None
    )
    detected_is_agenta = (
        find_value_by_key(response_span, "is_agenta_question")
        if response_span
        else None
    )

    expected_is_agenta = not bool(guardrail)
    success = (
        detected_is_agenta is not None
        and bool(detected_is_agenta) == expected_is_agenta
    )

    return {
        "success": success,
        "score": 1 if success else 0,
    }


my_llm_as_a_judge_evaluator = builtin.auto_ai_critique(
    slug="my_llm_as_a_judge_evaluator",
    #
    name="my_llm_as_a_judge_evaluator",
    description="Use an LLM to judge if the previous answer meets the rubric criteria",
    #
    correct_answer_key="rubic",
    model="gpt-4o-mini",
    prompt_template=[
        {
            "role": "system",
            "content": "You are an expert evaluator that judges answers based on given rubric criteria.",
        },
        {
            "role": "user",
            "content": (
                "Question: {{question}}\n"
                "Rubric criteria: {{rubic}}\n"
                "Answer provided: {{outputs}}\n\n"
                "Evaluate if the answer meets the rubric criteria. Answer with a decimal 'score' from 0.0 to 1.0. "
                "Nothing else, just a number, no boilerplate, nothing, JUST A FLOAT"
            ),
        },
    ],
)


async def run_evaluation():
    my_testset = await ag.testsets.aupsert(
        name="Agenta Questions",
        #
        data=my_testcases_data,
    )

    if not my_testset or not my_testset.id:
        print("Failed to create or update testset")
        return None

    eval = await aevaluate(
        testsets=[
            my_testset.id,
        ],
        applications=[
            agenta_agent,
        ],
        evaluators=[
            my_random_evaluator,
            guardrail_span_evaluator,
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
