# Code Review: PR #4047

Date: 2026-03-25

PR: `https://github.com/Agenta-AI/agenta/pull/4047`

Branch reviewed: `feat/extend-runs-and-queues`

Base reviewed against: `origin/main`

Head commit reviewed: `8d38e4174ba705d82dec17abcd1636d25a7dec13`

Overall assessment: re-reviewed after follow-up fixes. All six code-level findings below are fixed on the current branch. One unresolved GitHub review thread still does not reproduce against the current tracing code path and remains a `Won't Fix` unless the reviewer has contrary runtime evidence. The owner-checked lock renew/release path is also already atomic through Lua-backed Redis `EVAL` in `api/oss/src/utils/caching.py`.

## Scope

- Reviewed the local diff against `origin/main`.
- Reviewed open GitHub review threads for PR `#4047`.
- Inspected the changed evaluation runtime-locking, worker, task-loop, tracing-hash/filtering, migration, and lock-test paths.
- Ran targeted unit tests for the touched areas.

## Findings

### 1. High: losing the job lease does not stop the running worker

Severity: High

Status: Fixed

Files:

- `api/oss/src/core/evaluations/runtime/locks.py`
- `api/oss/src/tasks/taskiq/evaluations/worker.py`

Evidence:

- `run_job_heartbeat()` now raises `JobLockLeaseLostError` when ownership is lost or when renew errors exceed the `last_successful_renew + ttl - safety_margin` deadline in `api/oss/src/core/evaluations/runtime/locks.py`.
- `EvaluationsWorker._with_job_lock()` now races the runner against the heartbeat task, cancels the runner when the heartbeat fails, and only returns normally when the runner completes first in `api/oss/src/tasks/taskiq/evaluations/worker.py`.
- Regression coverage was added for both the renew-deadline watchdog and runner cancellation in `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`.

Re-review note:

- Closed. The worker now aborts execution once it can no longer prove lease ownership.
- The implemented policy matches the intended watchdog semantics: `ttl=300`, `interval=30`, `safety_margin=60`.

### 2. Medium: batch invocation failures no longer persist the application error payload

Severity: Medium

Status: Fixed

Files:

- `api/oss/src/core/evaluations/tasks/legacy.py`

Evidence:

- `evaluate_batch_invocation()` now stores per-repeat invocation status, `trace_id`, and serialized app error payload before creating result rows in `api/oss/src/core/evaluations/tasks/legacy.py`.
- Result creation again persists `error` on failed invocation rows instead of collapsing everything into a trace-presence check.

Re-review note:

- Closed. The batch-invocation path now preserves the underlying app error payload and restores the original success/failure semantics for non-cached invocations.

### 3. Low: worker heartbeats overwrite `created_at` on every refresh

Severity: Low

Status: Fixed

Files:

- `api/oss/src/core/evaluations/runtime/locks.py`

Evidence:

- `refresh_worker_heartbeat()` now reads the existing payload first and preserves its original `created_at` while only updating `updated_at` in `api/oss/src/core/evaluations/runtime/locks.py`.
- A unit test now verifies that repeated refreshes keep the first `created_at` value stable in `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`.

Re-review note:

- Closed. This also addresses the still-open GitHub review thread on the same issue.

### 4. Medium: `hashes` filtering accepts invalid `key` and operator combinations

Severity: Medium

Status: Fixed

Files:

- `api/oss/src/core/tracing/utils/filtering.py`

Description:

- `_parse_hashes_condition()` does not enforce the same key/operator invariants as `_parse_events_condition()`.
- Invalid combinations such as list or existence operators with a non-null `condition.key` are accepted instead of being rejected up front.

Evidence:

- `_parse_events_condition()` rejects `condition.key` for `_L_OPS + _E_OPS` and requires a valid dot-notation key for `_D_OPS`.
- `_parse_hashes_condition()` now rejects non-null `condition.key` for list and existence operators before any value normalization, matching the `events` parser contract.
- Regression coverage was added for invalid `hashes.key` usage with list and existence operators in `api/oss/tests/pytest/unit/tracing/utils/test_filtering.py`.
- The live unresolved PR thread is: `https://github.com/Agenta-AI/agenta/pull/4047#discussion_r2986922384`.

Impact:

- Malformed `hashes` filters can silently pass validation and then be ignored or interpreted inconsistently downstream.
- This creates correctness drift between `events` and `hashes` filtering and makes client-side query bugs harder to diagnose.

Suggestion:

- Mirror the `_parse_events_condition()` guardrails in `_parse_hashes_condition()`.
- Require `condition.key is None` for list and existence operators.
- Require a present, valid key for dict operators before value normalization.

