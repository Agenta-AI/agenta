# Run-status finalization: analysis and options

Status: analysis for UEL-028 (and its overlap with UEL-017 item 1).
Date: 2026-05-21.
Decision: **Option B implemented** (no aggregation) — corrected severity order +
reset `status=RUNNING` on every (re)dispatch. Batch testset/invocation runs are
single-slice today (`process_testset_source_run` issues exactly one slice), so the
multi-slice race (Option C) is not needed now and stays tracked under UEL-017 item 1.

## 1. Problem

A batch (non-queue) evaluation run that completes all its work never transitions to a
terminal `status` — it stays `running` with `flags.is_active=true` indefinitely. On the
dev DB this affected the majority of batch runs (`success=35` vs `running=114`,
`pending=211`).

Reproduced end-to-end with the new LLM-free `mock_v0` workflow: a testset → app →
auto-evaluator run processes both scenarios to `success` and refreshes metrics, but the
run row stays `running` / `is_active=true`.

## 2. Where run status is written

Run status is finalized in `process_evaluation_source_slice`
(`api/oss/src/core/evaluations/tasks/source_slice.py`), and **only** when the caller
passes `update_run_status=True`.

Dispatch (in `tasks/run.py::process_evaluation_run`, by topology):

| topology           | task                        | `update_run_status` | finalizes run status? |
| ------------------ | --------------------------- | ------------------- | --------------------- |
| `live_query`       | `process_query_source_run`  | **False**           | no (stays running)    |
| `batch_query`      | `process_query_source_run`  | **False**           | no                    |
| `batch_testset`    | `process_testset_source_run`| **True**            | yes                   |
| `batch_invocation` | `process_testset_source_run`| **True**            | yes                   |

Implication: **live and batch-query runs never enter the finalize block.** Any change to
finalization affects only `batch_testset` / `batch_invocation`. (Whether `batch_query`
*should* finalize is a separate gap — see §6.)

## 3. The current finalize logic

After processing this slice's scenarios:

```python
if any(item.has_errors for item in processed):      run_status = ERRORS
elif any(item.has_pending for item in processed):   run_status = RUNNING
else:                                               run_status = SUCCESS
# (exception path) ->                               run_status = FAILURE
```

This `run_status` is computed from **this slice's `processed` subset only**, not from the
whole run. To reconcile across slices, a "severity floor" then compares it to the stored
status and keeps whichever is more severe:

```python
severity = {FAILURE:4, ERRORS:3, RUNNING:2, SUCCESS:1, PENDING:0}   # ORIGINAL
current = fetch_run(run_id)
if severity[current.status] > severity[run_status]:
    run_status = current.status
```

### Root cause of UEL-028

`RUNNING` (2) outranks `SUCCESS` (1). When the stored status is `running` (the start
state of every run), a slice that computes `SUCCESS` is floored back **up** to `running`:
`severity[running]=2 > severity[success]=1`. So the run can never leave `running`. It pins
forever.

This is a true P1: the floor's "keep the more severe status" rule treats the transient
`RUNNING` as more severe than the terminal `SUCCESS`, which is backwards for finalization.

## 4. The cases finalization must satisfy

| case | what should happen |
| ---- | ------------------ |
| **single-slice batch** (one slice = whole run; e.g. testset→app→eval) | all scenarios success → run `success`; any error → `errors`; exception → `failure`. |
| **multi-slice batch** (run dispatched as several slices; UEL-017 item 1) | run is terminal only when **all** slices/scenarios are done; an early SUCCESS-only slice must not finalize the whole run while other slices are pending. |
| **extended finished run** (a `success` run gets new steps/scenarios and is re-dispatched) | while new work is pending the run should read `running` again; when the new work completes it should read `success` (or `errors`/`failure` as appropriate). |
| **live / batch-query** | unaffected — never finalizes via this path (`update_run_status=False`). |

The fundamental flaw shared by the original logic **and** the quick severity-reorder fix
is that `run_status` is derived from **one slice's subset** plus a `max()` against the
**stored** status. Neither reflects the run's *actual current* aggregate state, so:

- single-slice: stored `running` wrongly floors over computed `success` (UEL-028).
- multi-slice: a slice can't see other slices' scenarios, so it either finalizes too early
  (no floor) or never (bad floor).
- extended: stored `success` floors over a computed `running`, hiding in-flight pending
  work — or, with the reorder, the opposite mishandling.

## 5. Options

**Constraint (per maintainer):** no full run-wide scenario aggregation in the finalize
path. The finalize must work from what the slice already has plus, at most, cheap O(1)
state — not a scan/count of all the run's scenarios on every slice.

