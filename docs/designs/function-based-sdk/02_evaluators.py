"""Evaluators as functions. (POC, does not run.)

An evaluator is a workflow with `is_evaluator=True`, so the authoring model is
identical to applications. The differences:
- you decorate with `@ag.evaluator(...)` and your function returns metrics
- `inputs` are the testcase columns the evaluator consumes (permissive by
  default, since batch mode passes every column)
- the function also receives `outputs` (the application output under
  evaluation) and `trace` (the full execution trace)

`parameters=` are the evaluator settings users edit in the UI. `outputs=` is
the declared metrics schema, which the UI uses to render score columns.

Note how the trivial case has no boilerplate: no class body, no inner models
you do not need. The smallest evaluator is one decorated function.
"""

import asyncio

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

import agenta as ag

client = AsyncOpenAI()


# The smallest possible evaluator: no settings, one metric. A class proposal
# spends a class statement, a docstring, and an inner Outputs model on this.
# Here it is the function plus its return model.
class StartsCapitalizedOut(BaseModel):
    score: float
    success: bool


@ag.evaluator(
    slug="starts-capitalized", name="Starts Capitalized", outputs=StartsCapitalizedOut
)
async def starts_capitalized(*, outputs, **_) -> StartsCapitalizedOut:
    text = outputs["answer"] if isinstance(outputs, dict) else str(outputs)
    ok = bool(text) and text[0].isupper()
    return StartsCapitalizedOut(score=1.0 if ok else 0.0, success=ok)


# LLM-as-a-judge with its own typed settings. The settings render in the
# evaluator config UI from schemas.parameters, exactly like builtin evaluator
# settings do today.
class RubricParams(BaseModel):
    judge_model: str = "gpt-4o-mini"
    rubric: str = Field(
        "The answer is factual, polite, and under 100 words.",
        json_schema_extra={"x-ag-type": "text"},
    )


class RubricInputs(BaseModel):
    # Evaluators receive all testcase columns. Declare the ones you use,
    # allow the rest.
    model_config = ConfigDict(extra="allow")
    expected_answer: str | None = None


class RubricOut(BaseModel):
    score: float = Field(ge=0.0, le=1.0)
    verdict: str


@ag.evaluator(
    slug="rubric-judge",
    name="Rubric Judge",
    description="Grades the answer against a rubric with an LLM.",
    parameters=RubricParams,
    inputs=RubricInputs,
    outputs=RubricOut,
)
async def rubric_judge(
    *, inputs: RubricInputs, outputs, parameters: RubricParams, **_
) -> RubricOut:
    response = await client.chat.completions.create(
        model=parameters.judge_model,
        messages=[
            {"role": "system", "content": f"Grade against: {parameters.rubric}"},
            {"role": "user", "content": str(outputs)},
        ],
    )
    verdict = response.choices[0].message.content
    return RubricOut(score=0.9, verdict=verdict)


# A trace-based evaluator. `trace` exposes the full invocation: spans, costs,
# tokens, tool calls. Same data the custom code evaluator gets today, but typed
# access instead of a raw dict.
class BudgetParams(BaseModel):
    max_cost_usd: float = 0.01


class BudgetOut(BaseModel):
    success: bool
    cost_usd: float


@ag.evaluator(
    slug="stays-under-budget",
    name="Stays Under Budget",
    parameters=BudgetParams,
    outputs=BudgetOut,
)
async def stays_under_budget(
    *, trace: ag.Trace, parameters: BudgetParams, **_
) -> BudgetOut:
    cost = trace.metrics.costs.cumulative
    return BudgetOut(success=cost <= parameters.max_cost_usd, cost_usd=cost)


async def main():
    ag.init()

    # Local typed call against a single output. Useful for unit tests. `.pin()`
    # bakes in settings, same partial mechanism as applications.
    judge = rubric_judge.pin(judge_model="gpt-4.1")
    result = await judge(
        outputs={"answer": "The pool is open 7am to 10pm."},
        expected_answer="Pool hours are 7-22.",
    )
    print(result.score, result.verdict)

    # Builtins are factory functions: typed configurators over the existing
    # agenta:builtin:* handlers, instead of settings dicts. They return handles
    # too, so they slot into aevaluate next to your own.
    _exact = ag.evaluators.exact_match(correct_answer_key="expected_answer")
    _similarity = ag.evaluators.semantic_similarity(threshold=0.8)

    # Push registers the evaluator on the platform with its compiled schemas.
    # It then shows up in the UI next to the builtins.
    await rubric_judge.push()


if __name__ == "__main__":
    asyncio.run(main())
