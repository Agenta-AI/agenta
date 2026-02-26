# Code Review: `feature/annotation-queue-v2`

**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-26 (updated after merge from main)
**Branch:** `feature/annotation-queue-v2`
**Scope:** Ad-hoc evaluation queues, batch trace/testcase evaluation, queue user assignment

---

## Summary

This branch introduces the **SimpleQueuesService** layer — a convenience API for creating ad-hoc evaluation queues backed by existing evaluation infrastructure. The diff is purely additive (~2200 lines added, ~29 removed).

**Key additions:**

1. **`SimpleQueuesService`** — orchestrates queue creation, trace/testcase ingestion, scenario querying
2. **New worker tasks** — `evaluate_batch_invocation`, `evaluate_batch_traces`, `evaluate_batch_testcases` (in `tasks/legacy.py`)
3. **`SimpleQueuesRouter`** — REST endpoints under `/preview/simple/queues/`
4. **`is_adhoc` flag** on `EvaluationRunFlags` — marks evaluation runs for ad-hoc/bucket behavior
5. **`user_ids` column** — denormalized `UUID[]` on `evaluation_queues` for efficient assignee filtering (GIN indexed)
6. **`batch_size` / `batch_offset`** on `EvaluationQueueData` — configurable scenario partitioning
7. **DB migrations** — two new Alembic migrations (OSS + EE mirrors)
8. **`SimpleQueue*` types** — `SimpleQueueKind`, `SimpleQueueData`, `SimpleQueueCreate`, `SimpleQueueQuery`, etc.

**Endpoints added:**

| Method | Path | Operation |
|--------|------|-----------|
| POST | `/preview/simple/queues/` | Create queue |
| POST | `/preview/simple/queues/query` | Query queues |
| GET | `/preview/simple/queues/{queue_id}` | Fetch queue |
| POST | `/preview/simple/queues/{queue_id}/scenarios/query` | Query queue scenarios |
| POST | `/preview/simple/queues/{queue_id}/traces/` | Add traces to queue |
| POST | `/preview/simple/queues/{queue_id}/testcases/` | Add testcases to queue |

---

## HIGH — `_make_evaluation_run_flags` Coerces `None` to `False` in Query Path

**Severity: HIGH**
**File:** `api/oss/src/core/evaluations/service.py:2700-2712`

```python
async def _make_evaluation_run_flags(self, *, is_closed=None, is_adhoc=None, ...):
    return EvaluationRunFlags(
        is_closed=is_closed or False,   # None -> False
        is_adhoc=is_adhoc or False,     # None -> False
        has_queries=has_queries or False,
        ...
    )
```

This method is used for both **creating** run flags (where `False` defaults are correct) and **query construction** via `_make_evaluation_run_query`. In the query path, `None` should mean "don't filter", but it becomes `False` which means "filter for runs where this flag is false".

The JSONB containment query `flags @> {"is_adhoc": false, "is_closed": false, "is_live": false, ...}` will only match runs where ALL unspecified flags are explicitly `false`.

**Impact:** `SimpleQueuesService.query()` and `SimpleEvaluationsService.query()` silently over-filter. For example, querying for `is_adhoc=True` will also require `is_closed=False`, `is_live=False`, etc. — filtering out closed or live adhoc runs.

**Fix:** Use `EvaluationRunQueryFlags` (which has `Optional` fields) for the query path with `exclude_none=True` serialization. The `_make_evaluation_run_query` should build `EvaluationRunQueryFlags` directly instead of routing through `_make_evaluation_run_flags`.

**Note:** The caller in `SimpleEvaluationsService.query()` already does `flags.get("is_closed")` via `model_dump(exclude_none=True)`, but the downstream method re-introduces the `None -> False` coercion.

---

## MEDIUM — No Queue Update When Adding Items to Existing Queue

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/tasks/legacy.py` — `_evaluate_batch_items` function

After creating new scenarios, the code checks for an existing queue and creates one if missing. But it **never updates** an existing queue's `data.scenario_ids` with the newly created scenarios:

```python
existing_queues = await evaluations_service.query_queues(...)
has_run_queue = any(queue.run_id == run_id for queue in existing_queues)
if not has_run_queue:
    await evaluations_service.create_queue(...)  # only creates if no queue exists
