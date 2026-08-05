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

The graph defines the cell-grid shape; operations mutate either the **graph**
(`add_steps` / `remove_steps` …) or the **slice of cells** (`populate` / `prune` …).
The grid is the run's `scenarios × steps × repeats` cells. The two op families
stay symmetric:

```text
graph:  add_steps / remove_steps / add_scenarios / remove_scenarios / set_repeats
slice:  probe / populate / prune / process
run:    refresh_metrics / set_flag
```

A key invariant (per `step-removal-semantics.md`): the **stored graph and stored
cell grid have the same shape**. Adding a step adds a column dimension; removing
a step prunes that column's cells. `create_run` is conceptually "edit from an empty
graph", so create and edit share one reconciliation path.

A `RunSlice` (in `runtime/types.py`) addresses a sub-region of the grid
(`scenario_ids × step_keys × repeat_idxs`, plus an `overwrite` flag); the slice
operations all take one.

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
| `add_steps` | **done** | `POST /{id}/steps/add` (`add_steps`) | `SimpleEvaluationsService.add_steps` — appends step columns to `run.data.steps` (idempotent on key); cells fill on the next `process`. The legacy folded-into-`edit_run` path still works too. proposal.md:370. |
| `remove_steps` | **done** | `POST /{id}/steps/remove` (`remove_steps`) | `SimpleEvaluationsService.remove_steps` — drops step columns by key. Destructive cell removal via the reconcile path (`_reconcile_run` / `_prune_removed_steps`) is also driven by omitting a step on `edit_run`; semantics in `step-removal-semantics.md`; closed UEL-014. |
| `add_scenarios` | **done** | `POST /{id}/scenarios/add` (`add_scenarios`) | `SimpleEvaluationsService.add_scenarios` — appends N skeleton rows (height). `populate` writes their input cells, `process` plans/executes (`process` never mints scenarios). proposal.md:372. |
| `remove_scenarios` | **done** | `POST /{id}/scenarios/remove` (`remove_scenarios`) | `SimpleEvaluationsService.remove_scenarios` — drops scenario rows and their cells (delegates to `delete_scenarios`). proposal.md:373. |
| `set_repeats` | **done** | `POST /{id}/repeats` (`set_repeats`) | `SimpleEvaluationsService.set_repeats` — sets the run's repeat (depth) dimension; existing cells untouched, new repeat slots fill on the next `process`. |

### Slice operations

All four take a `RunSlice` (`runtime/types.py`) and live on `SliceOperations`
(`runtime/operations.py`).

| Operation | Status | Endpoint (`operation_id`) | Where |
| --- | --- | --- | --- |
| `probe(slice)` | **done** | `POST /{id}/probe` (`probe_slice`) | `SimpleEvaluationsService.probe_slice` → `SliceOperations.probe` / `probe_summary` in `runtime/operations.py`. |
| `populate(slice, results)` | **done** | `POST /{id}/populate` (`populate_slice`) | `SimpleEvaluationsService.populate_slice` → `SliceOperations.populate`. Low-level cell CRUD (`create_results` + `/evaluations/results/`) still underlies it. |
| `prune(slice)` | **done** | `POST /{id}/prune` (`prune_slice`) | `SimpleEvaluationsService.prune_slice` → `SliceOperations.prune` (removes cells + refreshes metrics over the scope). Also driven by `remove_steps` via `_prune_removed_steps`. |
| `process(slice)` | **done** | `POST /{id}/process` (`process_slice`) | `SimpleEvaluationsService.dispatch_run_slice` → taskiq → `SliceOperations.process`, which delegates to the injected `SliceProcessor` (`APISliceProcessor` in `tasks/processor.py`). Re-executes the runnable cells for the EXISTING scenarios a `RunSlice` addresses — `overwrite=False` fills only missing cells, `overwrite=True` re-runs every addressed cell. It rebuilds each scenario's source binding from its stored input cell, re-hydrates trace/testcase context, plans from the run's current graph (so modified steps re-run), runs the cache-aware runners (hashed-trace reuse), populates, refreshes metrics, and finalizes — in one batched `process_sources` call over all addressed scenarios. With no processor wired it raises rather than silently refreshing. Closed UEL-015. proposal.md:160-208. |

### Run operations

| Operation | Status | Where / Tracking |
| --- | --- | --- |
| `refresh_metrics(scope)` | **done** | `EvaluationsService.refresh_metrics` + `/evaluations/metrics/refresh`. Also invoked by every slice-write op (populate / process / prune) over the touched scope. |
| `set_flag` | deferred (this branch) | No first-class constrained `set_flag`. Flags are currently re-derived during reconciliation (`_reconcile_run`, with `is_queue` set via `_reconcile_default_queue`) rather than set directly. A constrained setter lands later in this branch. proposal.md:379; gap.md:302, 340. |
| run start / stop / close / open | **done** | `create_run`/`close_run`/`open_run` + `/{id}/start`,`/stop`,`/close`,`/open` routes. |

## Still deferred

Only `set_flag` remains deferred on this branch (flags are re-derived during
reconciliation today; a constrained setter lands later — proposal.md:379; gap.md:302,
340). When implemented it should:

- follow the AGENTS.md domain conventions (`apis/fastapi/evaluations/router.py` +
  `core/evaluations/service.py`), with typed domain exceptions in
  `core/evaluations/types.py`;
- reuse the shared reconcile path so the mutation re-derives flags + default-queue
  eligibility consistently with create/edit.

The graph-shape and slice ops are all wired end to end (service → HTTP →
Fern client). They are slice-shaped where applicable (`RunSlice`) so setup, retry,
queue assignment, manual annotation, live ticks, and SDK/local runs share one cell-grid
contract (proposal.md:381).
