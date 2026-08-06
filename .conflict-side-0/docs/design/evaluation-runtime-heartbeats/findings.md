# Findings: Evaluation Runtime Heartbeats

Review target:

- commit `7e61712920c4d2d827323706d3c6c692b819d8d2` (`initial implementation`)
- PR `#4047` comments and suggested fixes

## Findings

### 1. High: renew/release are non-atomic and can clobber a newer owner

Files:

- `api/oss/src/core/evaluations/runtime/locks.py`

Relevant code:

- `_renew_lock()`
- `_release_lock()`

Problem:

- both paths do `GET -> compare token -> SETEX/DELETE`
- if owner A reads the old value, the key expires, owner B acquires the same key, and then A finishes its write/delete, A can overwrite or delete B's lock

Why this matters:

- this breaks the ownership guarantee the runtime-lock design depends on
- stale owners can destroy valid locks acquired by newer jobs

Recommendation:

- switch renew/release to atomic Lua scripts or equivalent compare-and-set Redis primitives

### 2. High: the worker wrapper does not actually prevent overlapping executions of the same run

Files:

- `api/oss/src/tasks/taskiq/evaluations/worker.py`
- `api/oss/src/core/evaluations/runtime/locks.py`

Relevant code:

- `EvaluationsWorker._with_job_lock()`
- `acquire_job_lock()`

Problem:

- `_with_job_lock()` generates a fresh random `job_id` for every execution
- the Redis key is `eval:run:{run_id}:job:{job_id}:lock`
- because `job_id` is always new, `SET NX` succeeds on a different key each time
- this means concurrent executions of the same run still proceed independently

Additional issue:

- if `acquire_job_lock()` ever does return `None`, the worker logs a warning and still runs the job

Why this matters:

- the current implementation adds observability, but it does not enforce any non-overlap semantics for non-queue loops
- batch query, batch testset, and batch invocation can still overlap on the same run

Recommendation:

- decide explicitly whether Phase 1 is observability-only or coordination-enforcing
- if coordination is intended, the wrapper needs a real run-level overlap check or a dedicated execution-claim mechanism per run topology

### 3. Medium: a heartbeat failure can surface as a task failure during cleanup

Files:

- `api/oss/src/core/evaluations/runtime/locks.py`
- `api/oss/src/tasks/taskiq/evaluations/worker.py`

Relevant code:

- `run_job_heartbeat()`
- `_with_job_lock()`

Problem:

- `run_job_heartbeat()` does not catch ordinary exceptions from `renew_job_lock()`
- `_with_job_lock()` awaits the heartbeat task in `finally` and only suppresses `CancelledError`
- if the heartbeat task dies with a Redis/network exception, that exception can be re-raised during teardown after the main evaluation logic has already completed

Why this matters:

- a successful evaluation can be reported as failed because heartbeat cleanup re-raises an unrelated infrastructure error

Recommendation:

- make `run_job_heartbeat()` mirror the worker-heartbeat loop and swallow/log transient renewal errors
- or suppress non-cancellation heartbeat-task exceptions in `_with_job_lock()` teardown

### 4. Medium: the new test suite is not executing in the current environment

Files:

- `api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py`

Problem:

- the tests depend on `fakeredis`
- `fakeredis` is not installed in the current test environment
- running the test file here skipped all 13 tests

Observed command:

```text
pytest -q api/oss/tests/pytest/unit/test_evaluation_runtime_locks.py
```

Observed result:

- `13 skipped`
- skip reason: `No module named 'fakeredis'`

Why this matters:

- the runtime-lock implementation landed without active test coverage in this environment

Recommendation:

- add `fakeredis` to test dependencies
- or rewrite the unit coverage to use an in-repo fake without external dependency drift

## PR 4047 Comment Follow-Up

PR `#4047` only contains inline review comments on the docs commit. No inline review comments were left on the runtime-lock implementation commit itself.

### Unresolved doc comments

#### A. Invalid `json` fenced examples

Files:

- `docs/design/evaluation-runtime-heartbeats/README.md`
- `docs/design/evaluation-runtime-heartbeats/plan.md`

Problem:

- code fences are marked as `json`
- examples still use union syntax like `"api" | "web" | "sdk"`, which is not valid JSON

Suggested fix:

- use `text` fences for pseudo-JSON
- or use valid JSON examples and document allowed enum values separately

#### B. Explicitly document `SCAN`, not `KEYS`

Files:

- `docs/design/evaluation-runtime-heartbeats/README.md`
- `docs/design/evaluation-runtime-heartbeats/plan.md`

Problem:

- the docs describe wildcard job-lock checks
- they do not explicitly warn implementers not to use Redis `KEYS`

Current implementation note:

- the code correctly uses `scan_iter()` in `locks.py`

Suggested fix:

- add an explicit doc note that wildcard lock discovery must use `SCAN` or a dedicated index/set, never `KEYS`

#### C. Clarify `evaluation_id` vs `run_id` for SDK heartbeat endpoints

Files:

- `docs/design/evaluation-runtime-heartbeats/README.md`

Problem:

- the endpoint shape uses `{evaluation_id}`
- the lock model uses `run_id`
- the docs do not state that the evaluation id here is the evaluation run id

Suggested fix:

- add a one-line clarification that `evaluation_id` here is `run.id`, i.e. the `run_id` used in lock keys

## Summary

The implementation is a good first step for runtime observability, but the locking semantics are not safe enough yet to rely on for ownership or overlap prevention. The top priority fixes are:

1. make renew/release atomic
2. decide and implement real non-overlap behavior for non-queue runs
3. harden heartbeat-task failure handling
4. make the lock tests actually run
