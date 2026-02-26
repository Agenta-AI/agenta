# Code Review: `feature/annotation-queue-v2`

## Findings

### 1. [HIGH] Human evaluators are still auto-invoked in standard eval runs (required RFC fix is not implemented)
- **Where**:
  - `api/oss/src/core/evaluations/service.py:1947`
  - `api/oss/src/core/evaluations/tasks/legacy.py:1062`
- **What**:
  - `SimpleEvaluationsService.start()` dispatches all non-live runs with `testset + application + evaluators` to `evaluate_batch_testset`.
  - `evaluate_batch_testset()` iterates all annotation steps and invokes workflows without checking `step.origin`.
- **Why it matters**:
  - RFC v2 calls out this exact bug as a required fix (`docs/design/annotation-queue-v2/rfc-v2.md:150`).
  - Human steps should be queued/pending, not executed as auto workflows.
- **Impact**:
  - Human evaluator runs can still fail or be marked incorrectly instead of producing queue tasks.

### 2. [HIGH] `simple/evaluations/query` likely over-filters and drops valid runs
- **Where**:
  - `api/oss/src/core/evaluations/service.py:1826`
  - `api/oss/src/core/evaluations/service.py:2687`
  - `api/oss/src/dbs/postgres/evaluations/dao.py:678`
- **What**:
  - Query-building uses `EvaluationRunFlags` (non-optional booleans) and fills unspecified flags as `False`.
  - DAO applies JSONB `contains(...)` with all those false fields.
- **Why it matters**:
  - If caller omits filters, query still enforces `has_queries=false`, `has_testsets=false`, `has_evaluators=false`, etc.
- **Impact**:
  - Backward compatibility regression for listing simple evaluations; many legitimate runs can disappear from results.

### 3. [MEDIUM] Repeat assignment semantics are inconsistent (`repeats` can exceed assignment matrix)
- **Where**:
  - `api/oss/src/core/evaluations/service.py:2972`
  - `api/oss/src/core/evaluations/service.py:3035`
  - `api/oss/src/core/evaluations/service.py:1477`
- **What**:
  - `repeats` is set on run data, but `queue.data.user_ids` is not expanded to match repeat count.
  - Assignment logic uses `queue.data.user_ids` shape (not run repeats) for partitioning.
- **Why it matters**:
  - API can report `repeats > 1` while only one repeat is actually assignable.
- **Impact**:
  - Incorrect/incomplete multi-annotator behavior.

### 4. [MEDIUM] Must-have RFC v2 scope is not complete on this branch
- **Where**:
  - RFC scope: `docs/design/annotation-queue-v2/rfc-v2.md:413`
  - Router surface: `api/oss/src/apis/fastapi/evaluations/router.py:2416`
  - Web diff: `web/oss/src/components/EvaluationRunsTablePOC/constants.ts:16`, `web/oss/src/lib/hooks/usePreviewEvaluations/index.ts:39`
- **What**:
  - No inbox UI implementation and no frontend queue-assignment wiring landed here.
  - No write-back/export endpoint for testset annotations.
  - Convenience create endpoint does not implement RFC source payload shape (trace IDs / testset revision in create call).
- **Why it matters**:
  - Branch does not satisfy several `Must have (v1)` items from the design doc.
- **Impact**:
  - Functionality is only partial relative to stated branch goal/design docs.

### 5. [LOW] Queue query defaults to broad project scope instead of “current user inbox” semantics
- **Where**:
  - `api/oss/src/apis/fastapi/evaluations/router.py:2525`
  - `api/oss/src/core/evaluations/service.py:3077`
- **What**:
  - `query_queues` does not default `user_id` to `request.state.user_id`.
  - Without explicit filters, it returns project-wide queues.
- **Why it matters**:
  - RFC describes an inbox centered on current user assignments.
- **Impact**:
  - Potential product behavior mismatch and larger-than-expected data exposure in responses.

## Open Questions / Assumptions

1. Is `SimpleEvaluationsService.query()` intended to exclude ad-hoc runs and all runs with evaluator/testset/query flags unless explicitly requested?
2. Should `repeats` be derived strictly from assignment matrix length, or should assignments be auto-expanded when `repeats` is larger?
3. For human/custom steps, should pending `evaluation_results` rows be pre-seeded, or is “create on annotation submit” the intended model?

## Secondary Notes

- Migration and DB/index work for queue assignee filtering is directionally good:
  - `api/oss/databases/postgres/migrations/core/versions/e9f0a1b2c3d4_add_user_ids_to_evaluation_queues.py`
  - `api/oss/src/dbs/postgres/evaluations/dbes.py:287`
- Non-test static checks passed on changed API files:
  - `ruff check` (targeted changed backend files)
- Per repo instructions, tests were **not** run.
