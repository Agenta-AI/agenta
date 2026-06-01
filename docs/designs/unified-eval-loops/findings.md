# Unified Eval Loops Findings

Review scope: full `feat/unified-eval-loops` branch diff against `main`, with emphasis on the most recent `evals<>queues implementation` commit (`603820f5a`).

Sources:

- Fresh deep scan of code, docs, tests, and migrations on the active checkout.
- 2026-06-01 deep scan of the current `feat/unified-eval-loops` checkout, focused on the new `TensorSlice` execution path (`runtime/tensor.py` -> `tasks/processor.py` -> SDK runtime planner/logger).
- User-provided full pytest failure output from the API suite: 41 failed, 1344 passed, 8 skipped.
- Full reread of every document in `docs/designs/unified-eval-loops/` during the current applicability audit.
- Targeted local checks:
  - `pytest -q ee/tests/pytest/unit/test_controls_env_override.py::TestNoOverride::test_billing_pricing_accepts_legacy_agenta_pricing_alias ee/tests/pytest/unit/test_controls_env_override.py::TestNoOverride::test_billing_pricing_accepts_legacy_stripe_pricing_alias` passed locally.
  - Targeted auth/meters/db-manager tests reproduced the stale monkeypatch failures from UEL-024.
  - Targeted evaluation-runtime tests could not collect in the local shell because `agenta.sdk.evaluations.runtime` was not importable from that invocation; the user-provided full-suite output remains the validation source for those failures.
- Design references: `docs/designs/unified-eval-loops/{proposal,plan,gap,research,step-removal-semantics}.md`.
- Extension references: `docs/designs/unify-evals-and-queues/{proposal,plan,gap,unify-evals-extension-synthesis,unify-evals-extension-verbatim,research}.md`.
- Existing closed findings (UEL-001..UEL-006) retained below for history; reviewed only after the independent pass.

## Summary

- Status: 2 open findings from the current 2026-06-01 scan.
- Highest severity: `P1` (`UEL-032`).
- Focus area: the newly wired `TensorSlice` re-execution path for existing scenarios.
- New findings:
  - `UEL-032`: existing-scenario slice re-execution still uses insert-only result logging, so reruns collide with the `evaluation_results` uniqueness constraint instead of replacing or reusing cells.
  - `UEL-033`: slice targeting is incomplete; the processor derives scenario scope from already-existing addressed cells and ignores `repeat_idxs` when planning, so "fill missing cells" / partial-repeat execution silently no-op or over-execute.

## Notes

- 2026-05-20 re-audit: re-scanned current code against every OPEN finding without applying fixes. Status/diagnosis corrections recorded inline under each finding's `Re-audit (2026-05-20)` block. Net result: UEL-021 and UEL-022 share a single confirmed root cause (source-backed evaluator origin default) that is more precise than the original "kind conflation" diagnosis; UEL-021's claimed expected `kind` values are wrong; UEL-017's failing assertion is a flag-gate bug, not the multi-batch race the finding describes; UEL-023's `interface`/`configuration` sub-issue is stale (closed via UEL-003) and the actual failing assertion is unfiltered `inputs`.
- No local full-suite test execution was performed while auditing these findings; findings marked `reproduced` either come from the user-provided full-suite output or from the targeted local checks listed above.
- Findings below were re-checked against current code. Where runtime confirmation is still missing, the finding flags it and may need handoff to `test-codebase`.
- The branch carries two intertwined design tracks: unified evaluation loops (planner / source resolvers / tensor slice / runnable executor) and the evals×queues unification (default queue lifecycle + flag redefinitions). Findings cover both.
- Do not fix test-hook drift by adding broad production proxy objects. Prefer direct test injection/patching where the code already supports it, or add narrow compatibility helpers with a clear production purpose.

## Open Questions

- ~~Should the legacy migration that mass-creates default queues for all existing runs gate on `has_human`/policy in a single pass, or is the runtime "first-edit reconciles" lag acceptable?~~ **Resolved (2026-05-21):** the migration now mirrors the runtime create policy in a single pass — it creates default queues only for `has_human=true` runs, archives stale active default queues for runs that no longer qualify, and carries the run's own status instead of a hardcoded `running`. No reconcile lag. See UEL-010 (closed).
- ~~Is destructive `remove_step` + `prune` still the chosen lifecycle per `step-removal-semantics.md`? If so, when is the missing implementation expected?~~ **Resolved (2026-05-21):** destructive remove + prune is confirmed and implemented. Rather than a separate `remove_step` endpoint, the prune cascade is folded into the shared create/edit reconcile path (`EvaluationsService._reconcile_run`): `create_run` is "edit from an empty graph" (`prior_step_keys=set()`, prune is a no-op), and `edit_run` diffs the prior graph and prunes cells + input-only orphan scenarios + flushes metrics for any dropped step. See UEL-014 (closed).
- ~~For source-backed queues, should the public `SimpleQueueData.kind` report the source family (`queries` / `testsets`) or the executable scenario family (`traces` / `testcases`)?~~ **Resolved by 2026-05-20 re-audit:** the failing tests assert the *source* family (`kind="queries"` / `kind="testsets"`), so the current mapping is correct and the real bug is the `is_queue=False` / evaluator-origin default. See UEL-021 re-audit.
- ~~Should legacy unit tests keep monkeypatching module-level `posthog` / `engine` symbols, or should they be updated to patch dependency factories / constructor injection?~~ **Resolved by 2026-05-20 re-audit:** update the tests to patch the current seam (`_load_posthog`, `get_transactions_engine`, or constructor-injected engine) — production proxy globals are explicitly disallowed by the Notes guidance. See UEL-024 re-audit.

## Open Findings

### [OPEN] UEL-032: Existing-scenario `process(slice)` still writes through insert-only result logging, so reruns collide on duplicate result keys

- ID: `UEL-032`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: The new `BackendSliceProcessor` is explicitly framed as re-executing EXISTING scenarios, but it delegates all cell writes to `BackendResultLogger`, which writes result cells through the result-setter path. `evaluation_results` remains unique on `(project_id, run_id, scenario_id, step_key, repeat_idx)`, so any slice rerun that touches an already-populated cell needs explicit overwrite/fill-missing semantics. The collision happens immediately for input cells because the SDK planner always includes them for the bound scenario.
- Evidence:
  - `api/oss/src/core/evaluations/tasks/processor.py:325-337` re-executes a `TensorSlice` against `_ExistingScenario(scenario_id)`, i.e. it intentionally targets the original scenario rather than creating a new one.
  - `api/oss/src/core/evaluations/runtime/adapters.py:178-205` shows `BackendResultLogger.log()` writing through `evaluations_service.set_results(...)`.
  - `api/oss/src/dbs/postgres/evaluations/dbes.py:135-141` keeps the uniqueness constraint on `(project_id, run_id, scenario_id, step_key, repeat_idx)`.
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py:84-119` always plans input cells for every repeat, so even a slice that only intends to rerun one evaluator still attempts to insert duplicate input rows for the reused scenario.
  - `api/oss/src/core/evaluations/service.py` now exposes `set_results(...)`; this finding tracks whether its overwrite semantics are correctly scoped for rerun vs fill-missing.
- Impact:
  - `TensorSliceOperations.process()` cannot safely support retry/re-run on an already-populated scenario, which is the core contract it was added to provide.
  - The failure is deterministic for common rerun cases, not edge-case timing: any addressed cell that already exists becomes a unique-key conflict.
  - Because the write path is shared with the SDK loop adapter, callers can get a hard failure after doing the expensive rehydration and planning work.
- Files:
  - `api/oss/src/core/evaluations/tasks/processor.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `api/oss/src/dbs/postgres/evaluations/dbes.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py`
- Cause: The branch correctly introduced an "existing scenario" execution adapter, but it still needs explicit execution-mode semantics at the result persistence boundary.
- Explanation: The design split between ingest (`new scenario`) and rerun (`existing scenario`) was only applied at the scenario factory seam. It was not applied at the result persistence seam, so the processor now mixes "reuse scenario id" with "insert brand-new result rows".
- Suggested Fix:
  - Keep two explicit slice execution modes:
    - default `fill-missing`: create only missing addressed cells and leave existing ones untouched
    - explicit `force`/`rerun`: re-execute addressed cells even when they already exist
  - Implement the force path with coordinate-aware overwrite semantics on `(run_id, scenario_id, step_key, repeat_idx)` while preserving the same uniqueness invariant.
  - Restrict both modes to the addressed slice so reruns remain explicit and do not mutate unrelated cells.
  - Add focused coverage for both behaviors: one test that fill-missing leaves an existing cell unchanged, and one test that force-rerun updates an existing addressed cell without raising `EntityCreationConflict`.
- Alternatives:
  - Replace existing addressed cells with a delete-then-create flow before rerun logging. Simpler than a true upsert, but it loses result row identity and makes partial failure handling trickier.
- User Direction (2026-06-01):
  - Preferred path is dual behavior, e.g. a `force`/`rerun` flag for overwrite semantics while keeping fill-missing as the default.
- Sources:
  - `api/oss/src/core/evaluations/tasks/processor.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `api/oss/src/dbs/postgres/evaluations/dbes.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py`
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
  - `api/oss/src/core/evaluations/types.py`

### [OPEN] UEL-033: `BackendSliceProcessor` silently drops missing-cell scenarios and ignores `repeat_idxs` when planning reruns

- ID: `UEL-033`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The slice processor claims to support "retry / fill-missing / re-run-one-evaluator", but it derives its working `scenario_ids` from already-existing cells inside the addressed slice and then passes the run's full `repeats` count into the SDK planner. That means a slice aimed at missing cells returns early with `ProcessSummary()` if those target cells do not exist yet, and a slice aimed at a specific repeat still plans every repeat for the scenario.
- Evidence:
  - `api/oss/src/core/evaluations/tasks/processor.py:233-250` queries existing cells using the incoming `scenario_ids`/`step_keys`/`repeat_idxs`, then replaces the requested scenario scope with `scenario_ids = sorted({cell.scenario_id ...})`; if the addressed cells are missing, `scenario_ids` becomes empty and the processor returns immediately.
  - `api/oss/src/core/evaluations/tasks/processor.py:263-264` records `requested_repeats`, but the only later use is logging; it is never enforced in planning or result filtering.
  - `api/oss/src/core/evaluations/tasks/processor.py:325-329` calls the SDK runtime with `repeats=run.data.repeats`, not the requested subset from `tensor_slice.repeat_idxs`.
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py:84-119` expands `repeats` into `range(count)` and plans cells for each repeat index; there is no repeat-subset input at that seam.
- Impact:
  - The documented "fill missing cells" behavior is broken for the common case where the missing cells are exactly what the slice is targeting.
  - Partial reruns such as "rerun repeat 1 only" over-execute by planning all repeats for the scenario.
  - Together with UEL-032, this means the branch currently supports neither safe rerun nor safe fill-missing semantics for `process(slice)`.
- Files:
  - `api/oss/src/core/evaluations/tasks/processor.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py`
- Cause: The backend adapter reused the ingest-time SDK contract without adding a slice-aware planning layer for existing scenario coordinates.
- Explanation: `TensorSlice` is an output-coordinate API (`scenario_ids x step_keys x repeat_idxs`), but the processor rebuilds execution from "whatever cells already exist" plus "full run repeat count". That is sufficient for broad scenario reruns, not for the precise sparse-slice semantics the new API advertises.
- Suggested Fix:
  - Preserve the caller-provided `tensor_slice.scenario_ids` as the authoritative scenario scope; use existing-cell probes only to recover source bindings, not to decide whether the scenario should execute.
  - Add a repeat-aware planning seam for reruns, either by teaching the SDK planner/processor to accept a repeat subset or by filtering the generated plan before any logging/execution occurs.
  - Add tests for two cases: processing a missing evaluator cell on an existing scenario, and rerunning only `repeat_idx=1` while `repeat_idx=0` remains untouched.
- Alternatives:
  - Narrow the contract and document that `process(slice)` only supports whole-scenario reruns against already-populated repeats. That would still require validating and rejecting unsupported sparse slices instead of silently returning success.
- User Direction (2026-06-01):
  - Fix this behavior; do not narrow the contract.
- Sources:
  - `api/oss/src/core/evaluations/tasks/processor.py`
  - `sdks/python/agenta/sdk/evaluations/runtime/planner.py`

## Closed Findings

### [CLOSED] UEL-015: `TensorSliceOperations.process` only refreshes metrics; the documented `process(slice)` contract is unimplemented

