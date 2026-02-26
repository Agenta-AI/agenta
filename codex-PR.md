# Code Review: `feature/annotation-queue-v2` (Post-main merge)

## Context
- Reviewed at `HEAD` commit: `6684ca742`.
- Compared implementation against `origin/main` and `docs/design/annotation-queue-v2/*`.
- Focus: completeness, soundness, consistency, correctness, security, functionality, compatibility.

## Findings

### 1. [HIGH] Human evaluators are still auto-invoked in standard eval runs
- **Where**:
  - `api/oss/src/core/evaluations/service.py:1953`
  - `api/oss/src/core/evaluations/tasks/legacy.py:1070`
- **What**:
  - Non-live runs with `testset + application + evaluators` dispatch to `evaluate_batch_testset`.
  - `evaluate_batch_testset` iterates all annotation steps and invokes workflows without checking `step.origin`.
- **Why it matters**:
  - RFC v2 marks this as a required fix (`docs/design/annotation-queue-v2/rfc-v2.md:150`).
  - Human steps should be queued/pending, not executed as auto workflows.
- **Impact**:
  - Human evaluator runs can still fail/be misclassified instead of producing queue tasks.

### 2. [HIGH] `simple/evaluations/query` likely over-filters and drops valid runs
- **Where**:
  - `api/oss/src/core/evaluations/service.py:1823`
  - `api/oss/src/core/evaluations/service.py:2693`
  - `api/oss/src/dbs/postgres/evaluations/dao.py:678`
- **What**:
  - Query path builds flags through `EvaluationRunFlags` defaults (`None -> False`) in `_make_evaluation_run_flags`.
  - DAO applies `flags.contains(run_flags)` on the full false-filled payload.
- **Why it matters**:
  - Omitted filters become hard filters like `has_queries=false`, `has_testsets=false`, `has_evaluators=false`.
- **Impact**:
  - Backward-compat regression for listing simple evaluations.

### 3. [MEDIUM] Repeat semantics are inconsistent (`repeats` can exceed assignment matrix)
- **Where**:
  - `api/oss/src/core/evaluations/service.py:2978`
  - `api/oss/src/core/evaluations/service.py:3041`
  - `api/oss/src/core/evaluations/service.py:1483`
- **What**:
  - `repeats` is stored on run data, but queue assignment matrix (`queue.data.user_ids`) is not expanded to match.
  - Assignment logic keys off `queue.data.user_ids` shape.
- **Impact**:
  - API can report `repeats > 1` while only one repeat is actually assignable.

### 4. [MEDIUM] RFC v2 must-have scope is still incomplete on this branch
- **Where**:
  - RFC must-have list: `docs/design/annotation-queue-v2/rfc-v2.md:413`
  - Implemented API surface: `api/oss/src/apis/fastapi/evaluations/router.py:2416`
  - Web changes: `web/oss/src/components/EvaluationRunsTablePOC/constants.ts:16`, `web/oss/src/lib/hooks/usePreviewEvaluations/index.ts:39`
- **What**:
  - No inbox UI implementation.
  - No frontend queue-assignment wiring to annotation UI.
  - No write-back/export endpoint for testset annotations.
  - Convenience create flow does not match RFC source payload shape (`source.type + trace_ids/testset_revision_id`).

### 5. [LOW] Queue query defaults to project-wide scope, not current-user inbox semantics
- **Where**:
  - `api/oss/src/apis/fastapi/evaluations/router.py:2519`
  - `api/oss/src/core/evaluations/service.py:3083`
- **What**:
  - `query_queues` does not default `user_id` to `request.state.user_id`.
- **Impact**:
  - Behavior mismatch with inbox expectation; broader-than-expected queue lists.

## Noted as resolved in current HEAD
- DAO project-scope filter overwrite issue is **not present** in current code (`stmt = stmt.filter(...)` chaining is intact).
- `close_run` / `close_runs` correctly set `is_closed = True` in current DAO.

## Validation
- `ruff check` on changed backend evaluation/entrypoint files: **passed**.
- Per repository instruction, tests were **not run**.