Re-review note:

- Closed. `hashes` filtering now enforces the same key/operator invariants as the `events` path.

### 5. Low: legacy evaluation tasks still sign a secret token and discard it

Severity: Low

Status: Fixed

Files:

- `api/oss/src/core/evaluations/tasks/legacy.py`
- `api/oss/src/services/auth_service.py`

Description:

- The legacy evaluation task setup still awaits `sign_secret_token()`, but the returned token is never used.

Evidence:

- The unused `await sign_secret_token(...)` calls were removed from the legacy evaluation task setup blocks in `api/oss/src/core/evaluations/tasks/legacy.py`.
- `sign_secret_token()` in `api/oss/src/services/auth_service.py` was side-effect free here; removing the discarded call does not change downstream request behavior.
- The live unresolved PR thread is: `https://github.com/Agenta-AI/agenta/pull/4047#discussion_r2986922453`.

Impact:

- This adds avoidable JWT-signing overhead on each task start.
- More importantly, it implies credential propagation is happening when the token is not actually used by downstream requests, which is misleading for future maintenance.

Suggestion:

- Remove the unused `sign_secret_token()` calls from the legacy evaluation task paths.
- If a secret token is still required, wire it explicitly into the downstream call sites instead of generating and discarding it.

Re-review note:

- Closed. The misleading no-op credential preparation step is gone.

### 6. Medium: lock contention returns `None`, which is surfaced like a successful task completion

Severity: Medium

Status: Fixed

Files:

- `api/oss/src/tasks/taskiq/evaluations/worker.py`

Description:

- When `_with_job_lock()` cannot acquire the execution lock, it returns `None` instead of an explicit skip result or dedicated non-error exception.

Evidence:

- `acquire_job_lock(...)` returning `None` now causes `_with_job_lock()` to raise `JobLockSkippedError` with `run_id`, `job_id`, and `lock_id`.
- This prevents the Taskiq wrapper methods from logging `"[TASK] Completed ..."` on the skip path and makes lock contention machine-distinguishable from a successful completion.
- Regression coverage was added in `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py` for the dedicated skip exception path.
- The live unresolved PR thread is: `https://github.com/Agenta-AI/agenta/pull/4047#discussion_r2986922472`.

Impact:

- The queue layer and any callers inspecting task completion cannot reliably distinguish “intentionally skipped because another worker owns the run” from “completed successfully with no result.”
- That weakens observability and can create false-positive success semantics around concurrency protection.

Suggestion:

- Return an explicit skipped payload, or raise a dedicated exception that Taskiq treats as non-retry/non-failure according to the intended semantics.
- Make the skip reason machine-readable so monitoring and follow-up orchestration can react correctly.

Re-review note:

- Closed. The branch now uses a dedicated `JobLockSkippedError` instead of silently returning `None`.

## Open GitHub Comments

- I found 4 unresolved review threads on PR `#4047` as of 2026-03-25.
- Three are addressed on the current branch and correspond to Findings 4, 5, and 6 above.
- One unresolved thread does not reproduce as a code-level bug on the current branch:
  `https://github.com/Agenta-AI/agenta/pull/4047#discussion_r2986922425`

Non-reproduced thread assessment:

- Status: Won't Fix

- The comment claims cached trace reuse may receive trace summaries without `spans`, causing `_build_trace_context()` to fail.
- On the current branch, `fetch_traces_by_hash()` calls `TracingService.query_traces()` with `focus=TRACE` and `format=AGENTA`.
- `TracingService.query_traces()` calls `query_spans_or_traces()` and then `trace_map_to_traces(...)`.
- `parse_spans_into_response(...)` builds a trace map with `"spans"` for each root trace, and `trace_map_to_traces(...)` converts that into `Trace(trace_id=..., spans=spans)`.
- Based on the implemented data path, cached traces returned by `fetch_traces_by_hash()` already carry `spans`, so the reported summary-only failure mode does not reproduce from the current code.

## Verification

Commands reviewed or run:

- `git diff --stat origin/main...HEAD`
- `gh api graphql ... reviewThreads ...`
- `pytest -q api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py api/oss/tests/pytest/unit/evaluations/test_run_flags.py api/oss/tests/pytest/unit/tracing/utils/test_filtering.py api/oss/tests/pytest/unit/tracing/utils/test_hashing.py`

Observed results:

- Targeted pytest run after fixes: `51 passed, 3 warnings`.

Residual risk:

- I did not run broader integration/e2e coverage for the evaluation loops in this pass.
