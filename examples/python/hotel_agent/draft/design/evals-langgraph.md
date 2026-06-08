# Evals for the LangGraph runtime — plan

> Status: **superseded as the working doc.** The live design and issue log now live in
> `draft/evals/design/` (`README.md`, `status.md`, `todo.md`). This file is the original
> plan. One correction: the "v1 results" section below claims the backend dropped child
> spans. That was wrong. The backend stores all spans and the trace endpoint returns them
> as a nested tree; the earlier conclusion came from misreading that tree. See
> `draft/evals/design/status.md` issue 3 for the corrected analysis.

## Goal

Add an SDK-driven evaluation suite for the LangGraph hotel agent. Start with the
vanilla runtime in `runtimes/langgraph/vanilla/`. Run it from a standalone script
so we can iterate fast, then fold it into the wider `agenta-integration.md`
workstream once the shape is proven.

This is the first of the four runtimes to get evals. The work here sets the pattern
the other three reuse.

> **Where this sits in the roadmap.** Per `implementation-status.md`, the suggested
> order is library-matrix, then prompt centralization, then the first `with_agenta`
> runtime, then evals. Evals do not strictly block on the others: we can evaluate the
> current vanilla runtime against its hardcoded `SYSTEM_PROMPT` today. What we cannot
> do until `with_agenta` lands is A/B different prompt versions pulled from Agenta's
> registry. So treat this first pass as "measure the vanilla baseline," and expect a
> second pass once prompts are centralized.
>
> Setup, env vars, and run commands live in `draft/README.md`; this doc only covers
> the eval-specific pieces.

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
    # Pin the clock to the seed anchor so cutoff/timing cases are deterministic.
    deps = await build_default_deps(
        current_user_id=persona,
        clock=FixedClock(SEED_NOW),
    )
    messages = await build_input_messages(deps, history=[], user_msg=message)
    result = await agent.ainvoke({"messages": messages}, context=deps)
    final = result["messages"][-1].content
    return final
