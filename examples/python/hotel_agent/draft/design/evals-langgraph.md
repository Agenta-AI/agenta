# Evals for the LangGraph runtime — plan

> Status: **Draft for review.** Sourced only from the Agenta docs under `docs/docs`
> (the SDK evaluation guides and the LangGraph integration guide), not from Agenta's
> internal code. Numbers and signatures below reflect what those docs promise; verify
> against the installed `agenta` SDK before relying on them.

## Goal

Add an SDK-driven evaluation suite for the LangGraph hotel agent. Start with the
vanilla runtime in `runtimes/langgraph/vanilla/`. Run it from a standalone script
so we can iterate fast, then fold it into the wider `agenta-integration.md`
workstream once the shape is proven.

This is the first of the four runtimes to get evals. The work here sets the pattern
the other three reuse.

## What the Agenta SDK gives us

The docs describe a single programmatic flow (`evaluation/evaluation-from-sdk/`).
Three pieces feed one call:

1. **Application** — any function wrapped with `@ag.application(slug=...)`. It takes
   fields from a testcase as named parameters and returns the output to score.
2. **Evaluators** — either custom functions wrapped with `@ag.evaluator(slug=...)`,
   or built-ins from `agenta.sdk.workflows.builtin`. Each receives testcase fields
   plus the application output as `outputs`, and returns a dict. The keys `score`
   (numeric) and `success` (bool) have special meaning.
3. **Test sets** — created with `ag.testsets.acreate(...)` / `aupsert(...)`, or
   passed inline as a list of dicts.

You run everything with `aevaluate(testsets=[...], applications=[...], evaluators=[...])`
from `agenta.sdk.evaluations`. Setup is just `ag.init()` plus `AGENTA_API_KEY`,
`AGENTA_HOST`, and the relevant LLM keys in the environment.

Data flow the docs guarantee:

- A testcase dict flows into the application by matching keys to parameter names.
  Extra keys are ignored by the application.
- The application return value reaches every evaluator as `outputs`.
- The evaluator can also read any testcase field by name (for example the expected
  answer).

That is the whole contract. There is no trajectory or tool-call concept in the SDK
eval API per the docs. We get input to output to score. Anything we want to assert
about tool use has to be carried in the application's return value (see below).

## How the LangGraph agent becomes an Agenta "application"

The vanilla runtime today exposes a compiled graph (`agent`) plus
`build_input_messages(deps, history, user_msg)`, and tools read an `AgentDeps`
passed as the run `context`. The eval application is a thin async wrapper:

```python
@ag.application(slug="hotel_langgraph_vanilla", name="Hotel Agent (LangGraph, vanilla)")
async def hotel_langgraph_vanilla(message: str, persona: str = "guest_sarah"):
    deps = await build_default_deps(current_user_id=persona)
    messages = await build_input_messages(deps, history=[], user_msg=message)
    result = await agent.ainvoke({"messages": messages}, context=deps)
    final = result["messages"][-1].content
    return final
```

Notes and open points:

- **Inputs come from the testcase.** Each testcase needs at least `message` and
  `persona`. `persona` maps to a seeded guest id (`guest_sarah`, `guest_eve`, ...),
  which drives tier-sensitive behaviour. This reuses the same personas the
  `chat_langgraph.py` smoke CLI already accepts.
- **One turn per testcase to start.** The eval contract is single input to single
  output. We pass empty history. Multi-turn evals are a later question (see Open
  questions).
- **Returning more than the final string.** Several eval surfaces below need to know
  *which tools the agent called*, not just its prose. The application can return a
  dict instead, for example
  `{"answer": final, "tool_calls": [...], "tools_used": [...]}`, built from the
  LangGraph result messages. Evaluators then read those fields. The docs explicitly
  allow dict returns and structured testcase fields, so this stays within the
  documented contract.
- **Verify the invoke signature.** The runtime streams with
  `agent.astream(..., stream_mode=[...])`. For evals we want a single awaited result,
  so confirm `agent.ainvoke({"messages": ...}, context=deps)` returns the final state
  the same way before building on it.

## Eval surfaces we want to cover

`scope.md` and `policy.md` already name the surfaces. Mapping each to an Agenta
evaluator type:

| Surface | What we check | Evaluator approach |
|---|---|---|
| Policy faithfulness | Agent quotes the right cutoff/fee/number | LLM-as-a-judge against a reference answer, or `auto_contains_all` on key numbers |
| Compliance / refusals | Agent refuses violations, invents no exceptions | Custom evaluator on `tools_used` (no write tool fired) + LLM-as-a-judge on the refusal |
| Edge cases (tier x rate x timing) | Correct outcome for tricky combinations | Custom evaluator comparing outcome to expected, keyed off testcase fields |
| Upsell behaviour | Offers when appropriate, stays silent when not | LLM-as-a-judge with a yes/no rubric |
| Faithful pricing | All-in quote includes tax, resort fee, pet fee | Custom evaluator (parse the answer) + `auto_contains` on the line items |
| Tool grounding | Agent called `quote_stay` before quoting | Custom evaluator over the returned `tools_used` |