- ID: `UEL-015`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Completeness`
- Summary: `TensorSliceOperations.process` is the only in-process implementation of the design's central `process(slice)` operation. It does not plan, execute, or populate cells — it only calls `evaluations_service.refresh_metrics(...)` and returns an empty `ProcessSummary`. The actual planner/executor pipeline runs only through `tasks/source_slice.py` and `tasks/run.py`, which are full-batch entrypoints rather than slice-aware.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/tensor.py:151-169`: `process` body is `await refresh_metrics(...)` then `return ProcessSummary()`. No planner/runner invocation.
  - `docs/designs/unified-eval-loops/proposal.md:160-208` describes `process(run, slice)` as the full plan-and-execute loop.
  - `tasks/source_slice.py:174-566` implements something close to the contract but is keyed on `run_id`/`source_items`/`testcase_ids`/`trace_ids`, not on the canonical `TensorSlice` shape.
- Impact:
  - Slice-aware retries, partial re-execution by `(scenario_ids, step_keys, repeat_idxs)`, and the "probe-before-write" workflow described in `gap.md` §"Execution Gaps" are not yet possible.
  - The current `process` reads like a complete implementation (it does mutate metrics) but silently does almost nothing. Callers may believe they have executed a slice when they have only refreshed metrics.
- Files:
  - `api/oss/src/core/evaluations/runtime/tensor.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
- Cause: The slice operation surface was scaffolded ahead of the planner/runner wiring needed to make `process(slice)` operational.
- Suggested Fix:
  - Either route `process(slice)` through the source-slice processor by translating `TensorSlice` into the parameters that `process_evaluation_source_slice` already accepts, or rename `TensorSliceOperations.process` to clarify that it is only a metrics refresh.
  - Add a unit test that asserts the documented behavior (execute auto cells in the slice, populate result cells, return a non-empty `ProcessSummary`).
- Alternatives:
  - Mark this method explicitly as `metrics-refresh-only` and provide a separate `execute(slice)` method when planner integration lands. Keep the contract honest.
- Re-audit (2026-05-20): **Still reproduces.** `runtime/tensor.py` `process` (def at line 151) early-returns `ProcessSummary()` (line 159), calls `refresh_metrics(...)` (line 161), and returns an empty `ProcessSummary()` (line 169). No planner/runner invocation. Diagnosis and severity unchanged.
- Resolution (2026-05-22): made `process(slice)` an honest plan->execute->populate->refresh op via the design's "same executor, different adapters" seam, rather than faking it or renaming it down. Two parts:
  - **Seam (`runtime/tensor.py`).** Added a `SliceProcessor` protocol and an optional `slice_processor` dep on `TensorSliceOperations`. `process` now short-circuits empty slices, then delegates to the injected processor; with no processor wired it raises `NotImplementedError` instead of silently refreshing metrics and returning an empty summary (the actual bug — it "silently does almost nothing"). The seam is adapter-free so `runtime/` does not depend on `tasks/`; the concrete impl is injected at the composition root.
  - **Backend executor (`tasks/processor.py`).** Added `BackendSliceProcessor`, the real slice re-executor for the canonical `TensorSlice` (existing scenarios x steps x repeats — the retry / fill-missing / re-run-one-evaluator axis). For each scenario it rebuilds the source binding from the stored input result cell (`trace_id` for trace/query sources, `testcase_id` for testcase/testset sources), re-hydrates trace/testcase context via `resolve_direct_source_items`, plans from the run's CURRENT graph (so modified steps re-run with freshly resolved revisions), and reuses the SDK `process_evaluation_source_slice` engine with an existing-scenario `create_scenario` adapter — so cells populate against the addressed scenario, not a new one. Hashed-trace handling is correct because the runners are `BackendCachedRunner`s (cache lookup by step references/links before invoking), shared with the ingest path via the extracted `_resolve_runners_and_revisions` helper.
  - This is the design distinction the finding's "Suggested Fix" missed: `process_evaluation_source_slice` is an INGEST loop (one source item -> one freshly CREATED scenario), so it could not be a thin translation target for a `TensorSlice` that addresses EXISTING cells. The re-executor bridges the two by reconstructing bindings from stored cells.
  - Tests (`api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`): existing tensor-ops test now asserts `process` raises without a processor (was: returns empty summary + refreshes metrics); added `test_tensor_slice_process_delegates_to_injected_processor` and `test_backend_slice_processor_reexecutes_existing_scenario` (rebuilds source from input cell, reuses the existing scenario, wires the auto evaluator runner). Full api suite green via `py-run-tests`.

### [CLOSED] UEL-009: Inferred-flag derivation is shared between migration and runtime, with brittle heuristics

- ID: `UEL-009`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Soundness`
- Summary: The DAO-side helper `_make_run_flags` (`api/oss/src/dbs/postgres/evaluations/utils.py:73-138`) is the canonical place that derives the eight `has_*` flags from `run.data.steps`. It is invoked from `create_run_flags` / `edit_run_flags`, which the DAO calls inside `create_run` / `create_runs` / `edit_run` / `edit_runs`. The data migration (`a2b3c4d5e6f8`) duplicates the same heuristic in SQL. Both rely on two fragile rules: (1) substring matching of reference keys for `has_queries` / `has_testsets`, and (2) hardcoded step.key literals `{"traces", "query-direct", "testcases", "testset-direct"}` with empty references for `has_traces` / `has_testcases`.
- Evidence:
  - `api/oss/src/dbs/postgres/evaluations/utils.py:104-136` walks `run.data.steps`, resets the eight `has_*` flags, and recomputes them from step shape.
  - Lines 113-116 set `has_traces=True` if `step.key.lower() in {"traces", "query-direct"}` and refs are empty; same idiom for `has_testcases` with `{"testcases", "testset-direct"}`.
  - Lines 118-124 set `has_queries=True` if any reference key contains the substring `"query"`; `has_testsets=True` if it contains `"testset"`. A reference key like `query_anchor`, `subquery`, or `testset_metadata` would falsely trigger either flag.
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:24-39` uses the same literals to backfill `has_traces` / `has_testcases` on existing rows.
  - `docs/designs/unified-eval-loops/research.md:316-323` and `docs/designs/unify-evals-and-queues/unify-evals-extension-synthesis.md:30-33` explicitly identify "synthetic step-key inspection" as a target for removal under the new model.
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py:61-111` locks in the current heuristic (steps named `"traces"` / `"testcases"` with empty refs are expected to produce `has_traces=True` / `has_testcases=True`).
- Impact:
  - Runtime and migration agree on the heuristic, so the backfill is internally consistent with new inserts. The risk is structural, not immediate.
  - Any caller that constructs a direct-source input step with a non-matching `step.key` (e.g. `"my_traces_source"`) will silently produce `has_traces=False`. Downstream dispatch checks (`SimpleQueuesService._get_kind`, `dispatch_trace_slice`, `dispatch_testcase_slice`) will then misclassify or refuse the run.
  - Any future reference key containing the substring `"query"` or `"testset"` (e.g. a hypothetical `query_anchor` or `testset_metadata` ref on an unrelated step) would incorrectly flip `has_queries` / `has_testsets` to `True`.
  - The two heuristics live in two languages (Python and SQL). A future change to the rule must be applied in both places to keep backfilled and runtime rows consistent.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/utils.py`
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py`
- Cause: There is no structural marker on a step that identifies its source family. Until one exists, both the migration and the DAO must infer from `step.key` / `step.references` shape.
- Suggested Fix:
  - Introduce a structured marker on `EvaluationRunDataStep` for source family (e.g. a `source_kind: Literal["query","testset","trace","testcase"]` field, or a sentinel reference `{"direct_source": Reference(...)}`) and have both the DAO and the migration read it.
  - Until then, harden the substring match by enforcing exact reference-key membership (`"query_revision" in references` rather than substring-on-key) and lock the direct-source step keys in a single shared constant referenced from both Python and the migration.
  - Add a unit test that asserts `has_queries` does NOT trigger for a fake reference key like `"some_query_anchor"`.
- Alternatives:
  - Accept the heuristic as the persistent rule and document it as a contract; gate any future step-key changes through a versioning check.
- Re-audit (2026-05-20): **Still reproduces.** Confirmed in `oss/src/dbs/postgres/evaluations/utils.py`: hardcoded direct-source step keys `{"traces", "query-direct"}` / `{"testcases", "testset-direct"}` at lines 113-116, and substring matching `"query" in step_key` / `"testset" in step_key` at lines 121-124 (refs in finding cited 104-136 / 118-124; logic unchanged, lines shifted to ~94-124). Diagnosis and severity unchanged.
- Resolution (2026-05-22): adopted the "harden to exact membership" path. `_make_run_flags` now keys `has_queries` / `has_testsets` on EXACT reference-key presence (`query_revision` / `testset_revision`) instead of substring matching, with the key sets pulled into module constants; direct-source keys stay in `DIRECT_TRACE_STEP_KEYS` / `DIRECT_TESTCASE_STEP_KEYS`. The backfill in `a2b3c4d5e6f8` was updated to match (JSONB `?` key-presence, not substring). Unit tests assert `query_anchor` / `testset_metadata` do NOT trigger the flags and that the exact key still triggers among other refs. The duplication across Python + SQL remains (two languages), and the heuristic-vs-structural-marker tradeoff is unchanged — a `source_kind` marker on the step is still the longer-term option but was not needed to remove the substring fragility.

### [CLOSED] UEL-011: No tests cover default-queue reconciliation, archive/unarchive, or `_validate_default_queue_data`

- ID: `UEL-011`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Testing`
- Summary: The evals×queues unification adds a lot of new behavior — `_reconcile_default_queue`, `archive_queue`, `unarchive_queue`, `_validate_default_queue_data`, `_sync_run_queue_flag_for_default_queue`, default-queue lookup, partial unique index — but pytest coverage is zero.
- Evidence:
  - `grep -rn "default queue\|default_queue\|is_default" api/oss/tests/pytest/` returns no relevant hits (matches are all unrelated workspace/project `is_default`).
  - `grep -rn "reconcile_default_queue\|archive_queue\|unarchive_queue\|fetch_default_queue\|EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS" api/oss/tests/` returns nothing.
  - Existing acceptance tests in `test_simple_queues_basics.py` cover queue creation and source-family resolution but do not exercise default-queue lifecycle.
- Impact:
  - The entire unified-queues lifecycle is unverified. UEL-008/UEL-009/UEL-010/UEL-013 in particular would have been caught by basic coverage.
  - Future refactors of `_reconcile_default_queue` have no safety net.
- Files:
  - `api/oss/tests/pytest/` (no relevant tests)
  - `api/oss/tests/pytest/unit/evaluations/test_run_flags.py` (covers other flag aspects but not queue reconciliation)
- Cause: The implementation was prioritized over tests; the design (`unify-evals-and-queues/gap.md` §Tests) lists exactly these as required test cases.
- Suggested Fix:
  - Add unit tests for `_reconcile_default_queue` under all four state transitions (`required+missing`, `required+archived`, `required+active`, `not required+active`).
  - Add tests for `archive_queue`/`unarchive_queue` returning `None` when the queue is missing, raising for closed runs, and syncing `run.flags.is_queue`.
  - Add tests for `_validate_default_queue_data` rejecting `user_ids`, `scenario_ids`, `step_keys`, `batch_size`, `batch_offset` on `is_default=True` queues, both in create and edit paths.
  - Add a DAO/integration test asserting that the partial unique index `ux_evaluation_queues_default_per_run` prevents two default queues per run (including archived rows).
  - Add a regression test for `delete_queue`/`delete_queues` raising "default queues must be archived, not hard deleted".
- Alternatives:
  - Cover the same surface through acceptance tests over the HTTP routes (`/queues/{id}/archive`, `/runs/{id}/default-queue`). Reduces unit-level reach but covers HTTP wiring at the same time.
- Resolution (2026-05-22): coverage added via the HTTP-route alternative. `test_default_queue_lifecycle.py` exercises all four reconcile transitions (required+missing → create, not-required+active → archive, required+archived → unarchive, required+active → no-op) plus the non-human (no default queue) case, asserting `is_queue` sync each time; `test_default_queue_policy.py` covers `_validate_default_queue_data` rejection of `user_ids`/`scenario_ids`/`step_keys`/`batch_size`/`batch_offset` (create + edit), demotion/deletion-forbidden, and the partial-unique-index uniqueness (reject second active default, recreate after archive, allow across runs — see UEL-030). The planted-`is_queue` reconcile-back regression (UEL-020) is also here. Default-queue lifecycle is no longer untested.

### [CLOSED] UEL-020: `is_queue` is recomputed only at the service layer; the DAO neither resets nor derives it

- ID: `UEL-020`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Soundness`
- Summary: The DAO helper `_make_run_flags` resets the eight `has_*` flags on every `create_run` / `edit_run` and re-derives them from `run.data.steps`. It does not touch `is_queue`, which is computed only by `_reconcile_default_queue` and `_sync_run_queue_flag_for_default_queue` at the service layer. Any caller that bypasses the service and writes to the DAO directly (or any future caller that constructs `EvaluationRunFlags(is_queue=True)` and calls `edit_run`) can plant a stale `is_queue` value that survives until reconciliation runs again. The same asymmetry means the DAO has no invariant to detect or correct a desynced `is_queue` on read.
- Evidence:
  - `api/oss/src/dbs/postgres/evaluations/utils.py:94-102` resets only `has_queries`, `has_testsets`, `has_traces`, `has_testcases`, `has_evaluators`, `has_custom`, `has_human`, `has_auto`. `is_queue` is left to whatever the caller passed (or the row already had).
  - `api/oss/src/core/evaluations/service.py:440-447` writes `is_queue` based on `has_human AND default_queue.deleted_at IS NULL`, only inside `_reconcile_default_queue`.
  - `api/oss/src/core/evaluations/service.py:1818-1849` writes `is_queue` only when the changed queue is `is_default=True`.
  - `api/oss/src/core/evaluations/service.py:511-533` and `587-635` are the only paths that chain reconcile after a run write. A caller using `evaluations_dao.edit_run` directly will skip reconcile entirely.
  - Design contract: `is_queue` is "active default queue exists AND active human evaluator work exists" (`docs/designs/unify-evals-and-queues/unify-evals-extension-synthesis.md:40-55`). This is a derived fact that should not be persistable by the DAO without re-derivation.
