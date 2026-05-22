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

### Graph operations

| Operation | Status | Where / Tracking |
| --- | --- | --- |
| `add_step` | deferred (this branch) | No explicit endpoint. Today a step is added by including it in `data.steps` on `create_run`/`edit_run`; flags re-derive and the default queue reconciles. A first-class `add_step` op (with validation, conflict handling) lands later in this branch. proposal.md:370; gap.md:271. |
| `remove_step` (+ `prune`) | **done** (folded into edit) | Destructive removal is implemented via the shared reconcile path, not a dedicated endpoint. Omitting a step from `data.steps` on `edit_run` removes it from the graph and prunes its cells, input-only orphan scenarios, and stale metrics. See `EvaluationsService._reconcile_run` / `_prune_removed_steps` in `api/oss/src/core/evaluations/service.py`; semantics in `step-removal-semantics.md`; closed finding UEL-014. |
| `add_scenario` | deferred (this branch) | `create_scenario`/`create_scenarios` exist as CRUD, but a graph-aware `add_scenario` (resolving source bindings, planning cells) is not yet a first-class op; lands later in this branch. proposal.md:372. |
| `remove_scenario` | deferred (this branch) | `delete_scenario(s)` exist as CRUD; a cascade-aware `remove_scenario` (prune the scenario's cells + flush metrics) lands later in this branch. proposal.md:373. |

### Tensor operations

| Operation | Status | Where / Tracking |
| --- | --- | --- |
| `probe(slice)` | **done** | `TensorSliceOperations.probe` / `probe_summary` in `api/oss/src/core/evaluations/runtime/tensor.py`. |
| `populate(slice, results)` | **done** (in-process) | `TensorSliceOperations.populate`. A bulk/slice HTTP write surface is still listed as a gap (gap.md:339). |
| `add_result` | **done** (CRUD) | `create_result`/`create_results` on the service + `/evaluations/results/` routes. This is the low-level cell write that `populate` builds on. |
| `prune(slice)` | **done** | `TensorSliceOperations.prune`. Also driven by `remove_step` via `_prune_removed_steps`. |
| `process(slice)` | **done** | `TensorSliceOperations.process` delegates to an injected `SliceProcessor` (the adapter-free execution seam in `runtime/tensor.py`); the backend impl `BackendSliceProcessor` (`tasks/processor.py`) re-executes the runnable cells for the EXISTING scenarios a `TensorSlice` addresses — rebuilds each scenario's source binding from its stored input cell, re-hydrates trace/testcase context, plans from the run's current graph (so modified steps re-run), runs the cache-aware runners (hashed-trace reuse), populates, and refreshes metrics. With no processor wired it raises rather than silently refreshing metrics. Closed finding UEL-015. proposal.md:160-208. |

### Run operations

| Operation | Status | Where / Tracking |
| --- | --- | --- |
| `refresh_metrics(scope)` | **done** | `EvaluationsService.refresh_metrics` + `/evaluations/metrics/refresh`. Also invoked by the prune cascade for affected scenarios. |
| `set_flag` | deferred (this branch) | No first-class constrained `set_flag`. Flags are currently re-derived from the graph (`_make_run_flags`) and reconciled (`is_queue` via `_reconcile_default_queue`). A constrained setter lands later in this branch. proposal.md:379; gap.md:302, 340. |
| run start / stop / close / open | **done** | `create_run`/`close_run`/`open_run` etc. on the service + routes. |

## What "implement later" means here

The deferred operations above (`add_step`, `add_scenario`, `remove_scenario`,
`set_flag`, a slice-shaped `process`, and bulk `populate`) are planned for this
branch but not yet implemented — they will land in later commits on this branch.
When implemented, they should:

- follow the AGENTS.md domain conventions (`apis/fastapi/evaluations/router.py` +
  `core/evaluations/service.py`), with typed domain exceptions in
  `core/evaluations/types.py`;
- reuse the shared reconcile path so graph mutations keep the graph/tensor invariant
  and re-derive flags + default-queue eligibility consistently with create/edit;
- be slice-shaped where applicable (`TensorSlice`) so setup, retry, queue assignment,
  manual annotation, live ticks, and SDK/local runs share one tensor contract
  (proposal.md:381).
