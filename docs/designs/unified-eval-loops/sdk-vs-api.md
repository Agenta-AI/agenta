# SDK vs API: evaluation subsystem comparison

**The engine is one shared code object, not two implementations.** The API
package imports the SDK's `process_sources`, `EvaluationPlanner`,
`runtime.models`, `runtime.topology`, and the adapter protocols directly. The
question is therefore which *seams* each side fills the same, similarly, or
differently — not "do they reimplement each other."

Key files:
- Engine (shared): `sdks/python/agenta/sdk/evaluations/runtime/{processor,planner,topology,models,executor}.py`
- SDK driver: `sdks/python/agenta/sdk/evaluations/{preview/evaluate.py, runtime/executor.py, runtime/adapters.py}` + clients `{runs,scenarios,results,metrics}.py`
- API driver: `api/oss/src/core/evaluations/{tasks/processor.py, tasks/run.py, runtime/adapters.py, runtime/operations.py}`

---

## 1. EQUAL — one shared code object

Imported from the SDK package; there is no API copy. A change here changes both
paths at once.

| Component | File |
|---|---|
| `process_sources` (the engine) — per-scenario `gather` + semaphore, cell planning/execution, retries, inline `refresh_metrics(scenario_id)` + end-of-slice `refresh_metrics(run_id, None)`, in-loop `edit_scenario` status write | `runtime/processor.py` |
| `EvaluationPlanner.plan` — cell grid (scenario × step × repeat) | `runtime/planner.py` |
| `scenario_status` / `run_status` — verdict ranking (ERRORS > PENDING > SUCCESS; run = ERRORS/RUNNING/SUCCESS) | `runtime/processor.py` |
| `classify_steps_topology` | `runtime/topology.py` |
| `ResolvedSourceItem`, `PlannedCell`, `EvaluationStep`, `RunSlice`, `WorkflowExecution*`, `ResultSetRequest`, `ProcessSummary` | `runtime/models.py` |
| `DEFAULT_BATCH_SIZE = 10` (default in-slice concurrency) | `runtime/processor.py` |
| Adapter protocols: `ResultSetter.set`, `RefreshMetrics`, `EditScenario`, `CreateScenario`, `TraceLoader`, `WorkflowRunner` | `runtime/executor.py` |
| **Engine call shape: ONE slice over all scenarios** | both drivers |
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
| Workflow runner | `SDKWorkflowRunner` → `invoke_application`/`invoke_evaluator` **decorators in-process** | `APIWorkflowRunner` → `workflows_service.invoke_workflow` **HTTP**, wrapped by `APICachedRunner` (hashed-trace reuse) | SDK runs the user's local Python; API calls the workflow service. `execute_batch` is concurrent + semaphore-bounded on both. |
| Result setter (`.set`) | `SDKResultSetter` → `apopulate(results=[cell])` (`POST /simple/evaluations/{id}/populate`) | `APIResultSetter` → `evaluations_service.set_results([cell])` | Both **live per-cell**. API binds `timestamp`/`interval` at construction; SDK has no temporal axis. |
| Metrics refresh | `SDKMetricsRefresher` → `arefresh(run_id, scenario_id?)` (`POST /evaluations/metrics/refresh`) | `APIMetricsRefresher` → `evaluations_service.refresh_metrics(...)` | Same two engine calls (variational per scenario, global at end). API adapter also handles **temporal** buckets (timestamps+interval) and rejects scenario+timestamp; SDK is scenario-or-global only. |
| Scenario editor (`edit_scenario`) | `SDKScenarioEditor` → `aedit_scenario(scenario_id, status, tags, meta)` (`PATCH /evaluations/scenarios/{id}`) | `APIScenarioEditor` → `evaluations_service.edit_scenario(EvaluationScenarioEdit(...))` | Both carry `tags`/`meta` and tolerate a run closed mid-flight (SDK: HTTP 409 → None; API: `except EvaluationClosedConflict`). |
| Trace fetcher (`fetch_trace`) | `SDKTraceFetcher` → `afetch_trace` | `APITraceFetcher` → `fetch_trace(tracing_service, ...)` | Same callable contract; different fetch backend. |
| Scenario factory (`create_scenario`) | `_PreMintedScenarios` cursor over bulk-minted scenarios | `_OrderedScenarios` cursor over recovered scenarios | Same shape (both ordered, lock-guarded cursors over a pre-collected list). |
| Run create / close | `acreate`/`aclose` (HTTP) | `evaluations_service.create_run`/`edit_run` (in-process) | SDK is an HTTP client of the same endpoints the API serves internally. |

Pattern: same protocol, SDK = HTTP-client / API = in-process-service. The
`SDK*`/`API*` class names are intentional peers.

---

## 3. DIFFERENT — genuine structural divergence

These are the points where SDK and API genuinely differ. Each is classified by
whether the difference **WON'T** change (intrinsic to what each side is), **MUST**
change (a correctness/parity gap to close), **SHOULD** change (a clear improvement
with low risk), or **COULD** change (a defensible future option, not now).