- Impact:
  - In the current codebase, every write path goes through the service, so reconcile fires. The persisted value is correct in practice.
  - Any new code that writes via the DAO (background jobs, EE extensions, future operations like `add_step`/`remove_step`) must remember to call reconcile or it will leave `is_queue` stale.
  - There is no DAO-layer invariant test that flags a desynced row, so a regression can go unnoticed.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/utils.py`
  - `api/oss/src/core/evaluations/service.py`
- Cause: `is_queue` depends on facts outside `run.data.steps` (the existence and lifecycle of a default queue), which the DAO does not load. Service-layer reconciliation was added later as the single source of truth.
- Suggested Fix:
  - Document the invariant in `utils.py` (`# is_queue is service-derived; do not write directly`) and add a service-layer regression test that calls `edit_run` with `is_queue=True` on a run that should not be queue-eligible and asserts reconciliation flips it back.
  - Alternatively, move `is_queue` out of the persisted flag and compute it on read in the service layer, so it cannot be wrong.
- Alternatives:
  - Keep `is_queue` persisted but enforce reconciliation as part of every `edit_run` call (e.g. wrap the DAO call inside a service decorator that always runs reconcile afterward).
- Resolution (2026-05-22): adopted the Suggested Fix. The invariant is now documented in `_make_run_flags` (`is_queue` is service-derived, owned by `_reconcile_default_queue`; do not write via the DAO without running reconcile). A regression test (`test_default_queue_lifecycle.py::test_planted_is_queue_flag_is_reconciled_back`) PATCHes `is_queue=True` onto a non-human (non-eligible) run and asserts the edit path reconciles it back to `False` with no default queue. Kept `is_queue` persisted (the compute-on-read alternative was not needed); every write still routes through the service reconcile.

### [CLOSED] UEL-017: Source-aware queue runs may transiently flip run status during multi-batch dispatch

- ID: `UEL-017`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `not-a-bug`
- Category: `Correctness`
- Summary: `process_evaluation_source_slice` writes the run status (`RUNNING`/`SUCCESS`/`ERRORS`/`FAILURE`) at the end of each invocation when `update_run_status=True`. For source-aware queues that dispatch multiple batches (`_dispatch_source_batches` triggers several slice runs), each batch can flip the status before subsequent batches arrive, producing a `SUCCESS` -> `RUNNING` -> `SUCCESS` thrash.
- Evidence:
  - `api/oss/src/core/evaluations/tasks/source_slice.py:527-563` writes `run.status = run_status` after the slice, gated only by `severity` ordering against the **current** persisted value (not against in-flight slice arrivals).
  - `api/oss/src/core/evaluations/tasks/run.py:109-148` and `tasks/source_slice.py:174-205` are invoked once per slice, not once per run.
  - Source-aware queue creation in `SimpleQueuesService._dispatch_source_batches` (referenced at `service.py:3730-3743`) ships multiple slices for a single run.
- Impact: Operators observing a run during multi-batch dispatch may see status oscillate. Idempotent observers and frontend status displays may flicker. The severity rule at line 543-547 floors at the higher status, but only against the previously persisted status — not against still-pending parallel slices.
- Files:
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
- Cause: Status update logic was written for the single-slice case and re-used for multi-slice dispatch without coordination.
- Suggested Fix:
  - Pass an explicit `expected_total_slices` / `slice_index` (or a "this is the last slice" flag) into `process_evaluation_source_slice`, and only update the run status on the final slice.
  - Alternatively, move run-status reconciliation out of the slice loop into a separate run-finalize task that aggregates across slices.
- Alternatives:
  - Document the thrash and accept it. Cheaper but degrades the UX promise of the unified loop.
- Re-audit (2026-05-20): **A concrete, test-failing sub-bug exists that this finding does not capture; promote to `reproduced`.** The failing test `test_source_slice_processor_preserves_higher_queue_status` (pytest dump) is not about the multi-batch race this finding describes — it fails because the severity-floor block in `process_evaluation_source_slice` is gated on `run.flags.has_traces or run.flags.has_testcases` (`tasks/source_slice.py:566-571`). The test's run is `EvaluationRunFlags(is_queue=True, has_queries=True)` (query-backed), so `has_traces`/`has_testcases` are both False, the floor is skipped, and `run_status` stays `SUCCESS` instead of being floored up to the persisted `ERRORS` — hence `assert ... == ERRORS` got `SUCCESS`.
  - So there are now two distinct issues under the "status preservation" umbrella: (1) **this finding's** multi-slice thrash race (still `medium`/un-reproduced as a *race*), and (2) the severity-floor flag gate excluding `has_queries`/`has_testsets` runs (reproduced, test-failing). They share `source_slice.py:566-586`.
  - Corrected suggested fix for (2): include `has_queries`/`has_testsets` (or simply gate on `run.flags.is_queue`) in the severity-floor condition at line 569 so source-backed queue runs preserve their higher persisted status. This is the same `source_slice.py:569` gate referenced in UEL-022's re-audit.
- Resolution (2026-05-21) — **partial; item (2) fixed, item (1) still OPEN.** The severity-floor flag gate (`tasks/processor.py`) was widened from `has_traces or has_testcases` to also include `has_queries or has_testsets`, so source-backed (query/testset) queue runs now preserve their higher persisted status. The test-failing sub-bug `test_source_slice_processor_preserves_higher_queue_status` passes (resolved together with UEL-022).
- Resolution (2026-05-22) — **item (1) is NOT a bug; closing.** Re-analysed the multi-slice (`_dispatch_source_batches` ships one slice per input step) case under the *current* severity order (`FAILURE:4 > ERRORS:3 > SUCCESS:2 > RUNNING:1 > PENDING:0`):
  - Each slice computes its status from its OWN processed subset: all-done → a terminal status, only its own pending items → RUNNING. A slice that finishes never computes RUNNING for already-done work, and the floor only keeps a *more severe* stored status. So a later all-success slice can never floor the run back UP to RUNNING — the `SUCCESS -> RUNNING -> SUCCESS` thrash the finding described cannot occur with this ordering. (The thrash was an artifact of the OLD ordering where RUNNING outranked SUCCESS; that was the real UEL-028 single-slice pin, since fixed by the reorder.)
  - The only residual is cosmetic: with concurrent slices the first to finish writes the run's terminal status (and clears `is_active`) slightly before its siblings finish. The final resting state is still correct (the last write lands the right terminal status), and **liveness is not read from `status`** — it lives in `is_active`, which only *acts* via `fetch_live_runs` (DAO), gated on `is_live=True`. Source-batch/queue runs are dispatched as `queue_traces` / `queue_testcases` topologies, never `live_query` (`classify_steps_topology` returns a single dispatch), so `is_active` never gates them and the early write cannot cut off a sibling slice (each slice is an already-queued, independent taskiq task). The glitch is a transient readout only.
  - Therefore no last-slice-finalize flag is warranted (it would thread a signal through ~6 dispatch hops including the taskiq boundary for a self-correcting cosmetic glitch on a field nobody gates on for these runs).
- Architectural note (root cause of the whole confusion): `status` overloads two orthogonal axes — liveness (running vs done) and outcome (success/errors/failure). The severity-floor exists only to reconstruct the axis that the single enum throws away. The clean model splits them: liveness = `is_active` (already a flag), outcome = a separate terminal value; then there is no floor and no severity map. Tracked as a future cleanup, not required for correctness now.

### [CLOSED] UEL-018: SDK runtime drops extra runner outputs silently when batch is longer than planned cells

- ID: `UEL-018`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `medium`
- Status: `fixed`
- Category: `Correctness`
- Summary: `process_evaluation_source_slice` zips `batch_cells` with `executions` and only handles the case where there are fewer executions than cells (closed UEL-004). When the runner returns **more** executions than planned cells (a contract violation in the other direction), the trailing executions are silently discarded.
- Evidence:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py:182-204` iterates `zip(batch_cells, executions)`, naturally truncating to the shorter sequence.
  - Lines 216-230 handle only `len(executions) < len(batch_cells)` (`batch_cells[len(executions):]`).
  - The mismatch flag at line 216 still sets `scenario_has_errors=True`, but no per-extra-cell logging happens.
- Impact: Low — the contract violation is "extra outputs from the runner," which should be rare. But the silent drop means there is no audit trail for the extra outputs. Closed UEL-004 fixed only the under-return direction.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
- Cause: The fix for UEL-004 covered the under-count case explicitly; the over-count case was not added.
- Suggested Fix:
  - When `len(executions) > len(batch_cells)`, log a structured warning that includes the extra outputs' summaries.
  - Optionally, persist a marker result row for the unused executions or surface them in the `ProcessedScenario.metrics`.
- Alternatives:
  - Treat extra outputs as a hard error (raise). More aggressive but symmetric with UEL-004.
- Resolution (2026-05-22): the mismatch branch in `processor.py` (SDK runtime) now splits under-count vs over-count. Over-count logs a structured warning with the dropped executions' summaries (`trace_id` / `span_id` / `status` / `error`) and still flags the scenario as having errors; the planned cells are logged from the first executions. Chose the structured-warning path over hard-raise to stay consistent with the soft-worker stance. Unit test `test_sdk_source_slice_handles_over_count_runner_batch` covers it.

### [CLOSED] UEL-019: Source-resolver `query_revision` lookup ignores resolver returning `None` and falls through to the next resolver

- ID: `UEL-019`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `medium`
- Status: `fixed`
- Category: `Soundness`
- Summary: `resolve_queue_source_batches` iterates resolvers in order and stops as soon as one returns a non-empty batch. If a `query_revision` reference resolves to zero trace IDs, the function returns `None` and the loop tries the testset resolver next, which silently does the wrong thing if the same step (somehow) had both refs.
- Evidence:
  - `api/oss/src/core/evaluations/runtime/sources.py:229-244` iterates `[QueryRevisionTraceResolver, TestsetRevisionTestcaseResolver]` and `break`s on the first truthy batch.
  - A step has either a `query_revision` or a `testset_revision` reference under current design, so the fall-through is harmless in practice — but if a future step carries both refs (a possibility under mixed-source planning), the second resolver would win silently.
  - The first resolver returns `None` whenever `trace_ids` is empty (line 106-107) instead of returning an empty batch, which conflates "no traces" with "wrong resolver".
- Impact: Low today (single-ref steps), but the resolver chain is brittle to future graph extensions and to legitimately empty query results.
- Files:
  - `api/oss/src/core/evaluations/runtime/sources.py`
- Cause: The resolver chain was modeled as "first-match wins" rather than "first-applicable wins".
- Suggested Fix:
  - Split the resolver protocol into `applies(step)` and `resolve(step)`; iterate until `applies` returns `True`, and treat empty results as a real empty batch (or a structured error).
  - Return `ResolvedSourceBatch(kind=..., step_key=..., trace_ids=[])` for empty query results so the loop sees the resolver applied.
- Alternatives:
  - Document the assumption "exactly one source reference per input step" and add a planner-level validator that rejects steps violating it.
- Resolution (2026-05-22): combined both directions of the Suggested Fix. Each resolver now declares its exact `source_reference_key` and an `applies(step)` check; `resolve_queue_source_batches` selects the resolver whose key is present (first-applicable, not first non-empty), so an empty query result is a real empty batch for that resolver and never falls through to the testset resolver. The "exactly one source reference per input step" rule is enforced: a step carrying both `query_revision` and `testset_revision` raises `SourceResolutionError`. Unit tests cover the no-fall-through and multi-ref-rejection cases.


### [CLOSED] UEL-030: "one default queue per run" is not enforced — unique index absent and no code-level guard

- ID: `UEL-030`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Soundness`
- Summary: The design relies on the partial unique index `ux_evaluation_queues_default_per_run` to guarantee at most one default queue per run, and `_reconcile_default_queue` assumes `fetch_default_queue` returns a single row. But the index is **absent from the running dev DB** and `create_queue` has **no code-level guard**, so creating two `is_default=True` queues for the same run succeeds — both become active default queues.
- Evidence:
  - `POST /evaluations/queues/` with `flags.is_default=True` twice for the same `run_id` both return `count=1` (test `test_default_queue_policy.py::test_second_default_queue_for_same_run_is_rejected`, currently xfail).
  - `pg_indexes` for `evaluation_queues` lists only `pkey`, `run_id`, `project_id`, `flags`, `tags`, `user_ids` — **no** `ux_evaluation_queues_default_per_run`, even though `alembic_version` is at `b2c3d4e5f7a8` (past `a1b2c3d4e5f6`, which creates it) and no later migration drops it.
  - Model declares the index in `api/oss/src/dbs/postgres/evaluations/dbes.py:290-296` with `postgresql_where=text("(flags ->> 'is_default')::boolean = true")` — note this counts **archived** rows (no `deleted_at IS NULL`), which conflicts with the reconcile flow that archives then later unarchives/recreates a default queue.
  - Migration `a1b2c3d4e5f6` creates the index with the same `WHERE (flags ->> 'is_default')::boolean = true` (no `deleted_at` predicate).
