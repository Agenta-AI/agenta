# Status: issues found while building the evals

This is the working list. We take these one by one and decide the right fix for each.

Each entry uses the same shape. The source tag is the conclusion after research, not a
guess. Legend: `sdk-bug`, `backend`, `docs-gap`, `ux`, `ops`, `example-code` (ours),
`my-error` (a mistake in this eval code or my analysis).

A correction up front. My first analysis of tracing was wrong. The backend was never
dropping spans. I had misread the shape of the trace API response. Issue 3 now records the
real cause. Several workarounds I added were built on that wrong analysis and should come
out.

---

## Issue 1: a single ConnectTimeout aborts the whole run

**Source:** `ops` for the stall itself, plus an `sdk` resilience gap that turns one stall
into a full abort.

**What happens.** During `aevaluate`, one call raised `httpx.ConnectTimeout` and the whole
run stopped partway through.

**Research.** The SDK opens a fresh `httpx.AsyncClient` per call with a thirty second timeout
and no retry (`agenta/sdk/middlewares/running/resolver.py`, around lines 309 to 315). The
production `aevaluate` loop is sequential, so any single failed call ends the run. I could not
reproduce the stall on demand: the host accepted eighty concurrent fresh connections in under
one second, and a resolver ping every half second stayed near twenty milliseconds while an
agent was running. So the stalls were transient and server side, and the SDK had no
resilience to absorb them.

I also asked how three other evaluation SDKs handle a single failing call. All three isolate
the failure per item and keep the run going, and all three retry backend calls.

- LangSmith wraps every target and evaluator call in a per-example try/except and records the
  failure as data rather than raising. Backend HTTP uses a urllib3 `Retry` (total 3, backoff
  0.5, on 502, 503, 504, 408, 425, honoring `Retry-After`), plus an application retry loop.
  Source: `python/langsmith/evaluation/_runner.py` and `python/langsmith/client.py`.
- Langfuse runs items concurrently with `asyncio.gather(..., return_exceptions=True)`, catches
  each task and each evaluator, logs the error and marks the trace, and continues. Score and
  trace ingestion retry with exponential backoff. The docs state error isolation as a feature.
  Source: `langfuse/_client/client.py`, `langfuse/experiment.py`.
- Braintrust runs each item in a coroutine whose body is fully wrapped in try/except and
  always returns an `EvalResult` carrying the error, so one failure never propagates. Each
  scorer is isolated too. The HTTP layer retries with backoff and drops a batch as a last
  resort rather than crashing. Source: `py/src/braintrust/framework.py`, `logger.py`.

The shared pattern is clear. Wrap each item and each evaluator so a failure becomes a recorded
result, and retry transient backend calls. Agenta does neither in the production version.

**Does PR #4341 fix it.** Partly. The new engine isolates failures per scenario
(`runtime/processor.py` `_guarded_process_one`, with `asyncio.gather`) so one failing testcase
no longer aborts the run, and it adds an application retry (`_execute_with_retry`). Two gaps
remain. The retry is off by default on the SDK path (`max_retries` is unset), and it only
retries result level failures, not thrown exceptions. The HTTP layer in `resolver.py` is
unchanged, so there is still no connection retry or pooling.

**What I did (to undo).** I added a connect retry shim in `run.py`. We do not want it. Remove
it and let the real behavior show.

**State:** open. Remove the shim. Decide whether to push for HTTP level retry and exception
level isolation in the SDK on top of #4341.

---

## Issue 2: only the first evaluator receives the application trace

**Source:** `sdk-bug`. Fixed in PR #4341.

**What happens.** With more than one evaluator, the second and third evaluators do not get the
application trace. They get the previous evaluator's trace. An evaluator that reads the agent's
tool spans then works for the first evaluator and silently reads the wrong trace for the rest.

**Research.** In production SDK 0.100.9, `agenta/sdk/evaluations/preview/evaluate.py` fetches
the application trace into a variable named `trace` before the evaluator loop (around line
647). Inside the loop it passes `trace=trace` to each evaluator (around line 720), then
reassigns the same variable to the current evaluator's own trace for logging (around lines 749
and 769). On the next iteration the evaluator receives that reassigned value. I confirmed it
with a debug evaluator: every evaluator received the same application trace id through
`request.links["invocation"]`, while the `trace` argument differed by position.

