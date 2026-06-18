# Batch Query → Evaluator: Backend Flow

Runs an auto evaluator over production traces from a saved query — no application step required.

## Run graph shape

```
input step        references: { query_revision: { id: "<query_rev_id>" } }
     ↓
annotation step   origin: "auto"
                  references: { workflow_revision: { id: "<evaluator_rev_id>" } }
```

## End-to-end flow

| Step | File | What happens |
|---|---|---|
| 1. Topology | `sdks/.../runtime/topology.py:122` | Classifier sees `has_queries=True`, `has_evaluators=True`, `has_applications=False` → `dispatch={source:"query", mode:"batch"}` |
| 2. Start | `core/evaluations/service.py:2705` | `start()` classifies topology, dispatches `process_run_from_source(run_id)` to the worker |
| 3. Route | `core/evaluations/tasks/run.py:327` | Worker sees `source=query, mode=batch` → calls `_run_query_source(use_windowing=True)` |
| 4. Resolve | `core/evaluations/runtime/sources.py:487` | Fetches query revision → runs `tracing_service.query_traces()` with the query's stored filtering/windowing → returns one `ResolvedSourceItem` per matching trace |
| 5. Mint | `core/evaluations/tasks/run.py:146` | One `EvaluationScenario` created per trace; each paired with its hydrated source item |
| 6. Plan | `sdks/.../runtime/planner.py:83` | Per scenario: input cell (`status=SUCCESS, trace_id=...`) + evaluator cells (`status=QUEUED, should_execute=True`). No application cells. |
| 7. Execute | `core/evaluations/tasks/processor.py:102` | Evaluator runner receives `{ trace, trace_id, span_id, outputs }` as upstream context — no app invocation |
| 8. Finalize | `core/evaluations/tasks/run.py:528` | All scenarios done → run flips to `SUCCESS`. Zero traces → immediate `SUCCESS`. |

## Key behaviors

- **Batch mode** (`use_windowing=True`): query uses its own stored bounds, not a scheduler tick.
- **Live mode** (`use_windowing=False`): scheduler passes `newest`/`oldest` per tick; run stays `RUNNING` and never finalizes.
- **Empty result**: query matched zero traces → run immediately goes to `SUCCESS`.
- **Repeat fan-out**: with `repeats > 1`, each trace gets N evaluator cells (evaluator-side fan-out only; `is_split` is ignored when there is no application step).
- **Human evaluator steps**: `origin="human"` cells are planned as `PENDING`, not executed. The run still finalizes based on the auto cells.

## Source resolution detail

`resolve_query_source_items()` in `sources.py`:
1. Walks input steps, finds `query_revision` refs
2. Fetches query revision from `QueriesService`
3. Calls `tracing_service.query_traces()` with the revision's `filtering` + `windowing`
4. Returns `{ step_key → [ResolvedSourceItem(kind="trace", trace_id, trace, span_id)] }`

The trace's `ag.data.inputs` / `ag.data.outputs` (extracted from the root span attributes) become the evaluator's input context — no re-fetch downstream.