```

Notes and open points:

- **Determinism: pin the clock.** This is the load-bearing detail. `build_default_deps`
  defaults to `SystemClock()`, but the seed data is anchored at
  `SEED_NOW = datetime(2026, 6, 1, 12, 0, 0)` and every reservation date is relative to
  it. If "today" is the real wall-clock date, the cancellation-cutoff, no-show, and
  modification-window cases drift and the expected outcomes go stale. Pass
  `clock=FixedClock(SEED_NOW)` (the same clock the unit tests pin) so the agent reasons
  against the same "today" the fixtures were built for.
- **Fresh, seeded DB per case is a feature here.** `build_default_deps` builds an
  in-memory SQLite seeded from scratch each call. Calling it per testcase gives each
  case an isolated, identical starting state, so a `create_reservation` or `cancel` in
  one case never leaks into another. We want that for evals. (Same mechanism as the
  "reservations reset on restart" note in `README.md`, used deliberately.)
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
2. Write the application wrapper returning `{"answer", "tools_used"}`, pinning
   `clock=FixedClock(SEED_NOW)` and building deps per case.
3. Write `evals/testsets.py` with 6 to 10 policy/refusal cases off the named seed
   scenarios.
4. Write two custom evaluators (`no_write_on_refusal`, tool grounding) and wire one
   built-in (`auto_contains_all`).
5. Add the LLM-as-a-judge faithfulness evaluator.
6. Run end to end, read the results in the UI, tune the rubric.
7. Generalise the wrapper so the other three runtimes can reuse the same testsets and
   evaluators. Feed learnings back into `agenta-integration.md`.

---

## v1 implemented (trace-based)

Code in `draft/evals/`:

- `tracing_capture.py` — `call_setup()` runs `ag.init()`, attaches an in-process
  `InMemorySpanExporter`, and turns on the OpenInference LangChain instrumentation
  (same as the FastAPI server). `tool_spans_for(trace_id)` returns the run's real
  TOOL spans; `numbers_in(...)` collects numeric values from a tool output.
- `application.py` — wraps the LangGraph agent as `@ag.application`. The agent run
  now emits a real trace (workflow → LangGraph → ChatOpenAI / tool spans, each with
  inputs and outputs). Output is the answer string. A compact `{tools_used,
  tool_outputs}` summary is also mirrored onto the workflow span via
  `store_internals` for UI readability. Clock pinned to `FixedClock(SEED_NOW)`.
- `evaluators.py` — three evaluators plus reusable core functions
  (`judge_rubrics`, `assess_tool_usage`, `assess_pricing`):
  - `rubric_correctness` — LLM judge over the per-case rubric list.
  - `tool_usage` — reads the real TOOL spans of the run and checks
    expected/forbidden tools.
  - `faithful_pricing` — every `$` amount in the answer must match a number a
    pricing tool returned this run (from the TOOL spans' outputs) or an
    authoritative system-prompt constant.
- `testset.py` — 12 single-question cases.
- `run.py` — runs `aevaluate` (records a run in Agenta), prints a per-case table.
- `run_local.py` — runs the same logic without `aevaluate` (no platform
  evaluation-quota cost); useful for iteration or when the quota is exhausted.
- `summarize.py` — reads a finished platform run back for the table.

### How tool usage and pricing are read from the trace

Turning on instrumentation makes the agent emit genuine OTel spans, including a
`TOOL` span per tool call (`openinference.span.kind == "TOOL"`, `tool.name`,
`input.value`, `output.value`). The evaluators read those spans, not a hand-rolled
list. We capture them in-process with an `InMemorySpanExporter` and look them up by
the application's trace id. Two SDK realities forced this design:

1. **The backend drops the raw OpenInference child spans** in this self-hosted
   setup (it reliably retains only the Agenta-native root workflow span, and even
   the root's attributes are only eventually consistent). So reading child spans
   back from the backend is unreliable; the in-process capture is the source of
   truth. (This is consistent with the "200 but dropped" trace-storage caveat in
   `implementation-status.md`.)
2. **`aevaluate` reuses one `trace` variable across the evaluator loop**
   (`evaluate.py` ~720/749/769): after each evaluator runs, `trace` is reassigned
   to that evaluator's own trace, so only the *first* evaluator receives the
   application trace. We therefore key off `request.links["invocation"].trace_id`,
   which the framework sets to the application trace for every evaluator.

### First-run findings (local run; results stable)

Overall: rubric_correctness 7/12, tool_usage 10/12, faithful_pricing 12/12.

- **The Deluxe/Family pricing cases (1, 3) fail**, same real reason as before: the
  agent passes the room *display name* to `quote_stay` instead of the room *code*
  (`DLX`/`FAM`); the adapter re-raises, so no quote, no tools, rubric fails.
- **faithful_pricing now does real work**: on the availability case it validated 15
  nightly rates against the `search_availability` TOOL span output; it correctly
  passes vacuously when an answer states no prices.
- **Refusal / policy cases pass**: inside-cutoff cancel refused without calling
  `cancel_reservation`; non-refundable challenge escalates; flexible cancel calls
  `cancel_reservation`; pet, service-animal, upgrade, late-checkout answers pass.

### Operational notes

- **Monthly evaluation quota.** The self-hosted instance enforces a monthly
  `aevaluate` quota (HTTP 429 "You have reached your monthly evaluations quota").
  Heavy iteration exhausts it; use `run_local.py` while iterating and `run.py` to
  record a platform run.
- **ConnectTimeout, no SDK retry.** The SDK opens a fresh httpx client per call and
  never retries. Against this self-hosted host we saw a rare, transient
  `ConnectTimeout` mid-run (the host otherwise serves 80 concurrent connections in
  <1s and stays responsive during agent runs; the cause was not reproducible from
  the client). `run.py` retries only connect-phase failures (safe: the request
  never reached the server). Remove it against a stable host.

### Follow-ups

1. Fix the room-code lookup (prompt the agent to resolve codes via
   `list_room_types` first, or accept display names in the adapter) so the pricing
   cases and `faithful_pricing` carry full weight.
2. Consider returning `quote_stay` adapter errors to the model as a graceful string
   instead of re-raising, so the agent can recover mid-turn.
3. Grow the testset off `policy.md` §13 edge cases.