Start with two or three of these, not all six. Suggested first slice: policy
faithfulness, compliance/refusal, and tool grounding. They exercise the data plumbing
(testcase fields in, structured output out, both custom and built-in evaluators)
without needing the full rubric set.

## Test sets

Build them in code from the seed data so they stay in sync with the fixtures. The
docs show `ag.testsets.acreate(name=..., data=[{...}, ...])` and an `aupsert` variant
that replaces a named testset in place. Use `aupsert` so re-running the script does
not pile up duplicate testsets.

Each testcase is a flat dict. A faithfulness case looks like:

```python
{
    "message": "Can I cancel my reservation for a full refund?",
    "persona": "guest_bob",            # Standard tier, reservation inside cutoff
    "correct_answer": "No. Standard tier needs 24 hours before check-in...",
    "expected_tools": [],              # no write tool should fire on a refusal
}
```

The named seed scenarios that `implementation-status.md` lists as deferred
(`RES_BOB_INSIDE_CUTOFF_ID`, `RES_EVE_CURRENT_STAY_ID`, `RES_CARLA_FUTURE_NONREF_ID`,
and friends) become the backbone of these testcases. This is the right moment to
enumerate them, in a small `evals/testsets.py` module.

## Evaluators

Mix built-in and custom:

- **Built-in**, imported from `agenta.sdk.workflows.builtin`:
  - `auto_contains_all(substrings=[...])` to assert key numbers appear ("24 hours",
    "$35", "14%").
  - `auto_ai_critique(...)` (LLM-as-a-judge) with a `prompt_template` and
    `correct_answer_key` for faithfulness and upsell rubrics. Needs an LLM key.
- **Custom**, with `@ag.evaluator`:
  - A refusal/compliance check that reads our structured output:
    ```python
    @ag.evaluator(slug="no_write_on_refusal")
    async def no_write_on_refusal(expected_tools: list, outputs: dict):
        fired = set(outputs.get("tools_used", []))
        forbidden = {"create_reservation", "cancel_reservation", "modify_reservation"}
        ok = not (fired & forbidden) if expected_tools == [] else True
        return {"success": ok, "score": 1.0 if ok else 0.0}
    ```
  - A tool-grounding check that asserts `quote_stay` ran before any price was quoted.

Custom evaluators returning extra keys is fine; the docs say every key in the result
dict is stored and shown.

## Running it

A standalone script, run with `uv run` and inline deps per repo convention:

```python
# evals/run_langgraph_evals.py
async def main():
    ag.init()
    testset = await ag.testsets.aupsert(name="hotel-langgraph-policy", data=POLICY_CASES)
    result = await aevaluate(
        name="LangGraph vanilla — policy v1",
        testsets=[testset.id],
        applications=[hotel_langgraph_vanilla],
        evaluators=[faithfulness_judge, no_write_on_refusal, contains_numbers],
    )
    print(result["run"].id)
```

Results land in the Agenta UI for inspection, and `result["run"].id` is available
programmatically. Place the eval code under `draft/evals/` next to `runtimes/` and
`scripts/`.

## Open questions

- **`ainvoke` vs `astream`.** Confirm the graph returns a usable final state from a
  single awaited `ainvoke` with `context=deps`. If not, drain `astream` and collect
  the final message.
- **Single vs multi-turn.** The cancel/upsell surfaces are arguably multi-turn
  (quote, then confirm, then book). The SDK eval contract is single input to single
  output. Decide whether to encode a scripted multi-turn exchange inside one
  application call, or keep v1 single-turn.
- **Persona to current_user_id.** We pass `persona` as a testcase field and call
  `build_default_deps(current_user_id=persona)` per case. Confirm that is the wiring
  we want, versus a fixed persona per testset.
- **Tool-call visibility.** Returning `tools_used` from the application depends on the
  exact shape of the LangGraph result messages. Pin that down before writing the
  grounding/compliance evaluators.
- **LLM-as-a-judge model and cost.** `auto_ai_critique` defaults to `gpt-3.5-turbo`.
  Pick a judge model and budget for the run.
- **Live vs deferred connection.** This plan assumes a real Agenta project
  (`AGENTA_API_KEY`, `AGENTA_HOST`). Decide whether the first pass runs against the EU
  cloud or a local stack.

## Suggested order of work

1. Confirm the `ainvoke`/result shape, and what we can read for tool calls.
2. Write the application wrapper returning `{"answer", "tools_used"}`.
3. Write `evals/testsets.py` with 6 to 10 policy/refusal cases off the named seed
   scenarios.
4. Write two custom evaluators (`no_write_on_refusal`, tool grounding) and wire one
   built-in (`auto_contains_all`).
5. Add the LLM-as-a-judge faithfulness evaluator.
6. Run end to end, read the results in the UI, tune the rubric.
7. Generalise the wrapper so the other three runtimes can reuse the same testsets and
   evaluators. Feed learnings back into `agenta-integration.md`.