**Does PR #4341 fix it.** Yes. The PR rewrites the eval engine. The loop variable reuse is
gone. In `runtime/processor.py`, `_remember_context` records path context only for the
application step and refuses to do so for evaluator steps, and `_upstream_for_cell` builds
each evaluator's upstream trace from the shared application context. The planner orders steps
as input, then application, then evaluators. So every evaluator now receives the application
trace. The bug is structurally eliminated.

**What I did.** I read the application trace id from `request.links["invocation"].trace_id`
instead of the `trace` argument. This is correct for every evaluator and is forward compatible
with #4341.

**No PR comment posted.** The plan was to comment on the buggy lines in #4341. Since #4341
already fixes the bug, there is nothing to flag there. The bug lives in the released version
(0.100.9), so the right action is a separate issue against the released SDK that points to
#4341 as the fix.

**State:** confirmed bug, fixed in #4341. Next step is to open an issue on the released SDK and
link the fix.

---

## Issue 3: tracing. The agent run and how the evaluator reads it

This was the hard one and the place I was most wrong. It has a real part and a part that was my
mistake.

**Source:** `docs-gap` plus `example-code` for the real part, and `my-error` for the part I
first blamed on the backend.

**The real part: the agent run is not traced unless you instrument the framework.** My first
application produced what looked like a single span because I never turned on the LangChain
instrumentation in the eval process. The hotel server does this at startup with
`LangChainInstrumentor().instrument()`, but my eval code did not. After I added the same call,
the agent emitted a full trace. The Agenta evaluation docs under
`docs/docs/evaluation/evaluation-from-sdk` never mention this step, so a user who wants tool
level evaluation would not know to do it. This is a genuine docs gap.

**The mistake: the backend does not drop child spans. I misread the API response.** I claimed
the backend kept only the root span and dropped the children. That was wrong. I proved it step
by step.

1. The SDK exporter sends every span. I logged the Agenta OTLP exporter and saw one export of
   eight spans for the trace, including the `search_availability` tool span.
2. The backend stores every span. I queried the tracing database directly
   (`agenta_ee_tracing.spans`) and found all eight rows for the trace, including the tool span
   and the chat spans.
3. The read endpoint returns every span, as a tree. `GET /api/tracing/traces/{trace_id}`
   returns a nested structure. The top level `spans` holds only the root, and each span holds
   its children under its own nested `spans` key. Repeated names, such as two `model` spans,
   appear as a list. I had read only the top level, seen one entry, and wrongly concluded the
   children were gone.

So tracing works end to end. The agent emits eight spans, the backend stores all eight, and
the read endpoint returns all eight as a tree. The correct way to read tool usage is to walk
that tree and select spans where `span_type` is `tool`. The tool name is `span_name` and the
tool output sits at `attributes.ag.data.outputs`.

**The eventual consistency point was also mostly my misread.** The async tracing worker does
add a short delay before a span is queryable, but `aevaluate` already polls for the trace
before it calls the evaluators, so by evaluator time the tree is complete. There is no need for
the re-fetch poll I added.

**What I did (to undo).** Three workarounds, all built on the wrong backend analysis. An
in-process `InMemorySpanExporter` to read spans locally, a `store_internals` mirror onto the
root span, and a re-fetch poll. All three should come out. The evaluator should read tool
usage by walking the real trace tree.

**Open questions for the tutorial.** Should the read endpoint also offer a flat list of spans,
since a tree is awkward to consume in an evaluator. Should `@ag.application` instrument common
frameworks for you, or should the docs simply add the instrumentation step. The honest tutorial
path is to instrument the framework and read tool usage from the platform trace.

**State:** open. Real cause understood. Remove the three workarounds and read from the trace
tree. Layer one needs a docs change.

---

## Issue 4: reading per-case results back is manual

**Source:** `ux`.

**What happens.** After a run finishes, there is no obvious SDK call that returns a tidy per
case, per evaluator table. The object that `aevaluate` returns holds ids and nested metrics.

**Research.** `metrics.arefresh` returned an empty list for my run. The per case verdicts live
in annotation traces. To build a table I queried `POST /api/evaluations/results/query` and then
fetched each annotation trace.

