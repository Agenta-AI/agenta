# SDK vs API: evaluation subsystem comparison

Snapshot **after** the unification + batching work (Option A: the API re-execute
path now issues one `process_sources` call over all scenarios, matching the SDK
and the design's `process_slice(all scenarios)`).

The headline: **the engine is one shared code object, not two implementations.**
The API package imports the SDK's `process_sources`, `EvaluationPlanner`,
`runtime.models`, `runtime.topology`, and the adapter protocols directly. The
question is therefore which *seams* each side fills the same, similarly, or
differently — not "do they reimplement each other."

Key files:
- Engine (shared): `sdks/python/agenta/sdk/evaluations/runtime/{processor,planner,topology,models,executor}.py`
- SDK driver: `sdks/python/agenta/sdk/evaluations/{preview/evaluate.py, runtime/executor.py, runtime/adapters.py}` + clients `{runs,scenarios,results,metrics}.py`
- API driver: `api/oss/src/core/evaluations/{tasks/processor.py, tasks/run.py, runtime/adapters.py, runtime/tensor.py}`

---

## 1. EQUAL — one shared code object

Imported from the SDK package; there is no API copy. A change here changes both
paths at once.

| Component | File |
|---|---|
| `process_sources` (the engine) — per-scenario `gather` + semaphore, cell planning/execution, retries, inline `refresh_metrics(scenario_id)` + end-of-slice `refresh_metrics(run_id, None)`, in-loop `edit_scenario` status write | `runtime/processor.py` |
| `EvaluationPlanner.plan` — cell graph (scenario × step × repeat) | `runtime/planner.py` |
| `scenario_status` / `run_status` — verdict ranking (ERRORS > PENDING > SUCCESS; run = ERRORS/RUNNING/SUCCESS) | `runtime/processor.py` |
| `classify_steps_topology` | `runtime/topology.py` |
| `ResolvedSourceItem`, `PlannedCell`, `EvaluationStep`, `TensorSlice`, `WorkflowExecution*`, `ResultLogRequest`, `ProcessSummary` | `runtime/models.py` |
| `DEFAULT_BATCH_SIZE = 10` (default in-slice concurrency) | `runtime/processor.py` |
| Adapter protocols: `ResultSetter.set`, `RefreshMetrics`, `EditScenario`, `CreateScenario`, `TraceLoader`, `WorkflowRunner` | `runtime/executor.py` |
| **Engine call shape: ONE slice over all scenarios** (post-Option-A; was API-divergent) | both drivers |
| **Scenario-factory shape: ordered, lock-guarded cursor** (`_PreMintedScenarios` / `_OrderedScenarios`) | both drivers |

Consequence: lifecycle logging (`[SLICE]/[SCENARIO]/[STEP]/[METRICS]`), concurrency
model, status computation, and metric-refresh *shape* are identical because they
are the same code.

---

## 2. SIMILAR BUT DIFFERENT — mirrored adapters (same protocol, different backend)

Each side injects a named adapter class implementing a shared protocol. **SDK
adapters are HTTP clients; API adapters are in-process service calls.**

| Seam (protocol) | SDK | API | Difference |
|---|---|---|---|
| Workflow runner | `SDKWorkflowRunner` → `invoke_application`/`invoke_evaluator` **decorators in-process** | `APIWorkflowRunner` → `workflows_service.invoke_workflow` **HTTP**, wrapped by `APICachedRunner` (hashed-trace reuse) | SDK runs the user's local Python; API calls the workflow service. **`execute_batch` is now concurrent + semaphore-bounded on BOTH** (the SDK was sequential pre-fix). |
| Result setter (`.set`) | `SDKResultSetter` → `apopulate(results=[cell])` (`POST /simple/evaluations/{id}/populate`) | `APIResultSetter` → `evaluations_service.set_results([cell])` | Both **live per-cell**. API binds `timestamp`/`interval` at construction; SDK has no temporal axis. |
| Metrics refresh | `SDKMetricsRefresher` → `arefresh(run_id, scenario_id?)` (`POST /evaluations/metrics/refresh`) | `APIMetricsRefresher` → `evaluations_service.refresh_metrics(...)` | Same two engine calls (variational per scenario, global at end). API adapter also handles **temporal** buckets (timestamps+interval) and rejects scenario+timestamp; SDK is scenario-or-global only. |
| Scenario editor (`edit_scenario`) | `SDKScenarioEditor` → `aedit_scenario(scenario_id, status, tags, meta)` (`PATCH /evaluations/scenarios/{id}`) | `APIScenarioEditor` → `evaluations_service.edit_scenario(EvaluationScenarioEdit(...))` | Both carry `tags`/`meta` and tolerate a run closed mid-flight (SDK: HTTP 409 → None; API: `except EvaluationClosedConflict`). |
| Trace fetcher (`fetch_trace`) | `SDKTraceFetcher` → `afetch_trace` | `APITraceFetcher` → `fetch_trace(tracing_service, ...)` | Same callable contract; different fetch backend. |
| Scenario factory (`create_scenario`) | `_PreMintedScenarios` cursor over bulk-minted scenarios | `_OrderedScenarios` cursor over recovered scenarios | Same shape now (both ordered, lock-guarded cursors over a pre-collected list). |
| Run create / close | `acreate`/`aclose` (HTTP) | `evaluations_service.create_run`/`edit_run` (in-process) | SDK is an HTTP client of the same endpoints the API serves internally. |

Pattern: same protocol, SDK = HTTP-client / API = in-process-service. The
`SDK*`/`API*` class names are intentional peers.

---

## 3. DIFFERENT — genuine structural divergence (mostly API-only capability)

| Aspect | SDK | API |
|---|---|---|
| Driver | `process_run_locally` — value-resolved, single-shot, in-process `await` | `APISliceProcessor.process` — run-resolved, worker-driven |
| Entity resolution | in the caller (`evaluate.py` → revision ids; `executor._retrieve_revisions` → objects) | inside `process` (`_resolve_runners_and_revisions`), from the persisted run graph |
| Re-execution / retry | none (always mint fresh, run once) | first-class: `TensorSlice` (scenario_ids × step_keys × repeat_idxs), `process_mode: fill-missing\|force`, `seed_bindings`, reuse counting, `_cell_is_addressed`, per-scenario source recovery from input cells |
| Run finalization | `aclose(status=run_status.value)` — single inline driver, no floor | `_finalize_run_after_slice` — re-fetch current run, severity-floor across concurrent slices, flip `is_active`, tolerate closed-run |
| Liveness / temporal | absent (batch only) | `is_live`, scheduler re-ticks (`newest`/`oldest` windows), temporal metric buckets, run stays RUNNING |
| Worker orchestration | none (library call) | Taskiq tasks, `_with_job_lock(allow_concurrency=...)` (singleton for `run_from_source`, per-job for `run_from_batch`/`rerun`), heartbeat |
| Tensor ops | uses `populate` + `process` + `refresh` only | all five: `probe`, `populate`, `process`, `prune`, `refresh` |
| Queue / online | none | `SimpleQueueSettings` / `EvaluationQueueData` — user assignment, `batch_size`/`batch_offset` |
| Metrics read-back | `aquery_global` for the `aevaluate` return (`{run, scenarios, metrics}`) | none (worker writes only; consumed via UI/API) |
| Aggregate refresh | engine's end-of-slice global only | `tensor.refresh`: variational + temporal-or-global by `is_live` |

---

## 4. Flow taxonomy — three orthogonal axes (API)

"Live / batch / source / slice" are not one list; they are three independent axes
that combine into the topology dispatches.

| Axis | Values | Controls |
|---|---|---|
| **Source** | source-ingest (testset/query → mint) · direct-batch (explicit trace/testcase ids → mint) · slice-reexecute (existing scenarios, recover from cells) | where scenarios/inputs come from |
| **Liveness** | batch (`is_live=False`: one-shot, global metrics, finalizes) · live (`is_live=True`: scheduler re-ticks, temporal buckets, stays RUNNING) | temporal semantics |
| **Process mode** | `force` (ingest: fill all cells) · `fill-missing` (retry: only empty cells) | re-execution strategy |

Entry points (`tasks/run.py`): `run_from_source` (topology-dispatched: `live_query`,
`batch_query`, `batch_testset`, `batch_invocation`, `queue_*`), `run_from_batch`
(direct id batches into open queue runs), `rerun` (slice re-execute by coordinate;
owns the `tensor.refresh` boundary).

**The SDK implements exactly one cell of this matrix:** `batch · source-ingest ·
force` — the `batch_testset` shape (testset → app → evaluator), single-shot. Everything
live, query, queue, retry, and worker-orchestration is API-only by design. The SDK
is a thin in-process client of one flow, sharing the engine + planner + topology
classifier + `TensorSlice` model but not the orchestration around them.

---

## 5. What Option A changed

Before: the API looped per scenario into the engine on **every** path (ingest and
re-execute), so cross-scenario concurrency never materialized (a 100-scenario run
ran serially; each `process_sources` call got a fresh semaphore used only for one
scenario's repeats).

After: `APISliceProcessor.process` does a **recovery pass** (per scenario: resolve
source, compute addressed/target cells + reuse, recover upstream context) then a
**single** `_run_sdk_source_slice` over all scenarios with:
- an ordered cursor `create_scenario` (`_OrderedScenarios`),
- a per-`(scenario, cell)` `plan_cell_filter` (keyed by `cell.scenario_id`),
- a per-scenario `initial_context_by_repeat` **callable** (lazy, memory-bounded —
  the engine resolves each scenario's recovered context under the `gather`).

This closed the last two SDK/API divergences in the shared cell (engine call shape,
scenario factory) and gives the API cross-scenario concurrency, bounded by the same
`batch_size` semaphore. `timestamp`/`interval` are constant per call (verified:
ingest seeds one value; rerun passes None), so no per-scenario threading was needed
for them.
