"""Evaluators as classes. (POC, does not run.)

An evaluator is a workflow with `is_evaluator=True`, so the authoring model is
identical to applications. The differences:
- you implement `evaluate()` instead of `run()`
- `Inputs` are the testcase columns the evaluator consumes (permissive by
  default, since batch mode passes every column)
- `evaluate()` also receives `outputs` (the application output under
  evaluation) and `trace` (the full execution trace)

`Parameters` are the evaluator settings users edit in the UI. `Outputs` is the
declared metrics schema, which the UI uses to render score columns.
"""

import asyncio

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

import agenta as ag

from core import Evaluator  # 00_core.py — the native class base

ag.Evaluator = Evaluator  # what the SDK __init__ would export


class StartsCapitalized(ag.Evaluator):
    """The smallest possible evaluator: no settings, one metric."""

    slug = "starts-capitalized"
    name = "Starts Capitalized"

    class Outputs(BaseModel):
        score: float
        success: bool

    async def evaluate(self, *, outputs, **_) -> Outputs:
        text = outputs["answer"] if isinstance(outputs, dict) else str(outputs)
        ok = bool(text) and text[0].isupper()
        return self.Outputs(score=1.0 if ok else 0.0, success=ok)


class RubricJudge(ag.Evaluator):
    """LLM-as-a-judge with its own typed settings.

    The settings render in the evaluator config UI from schemas.parameters,
    exactly like builtin evaluator settings do today.
    """

    slug = "rubric-judge"
    name = "Rubric Judge"
    description = "Grades the answer against a rubric with an LLM."

    class Parameters(BaseModel):
        judge_model: str = "gpt-4o-mini"
        rubric: str = Field(
            "The answer is factual, polite, and under 100 words.",
            json_schema_extra={"x-ag-type": "text"},
        )

    class Inputs(BaseModel):
        # Evaluators receive all testcase columns. Declare the ones you use,
        # allow the rest.
        model_config = ConfigDict(extra="allow")
        expected_answer: str | None = None

    class Outputs(BaseModel):
        score: float = Field(ge=0.0, le=1.0)
        verdict: str

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.client = AsyncOpenAI()

    async def evaluate(
        self, *, inputs: Inputs, outputs, parameters: Parameters, **_
    ) -> Outputs:
        response = await self.client.chat.completions.create(
            model=parameters.judge_model,
            messages=[
                {"role": "system", "content": f"Grade against: {parameters.rubric}"},
                {"role": "user", "content": str(outputs)},
            ],
        )
        verdict = response.choices[0].message.content
        return self.Outputs(score=0.9, verdict=verdict)


class StaysUnderBudget(ag.Evaluator):
    """A trace-based evaluator. `trace` exposes the full invocation: spans,
    costs, tokens, tool calls. Same data the custom code evaluator gets today,
    but typed access instead of a raw dict.
    """

    slug = "stays-under-budget"
    name = "Stays Under Budget"

    class Parameters(BaseModel):
        max_cost_usd: float = 0.01

    class Outputs(BaseModel):
        success: bool
        cost_usd: float

    async def evaluate(
        self, *, trace: ag.Trace, parameters: Parameters, **_
    ) -> Outputs:
        cost = trace.metrics.costs.cumulative
        return self.Outputs(success=cost <= parameters.max_cost_usd, cost_usd=cost)


async def main():
    ag.init()

    # Local typed call against a single output. Useful for unit tests.
    judge = RubricJudge(parameters={"judge_model": "gpt-4.1"})
    result = await judge(
        outputs={"answer": "The pool is open 7am to 10pm."},
        expected_answer="Pool hours are 7-22.",
    )
    print(result.score, result.verdict)

    # Builtins are classes too: typed configurators over the existing
    # agenta:builtin:* handlers, instead of settings dicts.
    _exact = ag.evaluators.ExactMatch(correct_answer_key="expected_answer")
    _similarity = ag.evaluators.SemanticSimilarity(threshold=0.8)

    # Push registers the evaluator on the platform with its compiled schemas.
    # It then shows up in the UI next to the builtins.
    await RubricJudge.apush()


if __name__ == "__main__":
    asyncio.run(main())