### Option A — Reorder the severity floor (minimal)

Swap `RUNNING` and `SUCCESS` in the severity map so terminal statuses outrank the transient
ones:

```python
severity = {FAILURE:4, ERRORS:3, SUCCESS:2, RUNNING:1, PENDING:0}
```

- **Fixes:** single-slice batch (UEL-028). A computed `SUCCESS` now replaces stored
  `running`. FAILURE/ERRORS still floor over a later SUCCESS-only slice (preserves
  UEL-017's "don't downgrade errors" intent).
- **Does NOT fix:** the **extended-finished** case. If an extension's new slice computes
  `RUNNING` (pending cells), the floor keeps stored `success` (`2 > 1`), so the run wrongly
  shows `success` while new work is in flight. Symmetrically, multi-slice early-finalize is
  not addressed (a SUCCESS slice still finalizes the whole run).
- **Cost:** one-line change; lowest risk; lowest correctness.
- **Verified:** unit test `test_source_slice_processor_preserves_higher_queue_status` still
  passes; the `mock_v0` single-slice flow reaches `success` in ~4s.

### Option B — Correct the severity floor + scope it to a fresh-dispatch start state

Two-part, no aggregation:

1. **Reorder severity** so terminal statuses outrank transient ones (as in A):
   `FAILURE:4 > ERRORS:3 > SUCCESS:2 > RUNNING:1 > PENDING:0`. Fixes UEL-028 single-slice.
2. **Reset the run to a known start state at dispatch** so the floor compares against a
   meaningful baseline. The dispatch/start flow (`service.py:3540-3556`) already sets
   `is_active=True`; have it also set `status=RUNNING` for **every** (re)dispatch — not just
   `just_created`. Then a finished run that is extended starts the new dispatch at `running`,
   and the slice's computed status (SUCCESS / ERRORS) cleanly replaces it via the corrected
   floor. No run-wide scan.

- **Fixes:** single-slice batch (UEL-028) **and** extended-finished (it restarts at
  `running`, then the slice writes the new terminal status).
- **Partial on multi-slice:** with the corrected order, a SUCCESS-only slice can still
  finalize the run before sibling slices finish. The `ERRORS`/`FAILURE` floor still prevents
  *downgrading*, but `RUNNING→SUCCESS` can happen early. Acceptable if batch testset/invocation
  runs are effectively single-slice today (confirm); otherwise pair with Option C.
- **Cost:** the severity one-liner + a one-line change to the start flow
  (`status=RUNNING` on every dispatch). No new queries.
- **Risk:** changing the start flow to always reset `status=RUNNING` affects the perceived
  status of any run being (re)started. This is arguably the correct semantic ("a dispatched
  run is running"), but it is a behavior change for restart.

### Option C — Finalize only on the last slice (for multi-slice, if needed)

Pass `slice_index` / `expected_total_slices` (or a "last slice" flag) into
`process_evaluation_source_slice`; only run the finalize block on the final slice. Cheap
per-dispatch counter, **no aggregation**.

- **Fixes:** multi-slice early-finalize.
- **Does NOT by itself fix:** UEL-028 (the last slice still needs the corrected severity
  order). Layer on top of B only if batch runs are genuinely multi-slice.
- **Cost:** thread a slice counter through dispatch + the SDK boundary; more invasive than B.

## 6. Adjacent gap (not UEL-028)

`batch_query` runs dispatch through `process_query_source_run` with
`update_run_status=False`, so they **also never finalize** their run status — by a different
path than the testset/invocation one fixed here. This should be confirmed with a flow test
and tracked as its own finding (candidate: extend UEL-017 or a new UEL-0xx) rather than
folded into UEL-028.

## 7. Recommendation

No run-wide aggregation. Adopt **Option B**: corrected severity order + reset
`status=RUNNING` on every (re)dispatch in the start flow. Keep the two independent hardening
fixes already applied:

- clear `flags.is_active` when status is terminal (SUCCESS/ERRORS/FAILURE);
- `dao.edit_run` persists `status` via `status.value` + `flag_modified`.

This fixes single-slice (UEL-028) and extended-finished with only O(1) local changes (no
scenario scans). Prove with the flow suite:

- single-slice batch → `success`;
- extended finished run → `running` during extension, `success` after;
- live eval → stays `running`/active (unchanged).

**Multi-slice:** first confirm whether batch testset/invocation runs are ever dispatched as
multiple slices today. If not, B is sufficient and the multi-slice race stays tracked under
UEL-017 item 1. If they are, layer **Option C** (last-slice finalize, cheap per-dispatch
counter — still no aggregation) on top of B.
