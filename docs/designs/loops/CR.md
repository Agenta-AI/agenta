# Code Review: PR #4047

Date: 2026-03-25

PR: `https://github.com/Agenta-AI/agenta/pull/4047`

Branch reviewed: `feat/extend-runs-and-queues`

Base reviewed against: `origin/main`

Head commit reviewed: `8d38e4174ba705d82dec17abcd1636d25a7dec13`

Overall assessment: re-reviewed after follow-up fixes. The three code-level findings below are now closed on the current branch. The owner-checked lock renew/release path is also already atomic through Lua-backed Redis `EVAL` in `api/oss/src/utils/caching.py`.

## Scope

- Reviewed the local diff against `origin/main`.
- Reviewed open GitHub review threads for PR `#4047`.
- Inspected the changed evaluation runtime-locking, worker, task-loop, tracing-hash/filtering, migration, and lock-test paths.
- Ran targeted unit tests for the touched areas.

## Findings

### 1. High: losing the job lease does not stop the running worker

Severity: High

Status: Closed on re-review

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

Status: Closed on re-review

Files:

- `api/oss/src/core/evaluations/tasks/legacy.py`

Evidence:

- `evaluate_batch_invocation()` now stores per-repeat invocation status, `trace_id`, and serialized app error payload before creating result rows in `api/oss/src/core/evaluations/tasks/legacy.py`.
- Result creation again persists `error` on failed invocation rows instead of collapsing everything into a trace-presence check.

Re-review note:

- Closed. The batch-invocation path now preserves the underlying app error payload and restores the original success/failure semantics for non-cached invocations.

### 3. Low: worker heartbeats overwrite `created_at` on every refresh

Severity: Low

Status: Closed on re-review

Files:

- `api/oss/src/core/evaluations/runtime/locks.py`

Evidence:

- `refresh_worker_heartbeat()` now reads the existing payload first and preserves its original `created_at` while only updating `updated_at` in `api/oss/src/core/evaluations/runtime/locks.py`.
- A unit test now verifies that repeated refreshes keep the first `created_at` value stable in `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`.

Re-review note:

- Closed. This also addresses the still-open GitHub review thread on the same issue.

## Open GitHub Comments

- I found 1 open review thread on PR `#4047`.
- Thread: `https://github.com/Agenta-AI/agenta/pull/4047#discussion_r2983474220`
- File: `api/oss/src/core/evaluations/runtime/locks.py`
- Re-review assessment: the current branch code now addresses the `created_at` overwrite issue described in that thread.

## Verification

Commands reviewed or run:

- `git diff --stat origin/main...HEAD`
- `gh api graphql ... reviewThreads ...`
- `pytest -q api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py api/oss/tests/pytest/unit/evaluations/test_cache_split_utils.py api/oss/tests/pytest/unit/evaluations/test_run_flags.py api/oss/tests/pytest/unit/tracing/utils/test_filtering.py api/oss/tests/pytest/unit/tracing/utils/test_hashing.py`

Observed results:

- Targeted pytest run after fixes: `48 passed, 2 warnings`.

Residual risk:

- I did not run broader integration/e2e coverage for the evaluation loops in this pass.