- Impact:
  - Duplicate active default queues per run are possible, breaking the `fetch_default_queue` "single row" assumption used throughout `_reconcile_default_queue` / `_sync_run_queue_flag_for_default_queue`.
  - If the index *were* applied as written (`is_default=true` without `deleted_at IS NULL`), the archive→recreate path in reconcile would hit a unique violation against the archived row. So the index predicate is also likely wrong.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/dbes.py`
  - `api/oss/databases/postgres/migrations/core/versions/a1b2c3d4e5f6_add_default_evaluation_queues.py`
  - `api/oss/src/core/evaluations/service.py` (create_queue path)
- Cause: The uniqueness guarantee was specified as a DB index but (a) the index is not present in the environment, and (b) its predicate omits `deleted_at IS NULL`, so it cannot both enforce one *active* default and allow archive→recreate.
- Suggested Fix:
  - Correct the index predicate to `(flags ->> 'is_default')::boolean = true AND deleted_at IS NULL` (one *active* default per run, archived rows excluded) in both the model and a new migration; confirm it actually applies in the dev/prod DBs.
  - Add a code-level guard in `create_queue` (reject/▸no-op a second active default for a run) so the invariant holds even if the index is missing, and surface it as `EntityCreationConflict`.
  - Flip `test_second_default_queue_for_same_run_is_rejected` from xfail to a passing assertion.
- Notes:
  - Surfaced while writing default-queue policy coverage (UEL-011).
- Resolution (2026-05-21):
  - **Root cause was a duplicate alembic revision id.** `add_default_evaluation_queues` shared the revision id `a1b2c3d4e5f6` with `drop_corrupted_metrics_for_some_runs`, so alembic resolved to one file and silently skipped the index migration — which is why the index was absent from the DB despite `alembic_version` being past `a1b2c3d4e5f6`.
  - Renamed the index migration to revision `a1d2e3f4a5b6` and chained both new branch migrations (`a1d2e3f4a5b6` add-index, `a2b3c4d5e6f8` backfill) linearly after each environment's head — OSS after `e6f7a8b9c0d1`, EE after `b2c3d4e5f7a8` (EE carries three extra meter/role migrations past the shared OSS head). Both graphs now resolve to a single head `a2b3c4d5e6f8` (verified with `find_head.py core`). Migrations are mirrored in both `api/oss/.../core/versions/` and `api/ee/.../core/versions/`.
  - Corrected the index predicate to `(flags ->> 'is_default')::boolean = true AND deleted_at IS NULL` in both the model (`dbes.py`) and the migration, so it enforces one *active* default per run while allowing archive→recreate.
  - Fixed two SQL type bugs in the backfill (`evaluation_runs.data` / `evaluation_queues.data` are `json`, not `jsonb`): cast `data::jsonb` before `jsonb_array_elements`, and insert `'{}'::json` into the `data` column.
  - Verified end to end on a `--nuke` rebuild: fresh DB lands at head `a2b3c4d5e6f8` and `ux_evaluation_queues_default_per_run` exists with the corrected predicate.
  - **No separate code-level guard was added.** A pre-emptive SELECT guard was prototyped while the index was missing, but it never worked (it didn't block the second insert) and was not race-safe (separate SELECT/INSERT sessions). It was removed: the partial unique index is the real enforcement, and the existing `check_entity_creation_conflict` in `create_queue`/`create_queues` already translates the index's unique-violation `IntegrityError` into `EntityCreationConflict` (HTTP 409).
  - `test_second_default_queue_for_same_run_is_rejected` is now a passing assertion (xfail removed). Full `test_default_queue_policy.py` suite: 16 passed, including the three `TestDefaultQueueUniqueness` cases (reject second active default, recreate after archive, allow across different runs).

### [CLOSED] UEL-031: Closed-run lock was silently ineffective — `EvaluationClosedConflict` swallowed by `@suppress_exceptions` on 21 DAO mutations

- ID: `UEL-031`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Closing a run (`POST /runs/{id}/close`) is meant to lock it: subsequent content mutations should fail with 409. 21 DAO methods raise `EvaluationClosedConflict` when `flags.is_closed`, and 20 user-facing routes carry `@handle_evaluation_closed_exception()` (which converts it to 409) — but every DAO method's `@suppress_exceptions(...)` swallowed the conflict **before** it reached the router, so closed-run mutations silently returned 200/empty instead of 409. The lock was effectively a no-op at the HTTP layer.
- Evidence:
  - All 21 raising methods used `@suppress_exceptions()` (or `exclude=[EntityCreationConflict]`) — **none** excluded `EvaluationClosedConflict` (`api/oss/src/dbs/postgres/evaluations/dao.py`).
  - `test_closed_run_guard.py`: editing a closed run / creating a scenario / creating a result returned 200 (count 0), not 409.
  - The 3 run routes (`create_runs`, `edit_runs`, `edit_run`) additionally lacked `@handle_evaluation_closed_exception()`, so even once the DAO raised, `edit_run` returned a generic 500.
- Worker hazard (why a blanket fix was unsafe): `process_evaluation_source_slice` calls `edit_run`/`edit_scenario` at finalization **without** checking `is_closed`. If a user closes a run mid-flight, making those raise would turn benign finalization into a crash/FAILURE.
- Resolution (2026-05-21) — harden user-facing, keep worker soft:
  - Added `EvaluationClosedConflict` to the `exclude` of the 20 user-facing mutation DAO methods that raise it (edit_run/edit_runs, create/edit/delete scenario(s)/result(s), edit/delete metrics, create/edit queue(s)); the metric setter path already had no suppression so it propagates. Now the decorated routes return 409.
  - Added `@handle_evaluation_closed_exception()` to the `create_runs`/`edit_runs`/`edit_run` routes (`api/oss/src/apis/fastapi/evaluations/router.py`).
  - Made the worker tolerant: `process_evaluation_source_slice` wraps its finalization `edit_run` and per-item `edit_scenario` in `try/except EvaluationClosedConflict` (log + skip) — closing is a lock, not a failure.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
  - `api/oss/src/apis/fastapi/evaluations/router.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
- Regression coverage: `test_closed_run_guard.py` (5 tests) — close→is_closed, edit/scenario/result blocked with 409, open→edits allowed again. Existing flow tests confirm non-closed runs still finalize.
- Notes:
  - Distinct from UEL-012 (which deliberately makes queue archive/unarchive NOT raise on a closed run — those paths were left unguarded on purpose). Surfaced while writing closed-run coverage.

### [CLOSED] UEL-028: Batch (non-queue) source runs never finalize run status — stuck `running` after all scenarios succeed

- ID: `UEL-028`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: A batch (non-queue) source-backed run (testset → application → auto evaluator) processed every scenario to `success` and refreshed metrics, but the run-level `status` never rolled up — it stayed `running` with `flags.is_active=true` indefinitely. Reproduced end-to-end against the dev stack with the new `mock_v0` (LLM-free, sandbox-free) workflow.
- Evidence:
  - Worker logs: `[SLICE] Complete processed=2 has_errors=False`, `scenarios_with_pending=0`, `scenarios_with_auto_results=2`. Both scenarios reached `success` in the DB.
  - Targeted diagnostic logging proved the chain: the per-item computation correctly produced `run_status=SUCCESS` (`has_errors=[False,False]`, `has_pending=[False,False]`), but the value entering the terminal `edit_run` was `RUNNING`.
  - Root cause: the severity-floor block in `process_evaluation_source_slice` (`api/oss/src/core/evaluations/tasks/source_slice.py`) ranked `RUNNING` (2) **above** `SUCCESS` (1). Across slices it floors the persisted status up to the more-severe value — so a run whose stored status was `RUNNING` could never transition to `SUCCESS`; it pinned at `running` forever. The transient `RUNNING`/`PENDING` states were incorrectly treated as outranking the terminal `SUCCESS`.
  - Prevalence on the dev DB before the fix (batch/`is_live=false` runs): `success=35` vs `running=114`, `pending=211`.
  - Not a caching issue: there is no cache layer on the evaluation-run service/DAO, and the stale value was confirmed directly in Postgres.
