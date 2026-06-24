# Evaluation Backend, Explained

A plain-language tour of how the evaluation backend works: the step graph, the
two dispatch dials (source × mode), the per-step `origin`, and how live / auto /
human / annotation-queue relate. Ends with where the "auto evaluation from trace
queries" feature lands.

## The core idea: a run is a recipe of steps

Every evaluation is a **run**, and a run is just a small graph of **steps**:

- **input step** — where the data comes from (a query, a testset, raw traces, or
  raw testcases). It never "executes"; it just names the source.
- **invocation step** — runs your *application* over each input (optional).
- **annotation step** — runs an *evaluator* that scores/labels each item (optional).

The backend inspects the shape of that graph and decides what to do. That
decision-maker is the **topology classifier** (`classify_steps_topology` in
`sdks/python/agenta/sdk/evaluations/runtime/topology.py`). It answers two
questions: *"Is this shape allowed?"* and *"How should the worker run it?"*

## Two knobs the classifier sets: source × mode

When a shape is **supported**, the classifier returns a `dispatch` with two
independent dials:

**source** = what feeds the run:

- `query` — traces matched by a saved query
- `testset` — rows in a testset
- `trace` — explicit trace IDs pushed in
- `testcase` — explicit testcase IDs pushed in

**mode** = how the work arrives and ends:

- `batch` — **one-shot** over a bounded set, then it **finalizes** (marks
  SUCCESS/FAILURE and stops). Windows from the source's own bounds.
- `live` — **scheduler-driven**, never finalizes. A timer ("tick") keeps polling
  for new data and feeding it in forever. Windowing stays *off* so each tick
  keeps its own time range for time-bucketed metrics.
- `queue` — an **open queue**: nothing runs at creation; batches get pushed in
  later (`run_from_batch`) and each batch finalizes itself.

So `{query, batch}` = "score the traces this query matches, once, then stop."
`{query, live}` = "keep scoring new matching traces as they arrive."

## The third knob, which lives on the step: origin (auto / human / custom)

`source` and `mode` describe the *run*. **Origin** describes a single *annotation
step* — who actually does the scoring. This is the auto/human/custom distinction,
and it gates execution in `_initial_scenario_status`
(`api/oss/src/core/evaluations/tasks/run.py:42-56`):

- **`auto`** — the backend worker runs the evaluator itself (an LLM-as-judge, a
  code check, etc.). Fully automatic.
- **`human`** — the worker does *nothing*. A person opens the UI and fills in the
  score by hand.
- **`custom`** — the backend also doesn't run it; only an SDK running on your own
  machine executes it locally, then reports back.

The key rule: when a run is created, the worker checks the executable steps. **If
every step is `human` or `custom`, the scenario starts as `PENDING`** — there's
nothing for the worker to do, so it waits for people/SDK. If there's at least one
`auto` step (or an app invocation), it starts `RUNNING`.

This is also why, in the batch-query path, metric refresh is gated on
`origin != "human"` (`run.py:580`): a human-only tick produces no automatic
numbers, so there is nothing to aggregate.

## Live / auto / human / annotation queue — different axes

These are not four parallel categories. They sit on *different axes*, which is
the part that is easy to mix up:

- **Live** is a **mode** — the run never finalizes; a scheduler keeps feeding it.
  It pairs with a query source: `{query, live}`. Think "continuous monitoring of
  production traffic."
- **Auto** is an **origin** — the worker runs the evaluator automatically. It is
  orthogonal to mode: you can have auto evaluators in a live run *or* a batch run.
- **Human** is also an **origin** — a person scores manually. A run made entirely
  of human steps starts `PENDING` and waits for input.
- **Annotation queue** is the **`queue` mode** applied to direct inputs:
  `{trace, queue}` or `{testcase, queue}`. It is an *open* run: you create it
  empty, then push batches of trace/testcase IDs into it over time, and each
  batch finalizes itself. This is the natural home for human review — a standing
  queue of items people annotate as they come in. It combines naturally with
  `human` origin.