**What I did.** I wrote `summarize.py` to query the REST API and join the traces into a table.
This is acceptable as a stopgap.

**State:** open. Tracked in `todo.md` for later SDK work. Keep `summarize.py` for now.

---

## Issue 5: a cryptic error when a decorator runs before `ag.init()`

**Source:** `ux`.

**What happens.** Calling an `@ag.application` function before `ag.init()` fails with
`AttributeError: 'NoneType' object has no attribute 'get_current_span'` from inside the tracing
decorator. The message does not tell you to call `ag.init()` first.

**Research.** The decorator in `agenta/sdk/decorators/tracing.py` reaches for the tracing
singleton, which is `None` until `ag.init()` runs.

**Does PR #4341 fix it.** Partly. The PR adds a `_warn_if_not_initialized` helper that emits a
`RuntimeWarning` naming `ag.init()` at the top of each wrapper. But it only warns. Execution
continues into `_parse_type_and_kind`, whose first line calls
`ag.tracing.get_current_span()` while `ag.tracing` is still `None`, so the same raw
`AttributeError` still follows.

**State:** open. Tracked in `todo.md`. Friendly warning exists in #4341, but it should raise a
clear error instead of falling through to the AttributeError.

---

## Issue 6: the monthly evaluation quota

**Source:** `ops`. Resolved for now.

**What happens.** A full run failed with HTTP 429 and the message that the monthly evaluations
quota was reached, after many debugging runs.

**Resolution.** The account upgrade did not land on this org. I checked the database directly:
the org `019e8df5-2a47-78e3-b925-fafc0299ae14` was still on plan `cloud_v0_hobby`, which caps
`EVALUATIONS_RUN` at 20 per month (`api/ee/src/core/entitlements/types.py`), and the meter
read exactly 20 for the period. The cached subscription agreed with the database, so it was
not a stale cache. I set `subscriptions.plan` to `cloud_v0_pro` for this org and cleared the
cached subscription key in Redis. The full run then went through. I also removed `run_local.py`,
since the whole point is to exercise the platform path.

For the tutorial: a reader on the hobby plan hits the 20 run cap quickly. Worth calling out.

**State:** resolved for our dev org. Real upgrade flow still needs to set the plan correctly.

---

## Issue 8: a failing application aborts the whole run with an opaque error

**Source:** `sdk-bug`. A facet of issue 1 (no isolation), plus a missing guard.

**What happens.** When the application raises (here, the room-code failure from issue 7), the
SDK records a failed invocation, then crashes the entire run at the end with
`IndexError: list index out of range`. No results are saved.

**Research.** Two layers. First, the released SDK does not isolate a raising application, so a
failed invocation leaves the scenario with no metrics. Second, `metrics.arefresh` then does
`response["metrics"][0]` on an empty list and raises `IndexError`
(`agenta/sdk/evaluations/metrics.py:35`, called from `evaluate.py:775`). So one failing case
takes down the whole run, and the error message points at metrics, not at the real cause.

**What I did.** I catch the agent's own errors in the application and return an error string,
so the failing case is recorded as a failed answer and the run continues. This is normal
practice (Langfuse's docs say tasks should handle their own errors), and the failure still
shows in the scores. It does not hide the SDK bug, which is recorded here.

**State:** open. Two SDK fixes worth proposing: isolate a raising application per scenario,
and guard `metrics.arefresh` against an empty response. Add to `todo.md`.

---

## Issue 7: our example hides the agent's tool-argument failure

**Source:** `example-code` (ours), with an agent-behavior finding.

**What happens.** On the pricing cases the agent passes the room display name, such as
"Deluxe", to `quote_stay`, which expects the room code `DLX`. The tool raises, `create_agent`
re-raises, and my application catches it and returns `"<agent error: ...>"`, which makes the
failure look like a bland answer.

**Research.** The agent never learns the room codes because it does not call `list_room_types`
first, and the system prompt lists rate types by name but not the room codes
(`runtimes/langgraph/vanilla/adapters.py`, `runtimes/langgraph/vanilla/agent.py`).

**State:** open. This is an agent and prompt finding, not a platform issue, and a good teaching
case for the tutorial. We decide later whether to fix the agent, fix the adapter, or keep it.
