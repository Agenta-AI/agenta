# Simplified Interface: the evaluation operation vocabulary

Status: design / forward-looking. Concentrates the operation surface scattered
across `proposal.md`, `gap.md`, `operations.md`, and `step-removal-semantics.md`
into one place. No new semantics — it organizes what we want the **public
interface** to be.

## Why this document

We want a small, atomic vocabulary of evaluation operations that maps cleanly to:

1. **HTTP endpoints** with clean URLs and explicit `operation_id`s, so they
   surface as named methods in the generated Fern clients (TS + Python).
2. **The SDK `evaluate()` utility** — built *on top of* these atomic operations,
   not as a parallel code path.
3. **User-built utilities** — a user should be able to assemble their own
   evaluation flow from the same atomic operations `evaluate()` uses.

The test: adding a new evaluation flow should mean *composing existing
operations*, never adding a new end-to-end endpoint.

## The vocabulary

There are three layers (and a fourth, queues, set aside for now):

1. **Run** — the container. RPC-style lifecycle, not a graph/tensor mutator.
2. **Graph** — the shape: steps, scenarios, repeats, and their connections.
3. **Tensor** — the contents: results, and metrics.
4. *(Queues — a human-work view over the tensor. Noted, left aside here.)*

```text
run:     create / edit / delete | start / stop / close / open
graph:   add_step / remove_step | add_scenario / remove_scenario | set_repeats
tensor:  results  → probe / process / populate / prune
         metrics  → refresh (variational / temporal / global)
```

### Run

The run is acted on by **RPC operations**, not by editing fields:

- `create` / `edit` / `delete` — `edit` mostly for completeness; real editing is
  graph ops (add/remove steps & scenarios).
- `start` / `stop` / `close` / `open` — lifecycle.

**There is no `set_flag`.** The `has_*` flags are inferred from the graph,
`is_queue` is reconciled, and the remaining config flags are set through
`create`/`edit` — never a dedicated flag RPC.

### Graph → tensor shape

Mutating the graph mutates the tensor's shape — the three graph axes map
one-to-one onto the three tensor dimensions:

- **steps** → columns (add/remove a step adds/prunes a column of cells)
- **scenarios** → rows (add/remove a scenario adds/prunes a row of cells)
- **repeats** → depth (`set_repeats` materializes or prunes repeat slots)

Steps and scenarios are named entities (add/remove); repeats is a count, so it
is **set** (`set_repeats`), which re-shapes the tensor depth.

### Tensor: results

Result ops act on a **slice** (`TensorSlice = scenarios x steps x repeats` =
rows x columns x depth), so retry, fill-missing, re-run-one-evaluator, queue
assignment, and live ticks are all a slice op:

