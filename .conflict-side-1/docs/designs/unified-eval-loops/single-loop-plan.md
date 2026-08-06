# Single-Loop Plan: `populate` then `process` (two-level cache)

## Goal

**One execution loop. No two paths.** Today the backend has two wrappers around
the same SDK engine (`sdk_process_evaluation_source_slice`):

- `process_evaluation_source_slice` (processor.py:636) — **ingest**: creates NEW
  scenarios from direct ids / query / testset, runs all cells.
- `APISliceProcessor.process` (processor.py:238–488) — **re-execute**: operates on
  EXISTING scenarios by coordinate, reconstructs source from stored cells.

These are not different verbs. They are the **same operation** distinguished only
by whether the inputs already exist. This plan collapses them into one loop.

## The model (the core idea)

`process` is a **two-level cache walk**. For every addressed coordinate cell:

```
1. RESULT level — does the result cell already exist?
     yes  -> reuse it (skip), unless process_mode == "force"
     no   -> go to step 2
2. INPUT/DATA level — is the underlying input already available?
     - the scenario's input cell stores a trace_id / testcase_id?   -> use it
     - a reusable trace exists by HASH (make_hash + fetch_by_hash)?  -> use it
     - the run references a query / testset revision?                -> load internally
     - a DIRECT testcase_id / trace_id with nothing stored yet?      -> must be POPULATED first
3. Execute only the genuine gaps (the cells with no result and resolvable input).
```

Both levels are the same question — *does it already exist?* — applied first to
the **result**, then to the **input**. "Hashing for traces" and "storing the
testcase_id" are exactly the input-level cache: you store the id instead of
re-invoking the thing that generates it.

### Consequence: there is no create-vs-reuse branch

The only thing the loop cannot derive is a **direct `testcase_id` / `trace_id`
that was never stored** — because the id *is* the source identity and there is no
internal way to load it. That, and only that, is what `populate` is for.

| Source kind | Input derivable internally? | Needs explicit `populate`? |
|---|---|---|
| query revision | yes — load rows from the referenced revision | no |
| testset revision | yes — load rows from the referenced revision | no |
| already-run scenario (input cell stored) | yes — read the stored id | no |
| direct `testcase_id` / `trace_id` (fresh) | no — the id is the only identity | **yes** |

### Three primitives — `process` never creates scenarios

"populate then process" glossed over a missing verb. There are **three**
distinct operations, and crucially `process` operates only on scenarios that
**already exist** — it does not mint them:

| Verb | Creates | Does NOT create |
|---|---|---|
| **materialize** | scenarios (the coordinate skeleton for the run) | results |
| **populate** | result cells (input cells carrying the trace_id/testcase_id) | scenarios |
| **process** | result cells (by executing existing cells) | **scenarios** |

`materialize` = `create_scenarios` (service.py:936); `populate` = `set_results`;
`process` = the shared execution loop. Today `APIScenarioFactory`-inside-the-loop
does materialize *implicitly* as a side effect of `process` — this plan pulls it
out and names it, so `process` is uniform: it never creates scenarios for anyone.

So every flow reduces to:

- **direct id ingest** = `materialize(N)` → `populate(input cells for the ids)` → `process`
- **query / testset run** = `materialize(from internally-loaded rows)` → `process` (inputs loaded internally; no explicit populate)
- **re-execute / retry / add-evaluator** = `process` (scenarios + input cells already exist)

`process` is the one execution loop; `materialize` precedes it when scenarios
don't exist; `populate` precedes it when the input identity (direct id) can't be
loaded internally.

## Target API (the single loop)

`process` already exists as `TensorSliceOperations.process` →
`SliceProcessor.process` (tensor.py:42). The unification makes its concrete
implementation the **only** execution loop, and turns the ingest wrapper into a
caller that `populate`s first.