- Resolution (2026-05-21) — Option B from `docs/designs/unified-eval-loops/run-status-finalization.md` (no run-wide scenario aggregation):
  - **Corrected the severity floor** so terminal statuses outrank the transient ones: `FAILURE(4) > ERRORS(3) > SUCCESS(2) > RUNNING(1) > PENDING(0)`. A freshly computed terminal status (incl. `SUCCESS`) now replaces a stale `RUNNING`, while a prior `FAILURE`/`ERRORS` still floors over a later SUCCESS-only slice (UEL-017's intent). `test_source_slice_processor_preserves_higher_queue_status` still passes.
  - **Reset `status=RUNNING` on every (re)dispatch** in the activation flow (`service.py` `_activate_evaluation_run`), not just on creation. This makes the **extended-finished** case correct: extending a `success` run flips it back to `running` while the new work executes, then the slice re-finalizes it. (Previously it kept `run.status` on re-activation, so an extended finished run stayed `success`.)
  - Hardening: the terminal `edit_run` clears `flags.is_active` for terminal statuses; `dao.edit_run` writes `status` via `status.value` + `flag_modified` (mirroring `close_run`), since `edit_dbe_from_dto` dumped the DTO without `mode="json"` and left an enum that did not persist reliably.
  - **Scope note:** only the `batch_testset` / `batch_invocation` dispatch (`update_run_status=True`) finalizes; `live_query` / `batch_query` pass `update_run_status=False` and are untouched. Batch testset/invocation runs are **single-slice** today (`process_testset_source_run` issues exactly one `process_evaluation_source_slice` call), so the multi-slice early-finalize race (Option C / UEL-017 item 1) does not apply here yet.
  - Regression coverage: `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_run.py` runs a full testset → `mock_v0` app → `mock_v0` auto-evaluator evaluation end-to-end through the real worker and asserts `status=success`. Passes (~4s). DB row after the fix: `status=success`, `is_active=false`.
- Files:
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
- Notes:
  - Surfaced by the new `agenta:custom:mock:v0` test workflow (deterministic, no LLM, no code sandbox), which lets evaluation runs execute end-to-end in acceptance tests.
  - Full analysis + rejected alternatives: `docs/designs/unified-eval-loops/run-status-finalization.md`.

### [CLOSED] UEL-029: Batch query→evaluator runs never finalize run status (dispatched with `update_run_status=False`)

- ID: `UEL-029`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The `batch_query` topology (query → evaluator, no application, not live) dispatched through `process_query_source_run` with `update_run_status=False`, so — like UEL-028 on the testset path — it never rolled its status up to a terminal value. The `live_query` topology shares the same function and *must* stay running, so the two cases needed to be distinguished.
- Resolution (2026-05-21):
  - `process_query_source_run` already receives `use_windowing` (True for `batch_query`, False for `live_query`). Set `update_run_status = use_windowing`, so batch query runs finalize while live runs keep polling.
  - Zero-traces batch case: `process_evaluation_source_slice` rejects empty input (raises "no source items"), so an empty batch query is finalized **directly** via `evaluations_service.edit_run(status=SUCCESS, is_active=False)` rather than through the slice. (A batch query with no matching traces is complete, not failed.)
  - With UEL-028's finalization in place, non-empty batch query slices finalize via the same severity-floor path.
- Files:
  - `api/oss/src/core/evaluations/tasks/query.py`
- Regression coverage: `test_evaluation_flows_run.py::test_batch_query_to_evaluator_runs_to_success` now asserts `status=success` + `is_active=false` (previously xfail). E1 suite: 4 passed.
- Notes:
  - Surfaced while building the run-to-completion flow suite with the `mock_v0` harness.

### [CLOSED] UEL-012: archive/unarchive a queue must be allowed on a closed run (was: `@suppress_exceptions()` swallows `EvaluationClosedConflict`)

- ID: `UEL-012`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `archive_queue`/`unarchive_queue` raised `EvaluationClosedConflict` when the parent run was closed; the bare `@suppress_exceptions()` swallowed it, returning `count=0` instead of a 409. The original finding proposed surfacing the 409.
- Resolution (2026-05-21) — **policy decision: allow both.** Archiving/unarchiving a queue is a worklist/lifecycle action, not a content edit of the run, so it must succeed even on a closed (locked) run. The `is_closed` guard was **removed** from both `archive_queue` and `unarchive_queue` in `api/oss/src/dbs/postgres/evaluations/dao.py` (no `EvaluationClosedConflict` is raised on these paths anymore, so there is nothing left to swallow). This supersedes the "surface a 409" suggestion.
- Files:
  - `api/oss/src/dbs/postgres/evaluations/dao.py`
- Regression coverage: `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_flows_modify.py::test_unarchive_and_archive_default_queue_on_closed_run` — closes a human-queue run, then asserts archive + unarchive do **not** return 409.

### [CLOSED] UEL-016: Service raises bare `ValueError` for default-queue policy violations instead of typed domain exceptions

- ID: `UEL-016`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Consistency`
- Summary: `_validate_default_queue_data`, the demotion guards, and `delete_queue`/`delete_queues` raised bare `ValueError` for default-queue policy violations, against the `AGENTS.md` rule that domain exceptions be typed in the core layer and converted at the API boundary.
- Resolution (2026-05-21):
  - Added a `DefaultQueueError` base + `DefaultQueueDataInvalid`, `DefaultQueueDemotionForbidden`, `DefaultQueueDeletionForbidden` (with structured `queue_id` context) in `api/oss/src/core/evaluations/types.py`.
  - Replaced the bare `ValueError` raises in `service.py` (`_validate_default_queue_data`, the two demotion guards, both delete paths) with these typed exceptions.
  - Added HTTP exception classes (`DefaultQueueDataInvalidException` → 422, `DefaultQueueEditingForbiddenException` → 409) in `apis/fastapi/evaluations/models.py`, and extended the `handle_evaluation_closed_exception` decorator (`apis/fastapi/evaluations/utils.py`) to convert the domain exceptions on the queue routes.
- Files:
  - `api/oss/src/core/evaluations/types.py`
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/apis/fastapi/evaluations/models.py`
  - `api/oss/src/apis/fastapi/evaluations/utils.py`

### [CLOSED] UEL-021: Source-backed simple queues are classified as `queries` / `testsets`, but runtime and tests expect `traces` / `testcases`

- ID: `UEL-021`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Area: `Evaluations / Simple Queues`
- Summary: Query-backed and testset-backed simple queues currently keep `SimpleQueueKind.QUERIES` / `SimpleQueueKind.TESTSETS` as their queue kind, while the runtime dispatch works on resolved trace/testcase scenario items. The provided test run shows both unit and acceptance failures where query-backed queues are expected to expose `kind="traces"` and dispatch trace slices, and testset-backed queues are expected to expose `kind="testcases"` and dispatch testcase slices.
- Evidence:
  - `oss/tests/pytest/unit/evaluations/test_query_eval_loops.py::test_simple_queue_create_dispatches_each_query_source_with_step_key` observed `created_queue.data.kind == "queries"` but expected `"traces"`.
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_source_backed_queue_preserves_repeats_and_assignments` observed `"testsets"` but expected `"testcases"`.
  - Acceptance tests for creating source-backed queues returned zero queued items where one was expected.
  - `api/oss/src/core/evaluations/service.py` maps queue data with `_get_source_kind()` returning `SimpleQueueKind.QUERIES` for `queue.data.queries` and `SimpleQueueKind.TESTSETS` for `queue.data.testsets`.
  - `SimpleQueuesService._parse_queue()` reports `kind=self._get_kind(run)`, so the source family leaks into the public simple-queue response.
- Files:
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/core/evaluations/types.py`
  - `api/oss/tests/pytest/unit/evaluations/test_query_eval_loops.py`
  - `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`
- Cause: The model conflates two different concepts: source declaration family (`queries` / `testsets`) and resolved executable item family (`traces` / `testcases`). Source-backed queue creation preserves source revision IDs correctly, but public queue kind and downstream dispatch checks are using the source family where tests expect the resolved family.
- Explanation: A query-backed queue is created from query revisions, but the work assigned to reviewers/evaluators is trace scenarios. Similarly, a testset-backed queue resolves testset revisions into testcase scenarios. The API needs to preserve both facts without using one field for both.
- Suggested Fix:
  - Keep `queries` / `testsets` fields as source references.
  - Return `kind="traces"` for query-backed queues and `kind="testcases"` for testset-backed queues, or introduce an explicit `source_kind` field if the source family must be exposed.
  - Ensure source-backed queue runs are marked/queryable consistently so `query(kind="traces")` and `query(kind="testcases")` include them.
  - Add regression tests for query-backed and testset-backed queue creation, fetch, query, and add-source rejection behavior.
- Alternatives:
  - If product wants `kind` to mean source family, update the tests and API docs. That would be a deliberate contract change and should not be inferred from the current implementation.
- Sources:
  - Provided pytest output.
  - Local inspection of `SimpleQueuesService`.
- Re-audit (2026-05-20): **Diagnosis corrected; severity unchanged (P1); confidence raised to high.** The "kind conflation" framing is inaccurate, and two evidence claims are wrong:
  - The acceptance tests do NOT expect `kind="traces"`/`kind="testcases"`. `test_create_simple_queue_from_queries` asserts `queue["data"]["kind"] == "queries"` (`test_simple_queues_basics.py:173`) and `test_create_simple_queue_from_testsets` asserts `"testsets"` (line 199). They expect the source family preserved, plus `queries`/`testsets` arrays echoed back. The current `_get_source_kind` mapping to `QUERIES`/`TESTSETS` is therefore *correct*, not the bug.
  - The real failure is upstream: the `KeyError: 'queue'` / `count == 0` happen because `_parse_queue` returns `None`. Trace: `SimpleQueuesService.create` source-backed branch calls `simple_evaluations_service._make_evaluation_run_data(...)` (`service.py:3636`). That builder defaults list-shaped evaluators to `DEFAULT_ORIGIN_EVALUATORS = "custom"` (`service.py:124`, applied at `3045-3049`), so `has_human=False` → `_reconcile_default_queue` leaves `is_queue=False` → `_get_kind` short-circuits to `None` at `service.py:4224` (`not run.flags.is_queue`) → `_parse_queue` returns `None` at `4271-4272` → router emits empty envelope.
  - Contrast: the non-source `_make_run_data` (`service.py:4087`) defaults list evaluators to `origin="human"` (`4093-4099`), so direct trace/testcase queues get `has_human=True` → `is_queue=True` and parse correctly. This asymmetry between the two builders is the single root cause shared with UEL-022.
  - Corrected suggested fix: align the source-backed evaluator-origin default with the non-source builder (default list-shaped evaluators to `"human"` in `_make_evaluation_run_data`), OR decouple `_get_kind`/`_parse_queue` from `is_queue` so a created queue is always parseable. Do NOT change `_get_source_kind`'s family mapping. Keep `kind` reporting the source family per the tests.
- Resolution (2026-05-21): **Fixed via the evaluator-origin default, scoped to the queue path only.** Confirmed the re-audit's root cause: the source builder defaulted bare-list evaluators to `custom` → `has_human=False` → `is_queue=False` → `_parse_queue` returned `None` → empty envelope.
  - Added a keyword-only `default_evaluator_origin: Origin = DEFAULT_ORIGIN_EVALUATORS` param to `_make_evaluation_run_data` and used it in the list-coercion. Only `SimpleQueuesService.create` passes `"human"`; the two `SimpleEvaluationsService` callers (create/edit) keep the `custom` default, so simple-evaluation behavior is unchanged. The shared run builder stays general — this is a queue-path default, not a run-layer rule.
  - **Explicit origins are always honored:** the `"human"` default applies only to a bare list (origin-less). A dict like `{id: "auto"}` is passed through verbatim — the default never overrides it.
  - **New simple-queue constraint** (per user): a queue must resolve to **at least one human evaluator**. A human evaluator is one that is origin-less (defaults to human) or explicitly `"human"`. So a bare list is always valid; an explicit dict is valid only if at least one value is `"human"` — a dict whose values are all non-human (all `auto`, all `custom`, or any `auto`/`custom` mix) is rejected. Enforced as a `SimpleQueueData.validate_sources` model-validator rule ("simple queues must have at least one human evaluator", 422) at request parse — before any run/default-queue is created. The underlying evaluation run has no such restriction.
  - `_get_source_kind` family mapping unchanged; `kind` still reports the source family per the tests.
  - Tests: `test_simple_queues_basics.py` adds `test_source_backed_queue_with_bare_evaluator_list_is_human_queue` (bare list → `has_human`/`is_queue` true), `test_simple_queue_rejects_evaluator_dicts_with_no_human` (all-auto, all-custom, and auto+custom mix → all 422), `test_simple_queue_allows_human_mixed_with_non_human_evaluators` (human+auto and human+custom → valid queue, both origins honored). Full file 20 passed.

### [CLOSED] UEL-022: Source-backed queue dispatch enters the source-slice processor with `has_queries` / `has_testsets`, but the processor accepts only direct-source flags

- ID: `UEL-022`
- Origin: `test`
- Lens: `validation`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Area: `Evaluations / Simple Queues`
- Summary: Source-backed queue creation resolves query revisions into trace batches and testset revisions into testcase batches, then dispatches those batches through the same source-slice processor used by direct trace/testcase queues. The dispatch wrapper accepts source-backed flags (`has_queries` / `has_testsets`), but `process_evaluation_source_slice()` still treats `require_queue=True` as requiring direct-source flags only (`has_traces` / `has_testcases`). Query-backed and testset-backed queues can therefore pass the first dispatch gate and fail inside the slice processor.
- Evidence:
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_simple_queue_from_queries` failed with `assert 0 == 1`.
  - `oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py::test_create_simple_queue_from_testsets` failed with `assert 0 == 1`.
  - `oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py::test_simple_evaluation_queue_batches_dispatch_through_slice_processor` failed because a queue-shaped run fixture with source-backed input was rejected by dispatch.
  - `SimpleEvaluationsService.dispatch_trace_slice()` permits `run.flags.has_traces or run.flags.has_queries`.
  - `SimpleEvaluationsService.dispatch_testcase_slice()` permits `run.flags.has_testcases or run.flags.has_testsets`.
  - `api/oss/src/core/evaluations/tasks/source_slice.py` rejects `require_queue=True` unless `run.flags.has_traces or run.flags.has_testcases`; it does not accept `has_queries` / `has_testsets`.
  - `SimpleQueuesService._dispatch_source_batches()` resolves query/testset-backed source batches and calls `dispatch_trace_slice()` / `dispatch_testcase_slice()` with `input_step_key=batch.step_key`, so those batches eventually reach the stricter source-slice guard.
- Files:
  - `api/oss/src/core/evaluations/service.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
  - `api/oss/tests/pytest/acceptance/evaluations/test_simple_queues_basics.py`
- Cause: The queue dispatch layer was partially updated for source-backed queues, but the source-slice processor still equates "queue batch" with direct trace/testcase source flags.
- Explanation: A query-backed source batch is executable as trace items, but the run still carries `has_queries` because the input step references a query revision. A testset-backed source batch is executable as testcase items, but the run still carries `has_testsets`. The source-slice processor needs to validate the actual batch request plus input step, not only the direct-source family flags.
- Suggested Fix:
  - Update `process_evaluation_source_slice()` queue validation so source-backed queue batches are allowed when `input_step_key` points to a `query_revision` or `testset_revision` input step and the concrete `trace_ids` / `testcase_ids` are present.
  - Alternatively, pass `require_queue=False` for source-backed queue dispatches after validating the source batch in `SimpleQueuesService._dispatch_source_batches()`.
  - Keep direct ad-hoc trace/testcase queues guarded by `has_traces` / `has_testcases`.
  - Add tests for query-backed and testset-backed source batch dispatch through the actual source-slice processor.
- Alternatives:
  - Persist additional resolved-source flags (`has_traces` for query-backed queues and `has_testcases` for testset-backed queues) alongside source-family flags. This would make the current guard pass, but it blurs the design's separation between source family and resolved executable item family.
- Sources:
  - Provided pytest output.
  - Local inspection of `SimpleEvaluationsService.dispatch_*`, `SimpleQueuesService._dispatch_source_batches()`, and `tasks/source_slice.py`.
- Re-audit (2026-05-20): **Partially confirmed; shares root cause with UEL-021.** The source-slice processor's `has_traces`/`has_testcases`-only gate is real and reproduced (see UEL-017 re-audit for the exact line — `tasks/source_slice.py:569` gates on `run.flags.has_traces or run.flags.has_testcases`, excluding `has_queries`/`has_testsets`). However, the *primary* reason the acceptance tests see `assert 0 == 1` is the same `is_queue=False` / evaluator-origin-default issue documented in UEL-021's re-audit — the queue never reaches a parseable state, so no scenarios are reported. The processor-gate gap (this finding) is the *secondary* defect that surfaces once UEL-021's origin default is fixed. Fix UEL-021 first, then re-run the source-backed dispatch tests to isolate whether the `source_slice.py:569` gate still blocks query/testset-backed batches. Keep this finding OPEN as the second-order fix.
- Resolution (2026-05-21): **Fixed.** Two parts, as the re-audit predicted:
  - The `require_queue` dispatch gate in `process_evaluation_source_slice` (`tasks/source_slice.py:283-326`) had already been updated on the branch to accept `has_queries`+`query_revision` and `has_testsets`+`testset_revision` source batches — verified, no change needed there.
  - The remaining offender was the run-status severity-floor block (`source_slice.py:566`), gated on `has_traces or has_testcases` only. Widened it to also accept `has_queries`/`has_testsets` so source-backed queue runs are covered. (This is the same gate as UEL-017 item #2.)
  - With UEL-021's origin default fixed (queues now reach a parseable state), the source-backed dispatch tests pass: `test_simple_queues_basics.py` 20 passed, `test_query_eval_loops.py` + `test_runtime_topology_planner.py` all green (including `test_source_slice_processor_preserves_higher_queue_status`).

### [CLOSED] UEL-023: Backend runtime adapter does not project source inputs onto the revision's declared input schema

- ID: `UEL-023`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Area: `Evaluations / Runtime Adapters`
- Summary: Two adapter tests fail for separate compatibility reasons. `BackendWorkflowRunner` now puts `interface` and `configuration` on the outer `WorkflowServiceRequest`, while the unit test expects them on `workflow_request.data`. `BackendCachedRunner` always forwards `semaphore=...` to the wrapped runner, but simple runner implementations may expose `execute_batch(requests)` only.
- Evidence:
  - `test_backend_workflow_runner_invokes_application_through_workflow_service` fails with `AttributeError: 'WorkflowRequestData' object has no attribute 'interface'`.
  - `test_backend_cached_runner_preserves_partial_hit_order` fails with `TypeError: BatchRunner.execute_batch() got an unexpected keyword argument 'semaphore'`.
  - Local inspection confirms `WorkflowServiceRequestData` is constructed with only `revision`, `parameters`, `testcase`, `inputs`, `trace`, and `outputs`.
  - Local inspection confirms `BackendCachedRunner.execute_batch()` calls `self.runner.execute_batch(missing, semaphore=semaphore)` unconditionally.
- Files:
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
- Cause: The adapter boundary is not using a single explicit protocol. Some callers/tests still expect the older request data shape and a simpler batch runner signature.
- Explanation: These are not the same bug. The request-shape issue needs a contract decision with the workflow service DTOs. The `semaphore` issue can be fixed either by standardizing the runner protocol or by making `BackendCachedRunner` only wrap runners that implement the full protocol.
- Suggested Fix:
  - Define the expected `WorkflowServiceRequest` shape once and update either the test or the adapter to match it. Avoid mutating Pydantic DTOs ad hoc to add fields that the model does not declare.
  - Define a runner protocol for `execute_batch(requests, semaphore=None)` and update test runners to implement it, or make `BackendCachedRunner` tolerant of wrapped runners that do not accept `semaphore`.
  - Add a small protocol-focused unit test for cached partial-hit order and semaphore forwarding.
- Alternatives:
  - If the outer `interface` / `configuration` fields are canonical, close the data-shape assertion as stale and update the test to assert `workflow_request.interface` and `workflow_request.configuration`.
- Sources:
  - Provided pytest output.
  - Local inspection of `BackendWorkflowRunner` and `BackendCachedRunner`.
- Re-audit (2026-05-20): **Evidence stale; real failing assertion is different.** The pytest dump's actual failure for `test_backend_workflow_runner_invokes_application_through_workflow_service` is `assert workflow_request.data.inputs == {"input": "hello"}` — got all four source keys (`correct_answer`, `testcase_id`, `testcase_dedup_id`, `input`). It is NOT the `AttributeError: 'WorkflowRequestData' object has no attribute 'interface'` this finding's Evidence cites; that `interface`/`configuration` assertion was already removed when UEL-003 was closed (the test now asserts via `workflow_request.data.revision[...]`/`parameters`). So this finding's part (a) is stale.
  - Confirmed real defect: `BackendWorkflowRunner.execute` sets `inputs=request.source.inputs` verbatim (`adapters.py:309`) with no projection onto the revision's declared input schema (`revision["data"]["schemas"]["inputs"]["properties"]`). The test supplies a schema declaring only `input`, so the adapter should project `request.source.inputs` down to declared properties and drop `correct_answer`/`testcase_id`/`testcase_dedup_id`.
  - The `semaphore` sub-issue (`BackendCachedRunner.execute_batch` forwarding `semaphore=` unconditionally) was not re-verified in this pass; left as-is pending a targeted check.
  - Corrected suggested fix: in `BackendWorkflowRunner.execute`, filter `request.source.inputs` to the keys present in `revision["data"]["schemas"]["inputs"]["properties"]` before assigning to `WorkflowServiceRequestData.inputs`. Update the finding title to drop the `WorkflowServiceRequestData.interface` shape sub-issue (closed via UEL-003) and add the input-projection sub-issue.
- Resolution (2026-05-21): **Fixed; both sub-issues confirmed closed.** Reproduced the suite: `test_backend_workflow_runner_invokes_application_through_workflow_service` failed exactly per the re-audit (`workflow_request.data.inputs` carried `correct_answer`/`testcase_id`/`testcase_dedup_id`); `test_backend_cached_runner_preserves_partial_hit_order` already **passed** (the `semaphore` sub-issue is stale, no change needed).
  - Added `_project_inputs(inputs, data)` in `api/oss/src/core/evaluations/runtime/adapters.py` and applied it at the `inputs=` assignment in `BackendWorkflowRunner.execute`. It filters `request.source.inputs` to the keys declared in `data.schemas.inputs.properties`; revisions with no declared input schema pass through unchanged so untyped/legacy revisions are not broken.
  - Verified: the failing test passes; the full `test_runtime_topology_planner.py` file is now 39 passed / 1 failed, where the remaining failure is the separate `test_source_slice_processor_preserves_higher_queue_status` (UEL-017/UEL-022 severity-floor gate), not this finding.

### [CLOSED] UEL-024: Unit tests patch legacy module globals that no longer exist after dependency lookup refactors

- ID: `UEL-024`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Area: `Compatibility / Tests`
- Summary: Several unit tests fail before exercising behavior because they patch module-level globals (`auth_helper.posthog`, `meters.dao.engine`, `db_manager_ee.engine`) that no longer exist. The production code now lazy-loads or constructor-loads dependencies through `_load_posthog()` / `get_transactions_engine()`.
- Evidence:
  - Auth helper tests fail with `AttributeError: module 'oss.src.core.auth.helper' has no attribute 'posthog'`.
  - Meter DAO tests fail with `AttributeError: module 'ee.src.dbs.postgres.meters.dao' has no attribute 'engine'`.
  - Workspace invitation removal test fails with `AttributeError: module 'ee.src.services.db_manager_ee' has no attribute 'engine'`.
  - Local inspection shows `auth.helper` imports `_load_posthog()` and assigns no module-level `posthog`.
  - Local inspection shows `MetersDAO.__init__()` accepts `engine: TransactionsEngine = None` and defaults to `get_transactions_engine()`, so tests can inject a mock engine directly.
  - Local inspection shows `remove_user_from_workspace()` calls `get_transactions_engine()` locally, and the same test file already has helper coverage that patches that function in earlier tests.
- Files:
  - `api/oss/src/core/auth/helper.py`
  - `api/ee/src/dbs/postgres/meters/dao.py`
  - `api/ee/src/services/db_manager_ee.py`
  - `api/oss/tests/pytest/unit/auth/test_helper.py`
  - `api/ee/tests/pytest/unit/test_meters_dao_strict_soft.py`
  - `api/ee/tests/pytest/unit/services/test_db_manager_ee.py`
- Cause: Test monkeypatch targets drifted after implementation changed dependency lookup style. The tests still patch old module-level handles instead of the current seam.
- Explanation: This is a test compatibility problem unless the module-level globals are part of an intentional public contract. Adding broad production proxy globals just to satisfy monkeypatches makes the code worse and hides the real dependency seam.
- Suggested Fix:
  - Update auth tests to patch `_load_posthog()` or a small `_get_posthog_client()` helper if one is introduced.
  - Update meter DAO tests to pass `MetersDAO(engine=mock_engine)` where `mock_engine.session()` returns the fake context.
  - Update `db_manager_ee` pending-invite test to patch `get_transactions_engine()` consistently with the existing `_patch_core_session()` helper in the same file.
  - Do not add broad module-level engine proxy objects to production DAO/service code.
- Alternatives:
  - Add narrow compatibility aliases only if external code, not just tests, imports those module globals. No evidence of that exists in the provided failures.
- Sources:
  - Provided pytest output.
  - Local inspection of the affected modules and tests.
- Re-audit (2026-05-20): **Fully confirmed, all three module seams reproduce.** Verified directly:
  - `oss/src/core/auth/helper.py` has no module-level `posthog`; it calls `_load_posthog()` inside `_get_posthog_string_entries` (line 63, imported at line 8). Tests patching `auth_helper.posthog` raise `AttributeError`.
  - `ee/src/dbs/postgres/meters/dao.py` injects via `MetersDAO.__init__(self, engine: TransactionsEngine = None)` defaulting to `get_transactions_engine()` (lines 96-99); no module-level `engine`. Tests patching `dao_module.engine` raise `AttributeError`. Fix: construct `MetersDAO(engine=mock_engine)`.
  - `ee/src/services/db_manager_ee.py` calls `get_transactions_engine()` per-function (lines 82, 103, 125, 147, …); no module-level `engine`. Tests patching `db_manager_ee.engine` raise `AttributeError`. Fix: patch `db_manager_ee.get_transactions_engine`.
  - This is the cleanest fix candidate of the failing-test findings — test-only changes, no production code touched, consistent with the "do not add proxy globals" note. Open Question on monkeypatch strategy can be resolved as "update tests to patch the current seam."
- Resolution (2026-05-21): **Already fixed on this branch; verified by running the suite (30 passed, 0 failed).** All three test files now patch the current seam exactly as prescribed:
  - `oss/tests/pytest/unit/auth/test_helper.py` patches `_load_posthog` (3 sites), not `auth_helper.posthog`.
  - `ee/tests/pytest/unit/test_meters_dao_strict_soft.py` constructs `MetersDAO(engine=_mock_engine(session))`, not module-global `engine`.
  - `ee/tests/pytest/unit/services/test_db_manager_ee.py` patches `get_transactions_engine` where it is called, not `db_manager_ee.engine`.
  - No production code touched; consistent with the "do not add proxy globals" note.

### [CLOSED] UEL-025: Legacy billing pricing alias tests are environment-sensitive because the subprocess helper inherits canonical pricing env

- ID: `UEL-025`
- Origin: `test`
- Lens: `validation`
- Severity: `P3`
- Confidence: `medium`
- Status: `fixed`
- Area: `Environment / Billing Settings`
- Summary: Tests that set legacy `AGENTA_PRICING` or `STRIPE_PRICING` expected those values to populate `env.billing.pricing`, but the user-provided suite output observed a canonical/default Stripe price instead. Local inspection shows `BillingSettings.pricing` already honors legacy aliases after `AGENTA_BILLING_PRICING`, and targeted local execution of both legacy alias tests passed when no canonical pricing env was present. The remaining issue is test isolation: the subprocess helper starts from `dict(os.environ)`, so inherited `AGENTA_BILLING_PRICING` can legitimately mask legacy aliases.
- Evidence:
  - `test_billing_pricing_accepts_legacy_agenta_pricing_alias` observed `price_1QmIwGB54aDbaYx3xE5J7WHA` instead of `price_agenta`.
  - `test_billing_pricing_accepts_legacy_stripe_pricing_alias` observed the same default/canonical price instead of `price_stripe`.
  - `api/oss/src/utils/env.py` uses `_load_json_env_dict_first("AGENTA_BILLING_PRICING", "AGENTA_PRICING", "STRIPE_PRICING")`.
  - `api/ee/tests/pytest/unit/test_controls_env_override.py::_run()` copies the full parent environment before applying `env_extra`.
  - Targeted local run of the two alias tests passed with `2 passed`, confirming the production alias order works when canonical env is absent.
- Files:
  - `api/oss/src/utils/env.py`
  - `api/ee/tests/pytest/unit/test_controls_env_override.py`
- Cause: The code path gives canonical env precedence by design, and the test helper does not scrub canonical env when validating legacy fallback.
- Explanation: The production precedence appears correct: canonical `AGENTA_BILLING_PRICING` should beat legacy aliases. The test helper should isolate env vars if it wants to validate legacy alias fallback.
- Suggested Fix:
  - In `_run()` / `_ok()` test helpers, explicitly remove `AGENTA_BILLING_PRICING` when a legacy-alias test is running, or construct the subprocess env from a controlled minimal baseline.
  - Add one explicit test that canonical env wins when both canonical and legacy aliases are present.
- Alternatives:
  - If product wants legacy aliases to override canonical pricing, change `_load_json_env_dict_first()` order. This would contradict the existing canonical precedence test.
- Sources:
  - Provided pytest output.
  - Local inspection of `BillingSettings`.
  - Targeted local pytest run.
- Resolution (2026-05-21): **Already fixed on this branch; verified (13 pricing tests pass).** `ee/tests/pytest/unit/test_controls_env_override.py` now isolates env for the legacy-alias tests exactly as prescribed: `test_billing_pricing_accepts_legacy_agenta_pricing_alias` and `..._stripe_pricing_alias` pass `"AGENTA_BILLING_PRICING": ""` in `env_extra` to clear the inherited canonical var so the legacy alias is consulted. A new `test_billing_pricing_prefers_canonical_env_over_legacy_aliases` locks in canonical-wins precedence. Production precedence (`_load_json_env_dict_first("AGENTA_BILLING_PRICING", "AGENTA_PRICING", "STRIPE_PRICING")`) is unchanged and correct.

### [CLOSED] UEL-026: Events acceptance tests hit the EE audit permission/entitlement gate and need fixture alignment

- ID: `UEL-026`
- Origin: `test`
- Lens: `validation`
- Severity: `P2`
- Confidence: `medium`
- Status: `fixed`
- Area: `Events / Acceptance`
- Summary: Four events acceptance tests expected HTTP 200 but received 403. Current code shows `POST /events/query` is gated in EE by both `Permission.VIEW_EVENTS` and the `Flag.AUDIT` entitlement. The acceptance fixture uses `cls_account["credentials"]` without asserting that account has event-view permission and audit entitlement, so the failures are likely fixture/plan setup unless response bodies or logs show a different 403 source.
- Evidence:
  - `oss/tests/pytest/acceptance/events/test_events_basics.py::TestEventsBasics::test_query_events_returns_valid_response` failed with `assert 403 == 200`.
  - The same 403 pattern appears for event type, unknown event type, and windowing-limit query tests.
  - `api/oss/src/apis/fastapi/events/router.py` calls `check_action_access(... permission=Permission.VIEW_EVENTS)` and raises `FORBIDDEN_EXCEPTION` when false.
  - The same route calls `check_entitlements(key=Flag.AUDIT)` and returns `NOT_ENTITLED_RESPONSE(Tracker.FLAGS)` when false.
  - `api/oss/tests/pytest/unit/events/test_events_router_audit.py` already encodes allow/deny behavior for this gate.
- Files:
  - `api/oss/tests/pytest/acceptance/events/test_events_basics.py`
  - `api/oss/src/apis/fastapi/events/router.py`
  - `api/oss/tests/pytest/unit/events/test_events_router_audit.py`
- Cause: Acceptance account setup likely does not guarantee the event-view permission and audit entitlement required by the route.
- Explanation: This is not evidence of an events DAO/service bug. It is a mismatch between acceptance expectations and the route's current EE access policy.
- Suggested Fix:
  - Update the acceptance fixture to use an account/plan with `VIEW_EVENTS` and `AUDIT`, or assert 403 when the fixture lacks audit access.
  - Log or assert the response body in the acceptance tests so permission denial and entitlement denial are distinguishable.
  - Keep the existing unit coverage for audit allow/deny behavior.
- Alternatives:
  - If OSS acceptance runs should bypass EE audit gating, ensure the test environment is actually OSS or conditionally skip/adjust the events acceptance tests under EE without audit entitlement.
- Sources:
  - Provided pytest output.
  - Local inspection of events router and unit tests.
- Resolution (2026-05-21): **Already fixed on this branch; verified.** The four OSS acceptance tests in `oss/tests/pytest/acceptance/events/test_events_basics.py` are now skipped with reason "Endpoint is plan/role-gated under EE; covered by the EE events suite" (5 skipped), matching the Alternatives fix. The plan/role-gated path is covered by `ee/tests/pytest/acceptance/events/test_events_basics.py` (5 passed). No 403-vs-200 mismatch remains.

### [CLOSED] UEL-010: Backfill creates default queues for every existing run, bypassing the conditional policy

- ID: `UEL-010`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Migration`
- Summary: The backfill migration inserts a `flags.is_default=true` queue for every existing run that does not already have one, regardless of `has_human` or `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS`. The runtime policy in `_reconcile_default_queue` archives default queues for runs that should not have them, but it only fires on the next `create_run`/`edit_run`. Until then the database contains stale active default queues.
- Evidence:
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py:43-71` inserts unconditionally, only checking the absence of an existing default queue.
  - `api/oss/src/core/evaluations/service.py:408` policy is `should_exist = EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or has_human`. With the env constant hardcoded `False` (UEL-007), the steady-state policy requires `has_human=True` for auto-only runs to retain a default queue.
  - `api/oss/src/core/evaluations/service.py:433-438` archives default queues that should not exist, but only on run edits.
- Impact:
  - For environments where `has_human=False` is the majority, the migration creates many auto-only default queues that will only get archived on the next edit. Until then, `fetch_default_queue` returns active queues that the runtime would not have created.
  - Queue analytics, "queues with no work" views, and simple-queue eligibility checks will see inconsistent state across the fleet during the lag window.
  - The backfilled rows also default to `status='running'` regardless of run status, which is misleading for `success`/`failure` runs.
- Files:
  - `api/oss/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`
- Cause: The migration favors symmetry (every run gets a queue) over conformance with the runtime policy.
- Suggested Fix:
  - Mirror the runtime policy in the migration: only insert default queues for runs that satisfy `has_human OR <env policy>`. Archive existing default queues for runs that no longer qualify.
  - Alternatively, run a one-shot data fix immediately after the migration that calls `_reconcile_default_queue` for each run.
  - Set `status` to a more neutral value (e.g., `pending`) or carry over the run's status when creating queues during backfill.
- Alternatives:
  - Keep the unconditional behavior and document the lag explicitly. This is acceptable if `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS` is going to be flipped `True` in deployment, but the constant is currently `False`.
- Resolution (2026-05-21): **Fixed.** `a2b3c4d5e6f8_backfill_default_evaluation_queues.py` now mirrors the runtime create policy (`_reconcile_default_queue`) in a single pass:
  - The INSERT is gated on `COALESCE((r.flags ->> 'has_human')::boolean, false) = true`, matching `should_exist = EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or has_human` with the env toggle hardcoded `False`.
  - A new reconcile-the-other-direction UPDATE archives (`deleted_at = now`, `deleted_by_id = r.created_by_id`) any stale active default queue on a run that no longer qualifies (`has_human = false`), so there is no "first-edit reconciles" lag.
  - Created queues carry `COALESCE(r.status, 'running')` instead of a hardcoded `'running'`, so closed/success/failure runs are not misrepresented.
  - The final `is_queue` recompute is unchanged (already `has_human AND active default queue exists`).

### [CLOSED] UEL-014: Step lifecycle operations (`add_step`, `remove_step`, `prune`) are absent

- ID: `UEL-014`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Completeness`
- Summary: `docs/designs/unified-eval-loops/step-removal-semantics.md` chose **destructive** `remove_step` + `prune` as the lifecycle policy and listed `add_step`, `remove_step`, `add_scenario`, `remove_scenario`, `probe(slice)`, `populate(slice, results)`, `prune(slice)`, `process(slice)`, `refresh_metrics`, `set_flag` as the canonical operation surface (`proposal.md:367-381`). None of these exist in the API or service.
- Evidence:
  - `api/oss/src/apis/fastapi/evaluations/router.py` (verified through subagent map) has no `add_step`, `remove_step`, `probe`, `prune`, `populate`, `process`, `set_flag` route. The closest in-process method is `TensorSliceOperations` (see UEL-015).
  - `api/oss/src/core/evaluations/service.py` exposes `set_results`, `query_results`, `delete_results`, `refresh_metrics`, run/queue CRUD, but no graph-mutation API.
  - `docs/designs/unified-eval-loops/step-removal-semantics.md:1-20` declares destructive remove+prune as the chosen model.
- Impact: Without the operation surface, graph evolution still requires recreating runs or in-place edits without prune cascades, which is the very fragmentation the design was meant to resolve. UI/API affordances for managing steps after creation cannot be built.
- Files:
  - `api/oss/src/apis/fastapi/evaluations/router.py`
  - `api/oss/src/core/evaluations/service.py`
- Cause: Implementation prioritized planner/runtime/queue plumbing; the operation API surface remains future work per the plan, but is not labeled as deferred in this branch.
- Suggested Fix:
  - Track the operation API as an explicit follow-up. Either ship it in this branch or extend `gap.md` to mark it as a known-pending item.
  - When implementing, follow the AGENTS.md domain conventions (`apis/fastapi/<domain>/router.py` + `core/<domain>/service.py` + `dbs/postgres/<domain>/dao.py`).
- Alternatives:
  - Resolve as `needs-user-decision` if the team prefers to land the unification without the operation surface and ship it as a follow-up PR.
- Resolution (2026-05-21): **Fixed for the `remove_step` + `prune` lifecycle (the part `step-removal-semantics.md` actually mandates).** Per user decision, graph mutation is not exposed as separate `add_step`/`remove_step` endpoints. Instead, since `create_run` is conceptually "edit from an empty graph", create and edit now funnel through one shared post-write reconciler, `EvaluationsService._reconcile_run`:
  - `_reconcile_run(run, prior_step_keys)` runs `_prune_removed_steps(run, prior_step_keys - current_step_keys)` then `_reconcile_default_queue(run)`.
  - `create_run` / `create_runs` pass `prior_step_keys=set()`, so prune is a guaranteed no-op (no prior cells) — preserving the "create = edit from scratch" property.
  - `edit_run` / `edit_runs` fetch the prior run, capture its step keys, and after the DAO write prune the cells of any dropped step. Adding/keeping a step needs no special path: omitting a step from `data.steps` *is* a destructive removal.
  - `_prune_removed_steps` implements the documented cascade: delete result cells for removed steps across scenarios/repeats; remove scenarios left with zero remaining cells (i.e. sourced only from a removed input step); flush metrics for surviving affected scenarios. Closed runs are rejected by the existing DAO `edit_run` guard.
  - Files: `api/oss/src/core/evaluations/service.py` (`_reconcile_run`, `_prune_removed_steps`, `_step_keys`, rewired create/edit). Tests: `api/oss/tests/pytest/acceptance/evaluations/test_evaluation_step_removal.py` (non-input drop prunes only its cells; input drop prunes orphan scenarios; create does not prune; queue eligibility re-derived). 12/12 targeted acceptance tests pass; 52/54 evaluations unit tests pass (the 2 failures are pre-existing UEL-017/UEL-022/UEL-023, unrelated).
  - Still open as separate findings: the slice-level `process(slice)` execution contract (UEL-015) and the other documented ops (`add_step`/`add_scenario`/`set_flag`/etc.) are not part of the remove+prune lifecycle and remain out of scope here. The full operation surface and per-op status (done / partial / deferred) is now catalogued in [`operations.md`](./operations.md); the deferred ops will be implemented later.

### [CLOSED] UEL-027: SendGrid client is an eager import-time module-global, inconsistent with the lazy-loader pattern used for other optional third-party subsystems

- ID: `UEL-027`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Area: `Utils / Third-party subsystem access`
- Summary: A 2026-05-21 audit of how `api/` accesses third-party subsystems found that optional dependencies are otherwise reached through once-checked lazy loaders in `oss/src/utils/lazy.py` (`_load_stripe`, `_load_posthog`), but SendGrid was the odd one out: two separate module-level eager initializations at import time. This is the same drift trap as UEL-024 (module-globals are hard to swap in tests) and means SendGrid client construction runs at import regardless of whether email is ever sent.
- Evidence (pre-fix, files since changed/removed):
  - `oss/src/services/email_service.py:13-22` (now deleted) constructed `sg = sendgrid.SendGridAPIClient(...)` at module import time, guarded only by `if env.sendgrid.enabled`, and referenced it directly in `send_email` (`sg.send(message)`).
  - `ee/src/services/db_manager_ee.py:5,65-66` imported `sendgrid` and constructed `sg = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)` at import time **unconditionally** (no `enabled` guard). Grep confirmed `sg` was assigned and never read anywhere in that module — dead code.
  - By contrast, Stripe and PostHog use `oss/src/utils/lazy.py` once-checked loaders that return `None` when disabled/unavailable, and callers null-check the result.
  - No external module imports `email_service.sg` or `db_manager_ee.sg` directly; all email goes through `email_service.send_email()` / `read_email_template()` (consumers: `oss/src/services/user_service.py`, `oss/src/services/organization_service.py`, `ee/src/services/organization_service.py`).
- Cause: The audit's "two axes" model (required-vs-optional × per-request-client-vs-boot-time-framework) explains every other subsystem: required per-request deps (Postgres/Redis) get a lazy singleton factory plus constructor-injection on modern DAOs; optional per-call deps (Stripe/PostHog) get `lazy.py` loaders; the boot-time framework (SuperTokens) is initialized once at startup. SendGrid is an optional per-call client and should have been a `lazy.py` loader, but was instead two eager module-globals.
- Resolution (2026-05-21):
  - Added `_load_sendgrid()` to `oss/src/utils/lazy.py`, mirroring `_load_stripe`/`_load_posthog` but returning a configured `SendGridAPIClient` instance (not a module — accepted per the "module-vs-client" decision below), or `None` when disabled/unavailable. Owns its own enabled-check and preserves the prior log lines (enabled / missing-sender / disabled).
  - `ee/src/services/db_manager_ee.py`: removed the dead `sg = SendGridAPIClient(...)` global and its `import sendgrid` (the symbol was never used).
  - **Boundary decision (per user):** email is a *caching-style* subsystem (callers share real orchestration: load template -> format placeholders -> validate sender -> send), unlike Stripe/PostHog which are one-liner direct calls (`stripe.Customer.create`, `posthog.capture`) with no shared glue. So email belongs behind a util like Redis behind `caching.py`, NOT inlined. Created `oss/src/utils/emailing.py` with a single public function `send_email(*, to_email, subject, username, action, workspace, call_to_action, from_email=None)` plus two private helpers (`_read_email_template`, `_render_email_template`). The loader's enabled-check + sender validation + `Mail` construction + `sg.send` all live inside the util; only `send_email` is part of the public surface.
  - Deleted `oss/src/services/email_service.py` and moved its template `git mv oss/src/services/templates/send_email.html -> oss/src/utils/templates/send_email.html` (so path resolution relative to the module still works).
  - Migrated all four call sites (`oss/src/services/organization_service.py`, `oss/src/services/user_service.py`, `ee/src/services/organization_service.py` x2) from the repeated `read_email_template().format(...)` + `email_service.send_email(...)` dance to a single `emailing.send_email(...)` call. Removed the now-duplicated `if not env.sendgrid.from_address: raise ValueError(...)` guard from call sites (the util owns it). Callers that short-circuit on a disabled mailer with a non-bool return (invite link / reset link) keep their own `if not env.sendgrid.enabled` early-return.
  - No production behavior change: disabled SendGrid is still a logged no-op; enabled builds the client on first send instead of at import.
  - Follow-up (same session): also folded the Loops marketing-contact helper into `emailing.py`. The former `ee/src/services/email_helper.py::add_contact_to_loops` was a stateless `httpx` POST to the Loops API (no SDK/client, so nothing to lazy-load) but had no enabled-guard. Moved it to `oss/src/utils/emailing.py::add_contact(email, ...)` (the method is edition-agnostic — just an HTTP call — so it lives in OSS utils; the `is_ee()` gate stays at the call site in `ee/src/services/commoners.py`), added an `if not env.loops.enabled: return None` no-op guard mirroring `send_email`, and deleted `email_helper.py`. `emailing.py` is now the single outbound email/contact surface: public `send_email` (transactional via SendGrid) + `add_contact` (Loops audience); helpers stay `_`-prefixed.
  - ruff format + check clean; import smoke test passes; template loads from new location.
- Decisions captured during the audit (apply to future subsystem work):
  - **Enabled-check placement:** each `lazy.py` loader owns its enabled-check and returns `None` when off; callers null-check. (Stripe/PostHog still gate at call sites today; not migrated in this pass but the intended direction.)
  - **Module vs client:** loaders return whatever the library is designed for — `stripe`/`posthog` return the module (global `api_key`), `sendgrid` returns a client instance. Do not force uniformity against the library shape.
  - **Boundary:** required per-request deps (Postgres/Redis) -> lazy singleton factory + constructor injection on modern DAOs; optional deps with shared orchestration (email) -> util wrapper (caching-style); optional one-liner deps (Stripe/PostHog) -> direct lazy use; boot-time framework (SuperTokens) -> eager conditional init at startup.
- Alternatives:
  - Leave SendGrid eager and accept the inconsistency. Rejected: it was the only optional subsystem not using the `lazy.py` seam, and the EE copy was eager-unconditional dead code.
  - Fully unpack `email_service` and inline `_load_sendgrid()` + `sg.send(Mail(...))` at every call site (to match Stripe/PostHog). Rejected: the four callers share template/format/validate orchestration, so inlining would duplicate ~10 lines x4; email is a caching-style boundary, not a one-liner.
- Sources:
  - 2026-05-21 read-only subsystem-access audit (Explore agent) covering Postgres, Redis, Stripe, PostHog, SuperTokens, SendGrid.
  - Local inspection of the (now-removed) `email_service.py`, `db_manager_ee.py`, `lazy.py`, and the four email call sites.

### [CLOSED] UEL-008: `has_traces`/`has_testcases` flags are never set on run creation

- ID: `UEL-008`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `stale`
- Category: `Correctness`
- Summary: Original claim was that the runtime never writes `has_traces`/`has_testcases`/`has_human`/etc. on run creation.
- Resolution:
  - Retracted. A deeper trace of the DAO showed that `EvaluationsDAO.create_run`, `create_runs`, `edit_run`, and `edit_runs` all call `create_run_flags(_run)` / `edit_run_flags(run, base_flags=...)`, which delegate to `_make_run_flags` in `api/oss/src/dbs/postgres/evaluations/utils.py:73-138`. That helper resets the eight `has_*` flags and recomputes them from `run.data.steps` on every write that carries a step graph.
  - The service-layer `_make_evaluation_run_flags` (3308-3337) does pass all eight `has_*` as explicit `False`, but the DAO overrides them with the derived values. The derived values are correct for the canonical step shapes used by `_make_evaluation_run_data` and `SimpleQueuesService._make_run_data`.
  - The reported runtime symptom (`dispatch_trace_slice` short-circuit, `_get_kind` returning `None`) does not occur, because by the time those checks run, the DAO has already populated `has_traces` / `has_testcases` / `has_queries` / `has_testsets` correctly.
  - Existing coverage in `api/oss/tests/pytest/unit/evaluations/test_run_flags.py:13-111` locks in the inference for the four families.
  - The residual concerns about the inference's brittleness (synthetic step-key + substring matching) are tracked in the rewritten UEL-009.

### [CLOSED] UEL-013: `SimpleQueuesService.create` forces `is_queue=False` and never re-derives via reconciliation

- ID: `UEL-013`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `medium`
- Status: `stale`
- Category: `Correctness`
- Summary: Original claim was that `SimpleQueuesService.create` would leave `is_queue=False` because `has_human` was never set, so `_reconcile_default_queue` would never create a default queue.
- Resolution:
  - Retracted. The DAO `create_run` runs `_make_run_flags`, which walks the constructed annotation steps and sets `has_human=True` when any annotation step has `origin="human"`. `SimpleQueuesService._make_run_data` defaults list-shaped evaluator inputs to `origin="human"` (service.py:4096-4099). For dict-shaped inputs, the explicit origin is honored.
  - `EvaluationsService.create_run` then runs `_reconcile_default_queue(run=created_run)` with the DAO-derived `has_human`. When `has_human=True`, the default queue is created and `is_queue=True` is written via a follow-up `edit_run`.
  - The explicit `EvaluationRunFlags(is_queue=False)` the service passes on create is consumed by `_make_run_flags`'s explicit-update merge and then reconciled, so the persisted value is correct.
  - End-state: human-evaluator simple queues do reach `is_queue=True`; auto-only "queues" intentionally do not, per design (`unify-evals-extension-synthesis.md:174-181`).
  - The layering question — that `is_queue` is service-only and the DAO does not enforce it — is split out as UEL-020.

### [CLOSED] UEL-007: `EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS` ships as `False` for local-dev UX

- ID: `UEL-007`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `high`
- Status: `wontfix`
- Category: `Consistency`
- Summary: The global default-queue policy toggle is a Python module-level constant (`False`) inside `service.py`, not an environment variable through `oss/src/utils/env.py`.
- Files:
  - `api/oss/src/core/evaluations/service.py`
- Resolution:
  - Wontfix per user decision: the constant is intentionally shipped as `False` so local development exercises the human-evaluator-conditional default-queue UX path. The `env` wiring (and the matching unit test) can be revisited when product flips the policy.

### [CLOSED] UEL-004: Runnable batch length mismatches can silently drop planned cells

- ID: `UEL-004`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The shared source-slice loop zipped planned cells with runner results and did not verify that the runner returned one execution per requested cell.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
  - `sdk/tests/pytest/unit/test_evaluations_runtime.py`
- Resolution:
  - Fixed by making `process_evaluation_source_slice` treat runner result-count mismatches as explicit scenario errors.
  - Missing trailing planned cells are now logged as failed result cells with a contract-violation message instead of disappearing from persistence.
  - Added focused SDK unit coverage for a two-repeat auto evaluator batch where the runner returns only one execution.
- Sources:
  - The over-return direction is now tracked separately as UEL-018.

### [CLOSED] UEL-005: Trace-backed queue slices do not load trace context before evaluator execution

- ID: `UEL-005`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Direct trace batches entered the unified runtime as `ResolvedSourceItem(trace_id=...)` only, so auto evaluators could receive no source trace, inputs, outputs, or span link.
- Files:
  - `api/oss/src/core/evaluations/runtime/sources.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
- Resolution:
  - Fixed by hydrating direct trace source items through `tracing_service` before converting them to SDK source items.
  - The resolver now populates `trace`, root `span_id`, `inputs`, and `outputs` from `ag.data` when the source trace is available.
  - Added focused unit coverage for direct source resolution and for `process_evaluation_source_slice(trace_ids=[...])` forwarding hydrated source context to the SDK runtime.

### [CLOSED] UEL-006: Source-trace links are hard-coded as `invocation`

- ID: `UEL-006`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Category: `Consistency`
- Summary: The SDK runtime emits upstream links under the key `invocation`.
- Files:
  - `sdks/python/agenta/sdk/evaluations/runtime/source_slice.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
- Resolution:
  - Wontfix per user decision: the invocation link key is the workflow contract, and the key for the invocation step should be `invocation`.

### [CLOSED] UEL-003: Dict-revision regression test asserts fields that the request model drops

- ID: `UEL-003`
- Origin: `mixed`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Testing`
- Summary: The staged unit test for dict-shaped evaluator revisions fails because it asserts `workflow_request.interface` and `workflow_request.configuration`, but the active `WorkflowServiceRequest` alias is `WorkflowInvokeRequest`, whose declared payload surface is `data`.
- Resolution:
  - Fixed by updating the regression test to assert preserved evaluator metadata through `workflow_request.data.revision["data"]` and `workflow_request.data.parameters`, matching the current SDK request model.

### [CLOSED] UEL-001: Backend evaluator runner receives dumped revisions but reads them like DTOs

- ID: `UEL-001`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Backend auto-annotation execution can invoke evaluators with an empty `interface` and `configuration` because the shared runtime dumps revisions to dictionaries before handing them to `BackendEvaluatorRunner`.
- Resolution:
  - Fixed by making `BackendEvaluatorRunner` read revision, nested `data`, and `flags` from both dict-shaped and DTO-shaped objects.
  - Added a focused unit case for dict-shaped evaluator revisions in `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`.

### [CLOSED] UEL-002: Startup instrumentation uses raw prints in the FastAPI module

- ID: `UEL-002`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`
- Summary: `api/entrypoints/routers.py` now emits startup timing with top-level `print()` calls during module import.
- Resolution:
  - Wontfix per user decision.