- `probe`    — read cells (what exists, what's missing).
- `process`  — run the runnable cells (whatever the current executor owns by
  origin; see [`origin-execution-model.md`](./origin-execution-model.md)) and
  populate the results.
- `populate` — write result cells directly. The shared write primitive for any
  origin, including the runtimes themselves.
- `prune`    — delete cells.

### Tensor: metrics

Metrics are derived from result cells. There are **three kinds**, differing by
scope and by *when* they may be refreshed. Each is an object **keyed by step**.

| kind | aggregates over | refresh trigger |
| --- | --- | --- |
| **variational** | one scenario, across all its repeats | only when the scenario is **fully computed** — used in both live and batch evaluations |
| **temporal** | all scenarios + repeats within a timestamp **interval** | per interval — used for **live** evaluations |
| **global** | all scenarios + repeats in the run | at run scope — used for batch evaluations |

**Results and metrics are decoupled.** `probe`/`process`/`populate`/`prune`
operate on **result cells only** — none of them refresh metrics. `refresh` is a
separate, first-class op that recomputes metrics, invoked by the caller on the
right boundary (scenario-complete / interval / run). `prune` deletes cells but
not metrics: a metric is an aggregate over a whole scenario/interval/run, so
pruning cells leaves it to be recomputed by `refresh`, not deleted.

## Target endpoint shape

All under `/api/evaluations/`. Conventions follow AGENTS.md (POST `/query`,
`/{id}/archive`, explicit `operation_id`, cursor pagination, `count` + payload
envelopes).

### Run (RPC lifecycle)

| operation_id | Method + path | Status |
| --- | --- | --- |
| `create_runs` / `edit_runs` / `delete_runs` / `query_runs` | `…/runs/` `/runs/query` | done |
| `fetch_run` / `edit_run` / `delete_run` | `…/runs/{run_id}` | done |
| `start_run` / `stop_run` | `POST /runs/{run_id}/start` `/stop` | done (via simple-evaluation start/stop) |
| `close_run` / `open_run` | `POST /runs/{run_id}/close` `/open` | done (lock) |

No `set_flag`: `has_*` flags are inferred from the graph, `is_queue` is
reconciled, and the config `is_*` flags are written through `create`/`edit`.

### Graph — steps & scenarios

| operation_id | Method + path | Status |
| --- | --- | --- |
| `add_step` | `POST /runs/{run_id}/steps` | **deferred** — today a step is added by editing `data.steps`. |
| `remove_step` | `DELETE /runs/{run_id}/steps/{step_key}` | done as behavior (folded into `edit_run` reconcile + prune), **deferred** as a named endpoint. |
| `create_scenarios` / `edit_scenarios` / `delete_scenarios` | `…/scenarios/` | done (CRUD) |
| `add_scenario` | `POST /runs/{run_id}/scenarios` | **deferred** — graph-aware add (resolve source binding, plan cells), vs. raw CRUD. |
| `remove_scenario` | `DELETE /runs/{run_id}/scenarios/{scenario_id}` | **deferred** — cascade-aware (prune cells + flush metrics). |
| `set_repeats` | `POST /runs/{run_id}/repeats` | **deferred** — set the depth; materialize new repeat slots or prune surplus, then `process` the new cells. |

### Tensor results — endpoints

| operation_id | Method + path | Status |
| --- | --- | --- |
| `create_results` / `edit_results` / `delete_results` | `…/results/` | done (CRUD; the low-level cell write) |
| `probe_slice` | `POST /runs/{run_id}/slice/probe` | in-process (`TensorSliceOperations.probe`), **deferred** as endpoint. |
| `process_slice` | `POST /runs/{run_id}/slice/process` | in-process (`process` → `BackendSliceProcessor`), **deferred** as endpoint. |
| `populate_slice` | `POST /runs/{run_id}/slice/populate` | in-process, **deferred** as endpoint (bulk/slice write). |
| `prune_slice` | `POST /runs/{run_id}/slice/prune` | in-process, **deferred** as endpoint. |

The four `*_slice` ops all take a `TensorSlice` body. They are the atomic
primitives `evaluate()` and user utilities compose; only their HTTP exposure is
deferred — the in-process implementations exist (`runtime/tensor.py`).

### Tensor metrics — endpoints

| operation_id | Method + path | Status |
| --- | --- | --- |
| `refresh_metrics` | `POST /metrics/refresh` | done — single endpoint today; refreshes the affected scope. |
| `create_metrics` / `edit_metrics` / `delete_metrics` / `query_metrics` | `…/metrics/` `/metrics/query` | done (CRUD) |

Whether refresh stays one endpoint or splits per kind (variational / temporal /
global) — and whether it stays coupled to `process` or becomes its own
operation — is the open question above.

## How `evaluate()` composes these

The SDK utility is a thin client-side orchestration over the vocabulary:

```text
evaluate(testset, app, evaluators):
  create_run(...)                                 # container
  add_step per app + evaluator                    # graph
  add_scenario per testset row                    # graph (resolve source bindings)
  process_slice(all scenarios, all steps)         # tensor: run the runnable cells + refresh metrics
  -> returns {run, scenarios, metrics}
```

A user wanting a custom flow (e.g. re-run only one evaluator on failed rows)
calls the same ops directly: `probe_slice` to find failures, then
`process_slice` scoped to that evaluator's `step_key`.

## What this unlocks

- Generated clients expose `evaluations.processSlice(...)`,
  `evaluations.addScenario(...)`, etc. as named methods.
- One mental model for setup, retry, queue assignment, manual annotation, live
  ticks, and SDK/local runs — all are slice ops.
- New flows are compositions, not new endpoints.

## Pointers

- Operation list + direction: [`proposal.md`](./proposal.md) §"Operation API Direction".
- Per-op status (done / partial / deferred): [`operations.md`](./operations.md).
- Removal lifecycle (why `remove_step` prunes): [`step-removal-semantics.md`](./step-removal-semantics.md).
- Gaps: [`gap.md`](./gap.md) §"Tensor Operation Gaps".