```
process(slice) =
  for each scenario coordinate in the slice (or all run scenarios if unaddressed):
    ensure an input cell exists                          # else: skip — must populate first
    resolve source from the input cell (id / hash / reference)
    plan cells from the run's CURRENT graph
    filter to addressed coordinates (step_keys / repeat_idxs)
    for each cell: result-cache check -> input-cache check -> execute gap
    populate result cells
  (metrics refresh is the separate `refresh` op)
```

The SDK engine (`runtime/processor.py`) is already this loop. The work is in the
API layer: make one wrapper, delete the second.

## Seam analysis (what actually differs today)

Both wrappers call `sdk_process_evaluation_source_slice` and differ in:

| Seam | ingest (line) | re-execute (line) | unified treatment |
|---|---|---|---|
| scenario | `APIScenarioFactory` (869) | `_ExistingScenario` (431) | **input-cache check** — reuse if input cell exists, else the caller populated it; no policy branch |
| source data | `resolve_direct_source_items` (800) | `_source_item_from_input_cells` (351) | one resolver: read stored id → hydrate; query/testset load by reference |
| cell filter | none | `target_keys` closure (466) | `cell_filter` pass-through (None = all) |
| metrics | `APIMetricsRefresher` (883) | `_noop_refresh_metrics` (442) | **shared** — re-execute stops opting out; both inject the real refresher so `process` refreshes incrementally per-scenario AND rolls up at the end, exactly as the SDK loop already does (sdk processor.py:270, 297). The metric *kind* (variational/temporal/global) is already derived from scope by `service._refresh_metrics`. The separate `refresh` op + `_noop` are deleted. |
| post-process: status | per-scenario `edit_scenario` + run severity-floor + is_active (991–1054) | none | **shared** — `process` finalizes from the touched set it already returns (`ProcessedScenario.has_errors/has_pending` per scenario; floored to the run). Two flags: `finalize_run_status` (False for live-query, which loops) and the is_active flip (terminal only). The concurrent-slice re-fetch / `is_active` race fix moves verbatim into the shared finalize. |

**Why post-process is shared, not ingest-only:** status + which-metrics-to-refresh
are a function of *what coordinates were touched* — which the shared loop already
knows (it returns `processed`). The reasoning is identical regardless of how the
run was triggered; and since we hold the run lock (one process per run at a time),
the shared path has full control to finalize before releasing. A slice covering
the whole run IS a batch evaluation — its "done" must match today's batch path.

Everything else (steps mapping, runners/revisions via
`_resolve_runners_and_revisions`, `trace_loader`, `is_split`,
batch_size/max_retries) is **already identical** and intrinsic to `run`.

### The one-sentence shape

- **ingest** = `populate` → `process` → done
- **re-execute** = `process` → done

…where **`process` owns "done"** (status finalize + scoped, incremental metric
refresh from what was touched). `populate` is the only divergence, and only for
direct ids that can't be loaded internally.

## Staging (incremental, never two paths in the middle)

The end state is one loop, but the move is staged so the working ingest path is
never destabilized. Each stage leaves the suite green.

### Stage 1 — collapse source shaping (pure dedup, zero behavior change)
- Extract one `_to_sdk_source_item(...)` helper; the
  `SdkResolvedSourceItem(...)` construction is byte-identical at processor.py
  816–831 and 372–383. Replace both.
- Guard: existing unit + acceptance suites green.

### Stage 2 — one source resolver (input-level cache)
- A single `resolve_source_for_scenario(...)` that implements the input-cache
  ladder: stored id → hash-reuse → reference-load. `resolve_direct_source_items`
  and `_source_item_from_input_cells` both fold into it.
- Re-execute and ingest both call it; the only difference becomes whether the
  input cell pre-exists (re-execute) or was just populated (ingest).

### Stage 3 — one execution loop
- A single `process_source_slice(...)` does the per-scenario loop + SDK call.
  `APISliceProcessor.process` becomes a thin caller (adds coordinate filter +
  ProcessSummary accounting). `process_evaluation_source_slice` becomes a thin
  caller (adds queue validation + run finalization, both run-level).