### WON'T change — intrinsic to SDK-as-library vs API-as-service

| Aspect | SDK | API | Why it stays different |
|---|---|---|---|
| Runner backend | local decorators in-process | workflow service over HTTP | The SDK's entire purpose is to run the *user's local Python*; the API runs persisted workflows. The shared `WorkflowRunner` protocol already absorbs this — the difference is the backend, by definition. |
| Worker orchestration | none (a `library call`, inline `await`) | Taskiq tasks, `_with_job_lock(allow_concurrency=...)`, heartbeat | A library can't own a distributed job queue; a multi-tenant service must. Pushing this into the shared engine would drag broker/lock infra into the SDK. |
| Run-status floor | `aclose(status=...)` — single inline driver, no floor | `_finalize_run_after_slice` — re-fetch current run, severity-floor across concurrent slices, flip `is_active` | The floor exists *because* the API has concurrent slices racing on one run. The SDK is a single inline driver — there is nothing to floor against. Adding it would be dead code. |
| Entity resolution timing | in the caller (`evaluate.py` → revision ids; `executor._retrieve_revisions` → objects) | inside `process` (`_resolve_runners_and_revisions`) from the persisted run graph | SDK resolves by VALUE (callables/inline data upserted up front); API resolves from an already-persisted run. Different inputs, not a divergence to unify. |
| Metrics read-back | `aquery_global` for the `aevaluate` return (`{run, scenarios, metrics}`) | none (worker writes; UI/API reads) | The SDK returns a result object to a caller; the API run is consumed asynchronously. Read-back is a property of the return contract, which only the SDK has. |

### MUST change — correctness / parity gaps

*(None outstanding.)* The previously-open gaps (engine call shape, scenario
factory, sequential `execute_batch`, status write, metric-refresh shape, naming)
are closed and now sit in §1–§2.

### SHOULD change — clear improvement, low risk

| Aspect | Current state | Why change | How |
|---|---|---|---|
| Aggregate refresh ownership | SDK: engine's end-of-slice **global-only** refresh. API: `operations.refresh` does variational + **temporal-or-global** by `is_live`. | The SDK quietly can't produce temporal aggregates; if the SDK ever drives a live/temporal run the aggregate would be wrong. Aligning the aggregate step removes a latent correctness cliff and a second refresh code path. | Lift the API's `operations.refresh` rollup logic (variational + global/temporal selection) into a shared helper the engine's end-of-slice step calls, parameterized by `is_live`. The SDK passes `is_live=False` (its only mode today) and gets the same code path. |
| Run-slice-op coverage | SDK uses `populate` + `process` + `refresh`; never `probe`/`prune`. | `probe` (cheap existence/summary check) and `prune` (delete + recompute) are generally useful — e.g. an SDK `aevaluate` re-run that wants fill-missing, or cleanup. Exposing them as SDK clients closes the op-surface gap with no engine change (the ops already exist and are shared). | Add thin SDK clients mirroring the existing `/…/probe` and `/…/prune` endpoints, same shape as `apopulate`/`arefresh`. Opt-in; doesn't change the default `aevaluate` flow. |

### COULD change — defensible future option, not now

| Aspect | Current state | Why it could | Why not now |
|---|---|---|---|
| Re-execution / retry on the SDK | API-only: `RunSlice` (scenario_ids × step_keys × repeat_idxs), `process_mode: fill-missing\|force`, `seed_bindings`, reuse counting, per-scenario source recovery. | An SDK `aevaluate(..., rerun=...)` that re-runs one evaluator on failed rows would be a real convenience, and the `RunSlice` model + engine are already shared. | Source recovery from stored input cells is an API/DB concern; the SDK would need to re-fetch and re-hydrate, duplicating `_resolve_source_from_input_cells`. Significant surface for a feature with no current demand. |
| Liveness / temporal on the SDK | API-only: `is_live`, scheduler re-ticks, temporal metric buckets, run stays RUNNING. | Local live evaluation (e.g. tailing a trace stream) is conceivable. | Requires a scheduler/loop the SDK deliberately doesn't have, plus the temporal axis the SDK has no model for. This is squarely "service" territory; only revisit if a product need appears. |
| Queue / online assignment | API-only: `SimpleQueueSettings` / `EvaluationQueueData` — user assignment, `batch_size`/`batch_offset`. | — | Human-annotation queue distribution is inherently multi-user/server-side; no meaningful SDK analogue. Effectively belongs under WON'T. |

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
owns the `operations.refresh` boundary).

**The SDK implements exactly one cell of this matrix:** `batch · source-ingest ·
force` — the `batch_testset` shape (testset → app → evaluator), single-shot. Everything
live, query, queue, retry, and worker-orchestration is API-only by design. The SDK
is a thin in-process client of one flow, sharing the engine + planner + topology
classifier + `RunSlice` model but not the orchestration around them.
