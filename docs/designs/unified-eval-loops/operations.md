# Evaluation Operation Surface

## Purpose

This document is the single catalogue of the first-class evaluation operations the
unified-eval-loops design intends to expose, and the implementation status of each.

It exists so the explicit operations (`add_step`, `remove_step`, `add_scenario`,
`add_result`, `refresh_metrics`, …) are tracked in one place. Most are **deferred**
and will be implemented later; this doc records what is done, what is not, and where
each is specified.

It does not redefine semantics — see the canonical docs:

- Operation list and direction: [`proposal.md`](./proposal.md) §"Operation API Direction" (lines ~366-383)
- Gaps and deferred surface: [`gap.md`](./gap.md) §"API Gaps", §"SDK Gaps"
- Destructive removal lifecycle: [`step-removal-semantics.md`](./step-removal-semantics.md)

## Model

The graph defines the tensor shape; operations mutate either the **graph**
(`add_step` / `remove_step` …) or the **tensor** (`populate` / `prune` …). The two
op families stay symmetric:

```text
graph:  add_step / remove_step / add_scenario / remove_scenario
tensor: probe / populate / prune / process
run:    refresh_metrics / set_flag
```

A key invariant (per `step-removal-semantics.md`): the **stored graph and stored
tensor have the same shape**. Adding a step adds a tensor column dimension; removing
a step prunes that column's cells. `create_run` is conceptually "edit from an empty
graph", so create and edit share one reconciliation path.

## Status legend

- **done** — implemented and reachable through the service/router (or runtime).
- **partial** — exists but does not yet meet the documented contract.
- **deferred** — specified here/in the proposal, not yet implemented. To be done later.

## Operations

Every first-class op below is reachable over HTTP under `/api/simple/evaluations/{id}/…`
with an explicit `operation_id`, so the regenerated Fern client exposes a method per op.

### Graph-shape operations

| Operation | Status | Endpoint (`operation_id`) | Where |
| --- | --- | --- | --- |
| `add_steps` | **done** | `POST /{id}/steps/add` (`add_simple_evaluation_steps`) | `SimpleEvaluationsService.add_steps` — appends step columns to `run.data.steps` (idempotent on key); cells fill on the next `process`. The legacy folded-into-`edit_run` path still works too. proposal.md:370. |
| `remove_steps` | **done** | `POST /{id}/steps/remove` (`remove_simple_evaluation_steps`) | `SimpleEvaluationsService.remove_steps` — drops step columns by key. Destructive cell removal via the reconcile path (`_reconcile_run` / `_prune_removed_steps`) is also driven by omitting a step on `edit_run`; semantics in `step-removal-semantics.md`; closed UEL-014. |
| `add_scenarios` | **done** | `POST /{id}/scenarios/add` (`add_simple_evaluation_scenarios`) | `SimpleEvaluationsService.add_scenarios` — appends N skeleton rows (height). `populate` writes their input cells, `process` plans/executes (`process` never mints scenarios). proposal.md:372. |
| `remove_scenarios` | **done** | `POST /{id}/scenarios/remove` (`remove_simple_evaluation_scenarios`) | `SimpleEvaluationsService.remove_scenarios` — drops scenario rows and their cells (delegates to `delete_scenarios`). proposal.md:373. |
| `set_repeats` | **done** | `POST /{id}/repeats` (`set_simple_evaluation_repeats`) | `SimpleEvaluationsService.set_repeats` — sets the run's repeat (depth) dimension; existing cells untouched, new repeat slots fill on the next `process`. |

### Tensor operations

| Operation | Status | Endpoint (`operation_id`) | Where |
| --- | --- | --- | --- |
| `probe(slice)` | **done** | `POST /{id}/probe` (`probe_simple_evaluation_slice`) | `SimpleEvaluationsService.probe_slice` → `TensorSliceOperations.probe` / `probe_summary` in `runtime/tensor.py`. |
| `populate(slice, results)` | **done** | `POST /{id}/populate` (`populate_simple_evaluation_slice`) | `SimpleEvaluationsService.populate_slice` → `TensorSliceOperations.populate`. Low-level cell CRUD (`create_results` + `/evaluations/results/`) still underlies it. |
| `prune(slice)` | **done** | `POST /{id}/prune` (`prune_simple_evaluation_slice`) | `SimpleEvaluationsService.prune_slice` → `TensorSliceOperations.prune` (removes cells + refreshes metrics over the scope). Also driven by `remove_step` via `_prune_removed_steps`. |
| `process(slice)` | **done** | `POST /{id}/process` (`process_simple_evaluation_slice`) | `SimpleEvaluationsService.dispatch_tensor_slice` → taskiq → `TensorSliceOperations.process`, which delegates to the injected `SliceProcessor` (`APISliceProcessor` in `tasks/processor.py`). Re-executes the runnable cells for the EXISTING scenarios a `TensorSlice` addresses — rebuilds each scenario's source binding from its stored input cell, re-hydrates trace/testcase context, plans from the run's current graph (so modified steps re-run), runs the cache-aware runners (hashed-trace reuse), populates, refreshes metrics, and finalizes. With no processor wired it raises rather than silently refreshing. Closed UEL-015. proposal.md:160-208. |

### Run operations

| Operation | Status | Where / Tracking |
| --- | --- | --- |
| `refresh_metrics(scope)` | **done** | `EvaluationsService.refresh_metrics` + `/evaluations/metrics/refresh`. Also invoked by every tensor-write op (populate / process / prune) over the touched scope. |
| `set_flag` | deferred (this branch) | No first-class constrained `set_flag`. Flags are currently re-derived from the graph (`_make_run_flags`) and reconciled (`is_queue` via `_reconcile_default_queue`). A constrained setter lands later in this branch. proposal.md:379; gap.md:302, 340. |
| run start / stop / close / open | **done** | `create_run`/`close_run`/`open_run` + `/{id}/start`,`/stop`,`/close`,`/open` routes. |

## Still deferred

Only `set_flag` remains deferred on this branch (flags are re-derived from the graph
today; a constrained setter lands later — proposal.md:379; gap.md:302, 340). When
implemented it should:

- follow the AGENTS.md domain conventions (`apis/fastapi/evaluations/router.py` +
  `core/evaluations/service.py`), with typed domain exceptions in
  `core/evaluations/types.py`;
- reuse the shared reconcile path so the mutation re-derives flags + default-queue
  eligibility consistently with create/edit.

The graph-shape and tensor ops are all wired end to end (service → HTTP →
Fern client). They are slice-shaped where applicable (`TensorSlice`) so setup, retry,
queue assignment, manual annotation, live ticks, and SDK/local runs share one tensor
contract (proposal.md:381).