# <-- missing: update existing queue's scenario_ids with new scenarios
```

**Impact:** After calling `add_traces`/`add_testcases` on an existing queue, the queue's `data.scenario_ids` is stale. `filter_scenario_ids()` relies on the queue's scenario list, so newly added items may not appear in user-assigned scenario sets.

**Fix:** When `has_run_queue is True`, fetch the existing queue, append new scenario IDs to `data.scenario_ids`, and call `edit_queue`.

---

## MEDIUM — Stale Queue Response After `add_traces` / `add_testcases`

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/service.py` — `SimpleQueuesService.add_traces` / `add_testcases`

Both methods fetch the queue/run **before** dispatching the async worker task, then return that pre-dispatch snapshot:

```python
ok = await self.simple_evaluations_service.evaluate_batch_traces(...)
if not ok:
    return None
return self._parse_queue(queue=queue, run=run)  # <-- fetched before dispatch
```

**Impact:** Callers see outdated item counts and status. Not data corruption, but misleading.

**Recommendation:** Document that the response is a pre-dispatch snapshot and callers should poll for updated state, or re-fetch after dispatch.

---

## MEDIUM — `_normalize_assignments` Union Type Ambiguity

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/service.py` — `SimpleQueuesService._normalize_assignments`

```python
def _normalize_assignments(self, *, assignments: Optional[List[List[UUID]] | List[UUID]]):
    first_item = assignments[0]
    if isinstance(first_item, list):
        return [...]  # List[List[UUID]]
    return [[UUID(str(user_id)) for user_id in assignments]]  # List[UUID]
```

The Union type `List[List[UUID]] | List[UUID]` is ambiguous for Pydantic v2 deserialization. A JSON array `["uuid1", "uuid2"]` matches both types. Pydantic tries the first type in the Union, which may not match user intent.

Also, `SimpleQueueData.assignments` uses this same Union type — Pydantic's left-to-right Union resolution means `List[List[UUID]]` is always tried first, so a flat list like `["uuid1"]` could be coerced to `[[uuid1]]` if Pydantic manages to parse each UUID string as a single-element list.

**Recommendation:** Use a discriminated approach, or always require `List[List[UUID]]` with the single-repeat case being `[[uuid1, uuid2]]`.

---

## MEDIUM — `fetch_trace` Retry Loop Is Expensive Per-Scenario

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/utils.py:139-163`

```python
async def fetch_trace(tracing_router, request, trace_id, max_retries=15, delay=1.0):
    for attempt in range(max_retries):
        try:
            response = await tracing_router.fetch_trace(...)
        except Exception:
            pass  # silently swallows all errors
        await sleep(delay)
```

Called **per-scenario** in `_evaluate_batch_items` for trace-based queues. With 15 retries x 1s x N traces, a batch of 100 missing traces could block the worker for **25+ minutes**. The broad `except Exception: pass` swallows programming bugs.

**Recommendation:** Reduce max retries for this use case, add exponential backoff, and log exceptions at `WARNING` level.

---

## MEDIUM — `start()` Dispatch Logic Change — Live Query Path Removed

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/service.py` — `SimpleEvaluationsService.start()`

The original code dispatched `evaluate_live_query` for runs with query steps:

```python
# BEFORE:
if _evaluation.data.query_steps:
    await self.evaluations_worker.evaluate_live_query.kiq(...)
elif _evaluation.data.testset_steps:
    await self.evaluations_worker.evaluate_batch_testset.kiq(...)
```

The new code removes the live query dispatch entirely from this branch:

```python
# AFTER:
if has_testset_steps and has_application_steps and has_evaluator_steps:
    await self.evaluations_worker.evaluate_batch_testset.kiq(...)
elif has_testset_steps and has_application_steps and not has_evaluator_steps and not has_query_steps:
    await self.evaluations_worker.evaluate_batch_invocation.kiq(...)