Putting it together: **mode** says *when work arrives and whether the run ever
ends*; **origin** says *who performs each scoring step*. A "human annotation
queue" is just `queue` mode (open, async) + `human` origin (person scores). A
"live auto eval" is `live` mode (continuous) + `auto` origin (worker scores).

## Supported topologies (these run)

A run is **allowed** (executes) only when `status == "supported"`. Order matters:
the classifier returns the first matching branch.

| Shape | dispatch | What it is |
|---|---|---|
| Live query → evaluator | `{query, live}` | Scheduler ticks feed new query traces straight into evaluators; windowing off so each tick's range survives for temporal bucketing. |
| Batch query → evaluator | `{query, batch}` | One-shot evaluation over the query revision's own bounded trace set. **The feature being built.** |
| Direct traces → evaluator | `{trace, queue}` | Open queue: trace batches pushed in later, each finalizes itself. |
| Direct testcases → evaluator | `{testcase, queue}` | Same open-queue shape, seeded by direct testcases. |
| Testset → evaluator (no app) | `{testset, batch}` | One-shot over the testset; score each testcase directly, no invocation step. |
| Testset → application → evaluator | `{testset, batch}` | Canonical batch eval: run the app over each testcase, then score it. |
| Testset → application (batch inference) | `{testset, batch}` | Bulk invocation only — produce outputs over a testset, no scoring. |

## Recognized but not allowed

| Shape | status | Why |
|---|---|---|
| Mixed query + testset sources | `not_planned` | Two source families in one run. |
| Query → application | `not_planned` | Re-invoking an app over query-sourced traces would misclassify the new app traces as annotations — the data model can't attach those links cleanly. |
| Live testset evaluation | `not_planned` | `is_live` + testset is not a meaningful product shape. |
| Multiple application steps | `not_planned` | More than one invocation step — A/B app comparisons belong in separate runs. |
| Anything else | `unsupported` | No dispatch path matches the graph; the run is dropped at start. |

## Where the "auto eval from trace queries" feature lands

"Run auto evaluation from trace queries" = the **Batch query → evaluator** row:
`dispatch = {query, batch}`, with an **`auto`** evaluator and **no app step**.
One-shot over the query's bounded trace set, then it finalizes.

The entire backend path for this already exists and runs end-to-end:

1. The classifier marks the shape `supported`
   (`topology.py:122-128`).
2. `run_from_source` routes `source == "query"` to `_run_query_source`
   (`run.py:327-343`).
3. `_run_query_source` fetches traces, mints scenarios, runs the auto evaluator,
   refreshes metrics, and finalizes (empty → SUCCESS, error → FAILURE)
   (`run.py:480-606`).
4. `resolve_query_source_items` reads the `query_revision` ref off the input
   step and calls `tracing_service.query_traces()` — no app/invocation involved
   (`sources.py:487-549`).

The data model and API entry point are ready too: `EvaluationRunFlags.has_queries`,
the `query_revision` reference on a step, and `SimpleQueueCreate.queries`
(`api/oss/src/core/evaluations/types.py`) plus the `SimpleQueueCreateRequest`
endpoint (`api/oss/src/apis/fastapi/evaluations/router.py`).

**The only missing piece is the frontend UI** to assemble that step graph (a
query input step + an auto annotation step, no invocation) and call the
simple-queue create endpoint.

One guardrail to remember: **query → application is blocked**. You can score
existing query traces, but you cannot re-run an app over them in the same run. So
a query-sourced run is always *traces → evaluator*, never *traces → app →
evaluator*.

## Key references

- Topology classifier: `sdks/python/agenta/sdk/evaluations/runtime/topology.py`
- API-side topology wrapper: `api/oss/src/core/evaluations/runtime/topology.py`
- Worker orchestrator (dispatch + query/testset flows):
  `api/oss/src/core/evaluations/tasks/run.py`
- Source resolution (query → traces):
  `api/oss/src/core/evaluations/runtime/sources.py`
- Run/flags/step data model: `api/oss/src/core/evaluations/types.py`
- API router + create request: `api/oss/src/apis/fastapi/evaluations/`