- Delete the duplicated SDK call site.

### Stage 4 — `process` owns "done" (shared finalize)

- Fold post-process into the shared loop: per-scenario status writes + run
  severity-floor + `is_active`, derived from the `processed` set the loop already
  returns. Re-execute stops injecting `_noop_refresh_metrics` and injects the real
  refresher, so metrics refresh incrementally per-scenario AND roll up at the end
  for BOTH paths (timing unchanged from today — the SDK loop already does this).
  The separate `refresh` op / `_noop` are deleted.
- Two flags split from the old single `update_run_status`:
  `finalize_run_status` (False for the live-query loop, which never finalizes) and
  the `is_active` flip (terminal status only). The concurrent-slice re-fetch
  (`is_active` race fix) moves verbatim into the shared finalize.

### Stage 5 — the coordinate-dimension ops (`process` never creates scenarios)

The coordinate space is `scenarios × steps × repeats`. `process` operates only on
EXISTING coordinates; the dimensions are managed by first-class graph ops. This
pass lands the ones ingest needs (the others stay deferred):

- **`add_scenarios(run, n)`** — create N scenario skeleton rows for the run (rows
  only; no input cells, no results). This is the deferred `add_scenario` op from
  operations.md:50, implemented thin (skeleton only — `populate` writes the input
  cell, `process` plans+executes). Wraps `create_scenarios` (service.py:936).
- **`set_repeats(run, repeats)`** — resize the repeat dimension (today `repeats`
  is fixed at create, EvaluationRunData.repeats:226). NB: a `set_repeats` pydantic
  *validator* already exists (types.py:231) — the op needs a distinct name
  (`resize_repeats` / `add_repeats`) to avoid the collision.
- `process` is made uniform: it never mints scenarios for anyone (the
  `APIScenarioFactory`-inside-the-loop is removed). Callers `add_scenarios` first.

Deferred siblings (noted, not in this pass): `add_steps`, `remove_scenarios`,
`set_flag`.

### Stage 6 — direct-id ingest = add_scenarios → populate → process

- `run.py` traces/testcases ingest becomes: `add_scenarios(N)` →
  `populate(input cells carrying the ids)` → `process(those scenario_ids)` →
  shared finalize.
- Query/testset keep loading rows internally and `add_scenarios` from them, then
  `process` (no explicit populate — inputs load by reference).
- Guard: parity test — direct-id ingest and the explicit
  add_scenarios→populate→process produce identical result cells + status + metrics.

## The one genuine limit (by design, not a gap)

`process` cannot run a coordinate whose scenario has **no input cell and no
internal reference** — there is nothing to resolve. Today this is counted as
`failed` and skipped (processor.py:355). That is correct: it is exactly the case
`populate` must handle first. The loop never tries to conjure a source from
nothing.

## Risk / blast radius

- **Run finalization** (severity-floor + `is_active`, the concurrent-slice race
  fix) must stay a run-level caller concern, never leak into the per-slice loop —
  re-execute must not finalize.
- **Queue validation** (`require_queue`) is ingest-only; stays in the ingest
  caller.
- **timestamp / interval** (live-query window) must thread through to scenario +
  result writes.
- **is_split** must be computed once and shared between the cell filter and the
  SDK plan, or they diverge.

## Tests guarding the move

- `unit/evaluations/test_tensor_slice_ops.py` — the `process`/`probe`/`populate`
  surface (the single-loop entry).
- `unit/evaluations/test_runtime_topology_planner.py` — source-slice + re-execute
  parity, the "no input cell → skipped" branch.
- `unit/evaluations/test_query_eval_loops.py` — live/batch-query (finalize=False,
  timestamp/interval seam).
- `acceptance/evaluations/test_tensor_slice_endpoints.py` — HTTP contract +
  populate→probe round-trip.
- New parity test: `ingest(direct ids)` ≡ `populate + process`.