else:
    log.warning("[EVAL] [start] [skip] unsupported non-live run topology", ...)
```

Runs with `query_steps` (and no testset steps) will now fall into the `else` branch and only log a warning instead of being dispatched.

**Impact:** Live query evaluations that were previously started via `SimpleEvaluationsService.start()` will silently not execute. This may be intentional (live runs use a different code path), but should be verified.

---

## LOW — Source Step Empty References / Key-Name Convention

**Severity: LOW**
**File:** `api/oss/src/core/evaluations/service.py` — `SimpleQueuesService._make_run_data`

```python
source_step = EvaluationRunDataStep(
    key="query-direct",  # or "testset-direct"
    type="input",
    origin="custom",
    references={},  # empty
)
```

Flag inference in `_make_run_flags` (in `dbs/postgres/evaluations/utils.py`) uses a string convention to detect queue kind:

```python
if flags.is_adhoc and not _references:
    step_key = (_step.key or "").lower()
    if "query" in step_key:
        flags.has_queries = True
```

Renaming the key breaks flag computation silently.

**Recommendation:** Set explicit references or use a different mechanism for flag inference.

---

## LOW — Queue Query Hardcodes `is_sequential=False`

**Severity: LOW**
**File:** `api/oss/src/core/evaluations/service.py` — `SimpleQueuesService.query()`

```python
queue=EvaluationQueueQuery(
    flags=EvaluationQueueFlags(is_sequential=False),
    ...
)
```

Sequential queues are invisible to the SimpleQueues query API. May be intentional but is undocumented.

---

## LOW — Migration `down_revision` Chain Needs Verification

**Severity: LOW**
**Files:** `d7e8f9a0b1c2_add_is_adhoc_to_evaluation_run_flags.py`, `e9f0a1b2c3d4_add_user_ids_to_evaluation_queues.py`

Migration `d7e8f9a0b1c2` declares `down_revision = "c2d3e4f5a6b7"`. This must match an existing migration revision ID on `main`. If it doesn't, `alembic upgrade head` will fail.

**Recommendation:** Verify `c2d3e4f5a6b7` exists in the current migration chain after the merge.

---

## Positive Observations

- **Clean additive diff** — After merging main, the branch is purely additive (~2200 lines, no destructive changes to existing code paths).
- **Worker task registration** is well-structured — `EvaluationsWorker` cleanly maps all 5 tasks with `retry_on_error=False` and proper service injection.
- **`_flatten_queue_user_ids`** is a clean utility with proper deduplication and None-safe handling.
- **Validator functions** on `batch_size` / `batch_offset` include the `isinstance(v, bool)` guard (Python's `bool` is a subclass of `int`).
- **`filter_scenario_ids`** with sequential/round-robin modes is well-designed with unit test coverage.
- **`_evaluate_batch_items`** correctly handles mixed human/auto evaluator steps — skipping invocation for human/custom origins and creating PENDING results.
- **Migration data migration** for user_ids (flattening nested JSONB into UUID array) is well-implemented with `CROSS JOIN LATERAL`.
- **GIN index** on `user_ids` array is the correct index type for `@>` / `&&` array operations.
- **Entrypoint wiring** is clean — `SimpleQueuesService` gets its dependencies injected properly, circular dependency with worker is handled.
- **Permission checks** are consistently applied across all SimpleQueuesRouter endpoints.

---

## Summary of Findings

| Severity | Count | Key Issues |
|----------|-------|------------|
| HIGH | 1 | Flag query coercion (`None` -> `False`) causes over-filtering |
| MEDIUM | 4 | Queue not updated on add; stale response; Union type ambiguity; retry loop cost; start() dispatch change |
| LOW | 3 | Key-name convention fragility; hardcoded sequential filter; migration chain |

**Recommendation:** The HIGH issue should be fixed before merging — it will cause incorrect query results for any evaluation/queue list that uses flag filters. The MEDIUM queue-not-updated issue should also be addressed as it breaks the core "add items to queue" flow. The rest can be tracked as follow-ups.
