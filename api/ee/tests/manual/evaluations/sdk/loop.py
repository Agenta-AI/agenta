import asyncio
import random
import json

from evaluate import (
    evaluate,
    EvaluateSpecs,
)
from definitions import (
    ApplicationRevision,
    ApplicationServiceRequest,
    EvaluatorRevision,
    EvaluatorServiceRequest,
)


dataset = [
    {"country": "Germany", "capital": "Berlin"},
    {"country": "France", "capital": "Paris"},
    {"country": "Spain", "capital": "Madrid"},
    {"country": "Italy", "capital": "Rome"},
]


async def my_application(
    revision: ApplicationRevision,
    request: ApplicationServiceRequest,
    **kwargs,
):
    inputs: dict = request.data.inputs  # type:ignore
    chance = random.choice([True, False])
    outputs = {
        "capital": (inputs.get("capital") if chance else "Aloha"),
    }

    return outputs


async def my_evaluator(
    revision: EvaluatorRevision,
    request: EvaluatorServiceRequest,
    **kwargs,
):
    inputs: dict = request.data.inputs  # type:ignore
    trace_outputs: dict = request.data.trace_outputs  # type:ignore
    outputs = {
        "success": trace_outputs.get("capital") == inputs.get("capital"),
    }

    return outputs


async def run_evaluation():
    specs = EvaluateSpecs(
        testset_steps=[dataset],
        application_steps=[my_application],
        evaluator_steps=[my_evaluator],
    )

    eval = await evaluate(specs)

    return eval


# export AGENTA_API_URL=http://localhost/api
# export AGENTA_API_KEY=xxxxxxxx

if __name__ == "__main__":
    eval = asyncio.run(run_evaluation())

    if not eval:
        exit(1)

    print()
    print("Displaying evaluation")
    print(f"run_id={eval['run'].id}")  # type:ignore

    for scenario in eval["scenarios"]:
        print("       " f"scenario_id={scenario['scenario'].id}")  # type:ignore
        for step_key, result in scenario["results"].items():  # type:ignore
            if result.testcase_id:
                print(
                    "                   "
                    f"step_key={str(step_key).ljust(32)}, testcase_id={result.testcase_id}",
                )
            elif result.trace_id:
                print(
                    "                   "
                    f"step_key={str(step_key).ljust(32)},    trace_id={result.trace_id}",
                )
            else:
                print(
                    "                   "
                    f"step_key={str(step_key).ljust(32)},       error={result.error}",
                )

    print(f"metrics={json.dumps(eval['metrics'].data, indent=4)}")  # type:ignore
