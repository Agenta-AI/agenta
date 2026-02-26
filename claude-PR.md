# Code Review: `feature/annotation-queue-v2`

**Reviewer:** Claude Opus 4.6
**Date:** 2026-02-26
**Branch:** `feature/annotation-queue-v2` (13 commits ahead of `main`)
**Scope:** Annotation queue v2 — ad-hoc evaluation queues, batch trace/testcase evaluation, queue user assignment

---

## Summary

This branch introduces the **SimpleQueuesService** layer — a convenience API for creating ad-hoc evaluation queues backed by existing evaluation infrastructure. Key additions:

1. **`SimpleQueuesService`** — orchestrates queue creation, trace/testcase ingestion, scenario querying
2. **New worker tasks** — `evaluate_batch_invocation`, `evaluate_batch_traces`, `evaluate_batch_testcases`
3. **`SimpleQueuesRouter`** — REST endpoints under `/preview/simple/queues/`
4. **`is_adhoc` flag** — marks evaluation runs for ad-hoc/bucket behavior
5. **`user_ids` column** — denormalized UUID array on `evaluation_queues` for efficient assignee filtering
6. **DB migrations** — two new Alembic migrations (OSS + EE mirrors)
7. **Routing cleanup** — removed duplicate non-`/preview/` route mounts; removed Tools and AI Services wiring

---

## CRITICAL — Project Scope Bypass in DAO (Security)

**Severity: CRITICAL**
**Files:** `api/oss/src/dbs/postgres/evaluations/dao.py`

The diff introduces a **project scope bypass** across ~20 DAO methods. The pattern:

```python
# Line 1: builds a scoped query
stmt = select(EvaluationRunDBE).filter(
    EvaluationRunDBE.project_id == project_id,
)

# Line 2: OVERWRITES stmt, discarding project_id filter
stmt = select(EvaluationRunDBE).filter(
    EvaluationRunDBE.id == run_id,
)
```

The original code was `stmt = stmt.filter(...)` (chaining filters). The diff changes every instance to `stmt = select(...).filter(...)` (creating a new statement).

**Affected methods** (all entity types — runs, scenarios, results, metrics):
- `fetch_run`, `fetch_runs`
- `edit_run`, `edit_runs`
- `delete_run`, `delete_runs`
- `fetch_scenario`, `fetch_scenarios`, `edit_scenario`, `edit_scenarios`, `delete_scenario`, `delete_scenarios`
- `fetch_results`, `edit_result`, `edit_results`, `delete_result`, `delete_results`
- `fetch_metrics`, `edit_metrics`, `delete_metrics`

**Impact:** Any authenticated user can read/modify/delete evaluation data belonging to **any project** by guessing or knowing entity IDs. This is a **tenant isolation violation**.

**Fix:** Revert all `stmt = select(...).filter(...)` back to `stmt = stmt.filter(...)` in the chained filter lines.

---

## CRITICAL — `close_run` / `close_runs` No Longer Close

**Severity: CRITICAL**
**File:** `api/oss/src/dbs/postgres/evaluations/dao.py:495, 540`

The line `run_dbe.flags["is_closed"] = True` is **commented out** in both `close_run()` and `close_runs()`. The `flag_modified(run_dbe, "flags")` call still runs, but no actual mutation happens.

```python
# run_dbe.flags["is_closed"] = True  # type: ignore   <-- COMMENTED OUT
flag_modified(run_dbe, "flags")   # <-- no-op without the mutation
```

**Impact:** The `close_run` / `close_runs` endpoints and the `is_closed` enforcement in `edit_run` become dead code. Runs can never be closed, which breaks the immutability guarantee the system relies on.

**Fix:** Uncomment the line or replace with the intended behavior.

---

## HIGH — `meta` Containment Queries on JSON (Not JSONB) Column

**Severity: HIGH**
**File:** `api/oss/src/dbs/postgres/evaluations/dao.py` — lines 693, 1248, 1768, 2223, 2697

The diff **uncomments** `meta.contains(...)` filters that were previously disabled with the note:

```python
# meta is JSON (not JSONB) — containment (@>) is not supported
```

If `meta` is indeed stored as `JSON` (not `JSONB`), PostgreSQL will raise a runtime error on `@>` containment queries. The original author explicitly disabled this for a reason.

**Impact:** Any query with a `meta` filter will throw a 500 error at the DB level.

**Fix:** Verify column type. If `JSON`, re-disable. If `JSONB`, the uncomment is correct.

---

## HIGH — `_make_evaluation_run_flags` Coerces `None` to `False`

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

When used for **query construction** via `_make_evaluation_run_query`, this means:
- Passing `is_adhoc=None` (meaning "don't filter") becomes `is_adhoc=False` (meaning "filter for non-adhoc").
- The JSONB containment query `flags @> {"is_adhoc": false, "has_queries": false, ...}` will match only runs where ALL these flags are explicitly `false`.

The same method is used for both **creating** run flags (where defaults to `False` make sense) and **querying** (where `None` should mean "don't include in filter"). These two use cases need different semantics.

**Impact:** `SimpleQueuesService.query()` and `SimpleEvaluationsService.query()` silently exclude runs that don't match the zero-default flag pattern. For example, querying for `is_adhoc=True` runs will also require `is_closed=False`, `is_live=False`, etc. — filtering out closed or live adhoc runs unintentionally.

**Fix:** Use `EvaluationRunQueryFlags` (with `Optional` fields and `exclude_none=True` serialization) for query construction instead of `EvaluationRunFlags`. The `_make_evaluation_run_query` should build `EvaluationRunQueryFlags` directly.

---

## MEDIUM — Stale Queue Response After `add_traces` / `add_testcases`

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/service.py:3193-3207, 3236-3250`

Both `add_traces` and `add_testcases` in `SimpleQueuesService`:
1. Fetch the queue and run **before** dispatching the worker task
2. Dispatch `evaluate_batch_traces.kiq()` (async worker task)
3. Return the **pre-dispatch** queue/run state

```python
ok = await self.simple_evaluations_service.evaluate_batch_traces(...)
if not ok:
    return None
return self._parse_queue(queue=queue, run=run)  # <-- stale data
```

The worker task creates new scenarios, results, and potentially updates the run status asynchronously. The response will always show the state **before** any items were added.

**Impact:** Callers see outdated item counts and status after adding items. Not a data corruption issue, but misleading.

**Recommendation:** Either re-fetch after dispatch, or document that the response is the pre-dispatch snapshot and callers should poll for updated state.

---

## MEDIUM — No Queue Update When Adding Items

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/tasks/legacy.py:2183-2207`

In `_evaluate_batch_items`, after creating new scenarios, the code checks for an existing queue and creates one if missing. But it **never updates** an existing queue's `scenario_ids` or `data` to include the new scenarios:

```python
existing_queues = await evaluations_service.query_queues(...)
has_run_queue = any(queue.run_id == run_id for queue in existing_queues)
if not has_run_queue:
    await evaluations_service.create_queue(...)  # only creates if no queue exists
# <-- missing: update existing queue's scenario_ids with new scenarios
```

**Impact:** After calling `add_traces`/`add_testcases` on an existing queue, the queue's `data.scenario_ids` is stale. The `query_scenarios` method uses `filter_scenario_ids()` which relies on the queue's scenario list. New items may not appear in the user's assigned scenario set.

**Fix:** After creating new scenarios, append them to the existing queue's `data.scenario_ids` via `edit_queue`.

---

## MEDIUM — `_normalize_assignments` Type Ambiguity

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/service.py:3571-3589`

```python
def _normalize_assignments(self, *, assignments: Optional[List[List[UUID]] | List[UUID]]):
    first_item = assignments[0]
    if isinstance(first_item, list):
        return [...]  # treat as List[List[UUID]]
    return [[UUID(str(user_id)) for user_id in assignments]]  # treat as List[UUID]
```

The Union type `List[List[UUID]] | List[UUID]` is ambiguous at runtime when receiving JSON input via Pydantic. A list like `["uuid1", "uuid2"]` could be deserialized as `List[UUID]` (flat assignments) or could be the first element of `List[List[UUID]]`. Pydantic v2 will try the first matching type in a Union, which may not match user intent.

**Recommendation:** Use a discriminated field or explicit `repeats` parameter instead of type introspection.

---

## MEDIUM — `fetch_trace` Retry Loop Is Expensive

**Severity: MEDIUM**
**File:** `api/oss/src/core/evaluations/utils.py:139-163`

```python
async def fetch_trace(tracing_router, request, trace_id, max_retries=15, delay=1.0):
    for attempt in range(max_retries):
        try:
            response = await tracing_router.fetch_trace(...)
            if response and response.traces:
                return next(iter(response.traces.values()), None)
        except Exception:
            pass
        if attempt < max_retries - 1:
            await sleep(delay)
    return None
```

This is called **per-scenario** in `_evaluate_batch_items` for trace-based queues. With 15 retries x 1s delay x N traces, a batch of 100 traces with intermittent failures could block the worker for **25+ minutes**. The broad `except Exception: pass` silently swallows all errors including programming bugs.

**Recommendation:** Add exponential backoff, reduce max retries, and log the exception at `WARNING` level.

---

## MEDIUM — Route Cleanup Removes Non-Preview Endpoints

**Severity: MEDIUM (breaking change)**
**File:** `api/entrypoints/routers.py`

The diff removes many non-`/preview/` route mounts:

```
REMOVED: /evaluations, /invocations, /annotations, /testcases, /testsets,
         /simple/testsets, /queries, /simple/queries, /applications,
         /simple/applications, /workflows, /evaluators, /simple/evaluators,
         /ai/services, /preview/tools
```

This also removes the **Tools router** (`/preview/tools/`) and **AI Services router** (`/ai/services/`) entirely, along with their services and DAOs.

**Impact:** Any SDK client, integration, or internal service calling the non-`/preview/` endpoint paths will break with 404. The evaluations router is re-mounted under a different legacy router import.

**Recommendation:** Verify that all clients have been migrated to `/preview/` paths before merging. Ensure the Tools/AI Services removal is intentional and tracked separately.

---

## LOW — `_make_run_data` Always Adds Source Step With Empty References

**Severity: LOW**
**File:** `api/oss/src/core/evaluations/service.py:3358-3367`

```python
source_step = EvaluationRunDataStep(
    key=source_step_key,   # "query-direct" or "testset-direct"
    type="input",
    origin="custom",
    references={},
    inputs=None,
)
```

The source step has empty `references={}`. When `_make_run_flags` processes this, the `is_adhoc` branch infers `has_queries`/`has_testsets` from the step key string:

```python
if flags.is_adhoc and not _references:
    step_key = (_step.key or "").lower()
    if "query" in step_key:
        flags.has_queries = True
```

This relies on the convention that `source_step_key` is `"query-direct"` or `"testset-direct"`. While it works, it's fragile — renaming the key breaks flag computation silently.

**Recommendation:** Set explicit references or flags instead of relying on key-name conventions.

---

## LOW — Queue Query Hardcodes `is_sequential=False`

**Severity: LOW**
**File:** `api/oss/src/core/evaluations/service.py:3128`

```python
queues = await self.evaluations_service.query_queues(
    ...
    queue=EvaluationQueueQuery(
        flags=EvaluationQueueFlags(is_sequential=False),
        ...
    ),
)
```

The query always filters for `is_sequential=False`. This means sequential queues are invisible to the SimpleQueues API, which may be intentional but is not documented.

---

## LOW — Migration `down_revision` Chain

**Severity: LOW**
**Files:** Both migration files

Migration `d7e8f9a0b1c2` declares `down_revision = "c2d3e4f5a6b7"`. This must match an existing migration revision ID. If that revision doesn't exist in the target database, `alembic upgrade head` will fail with a missing ancestor error.

**Recommendation:** Verify `c2d3e4f5a6b7` exists in both OSS and EE migration chains on `main`.

---

## LOW — `str(scenario_id) != scenario_edit_request.scenario.id` Type Mismatch

**Severity: LOW**
**File:** `api/oss/src/apis/fastapi/evaluations/router.py:1140, 1361, 1740, 2127`

The diff changes `str(scenario_id) != str(...)` to `str(scenario_id) != scenario_edit_request.scenario.id`. If `scenario.id` is a `UUID` object, this comparison will always fail because `str(UUID(...))` != `UUID(...)`. If `scenario.id` is already a string, it's fine.

**Recommendation:** Keep consistent comparison: either both `str()` or use direct UUID comparison.

---

## Positive Observations

- **Worker task registration** is well-structured — the `EvaluationsWorker` class cleanly maps all 5 tasks with proper `retry_on_error=False`.
- **`_flatten_queue_user_ids`** is a clean utility with proper deduplication.
- **Validator functions** on `batch_size` and `batch_offset` are defensive and correct (including the `isinstance(v, bool)` guard for Python's `bool` subclass of `int`).
- **`filter_scenario_ids`** logic with sequential/round-robin modes is well-designed and has corresponding unit tests.
- **`_evaluate_batch_items`** correctly handles mixed human/auto evaluator steps, creating pending results for human steps and invoking auto evaluators.
- **Migration data migration** (flattening nested `data.user_ids` into the column) is well-implemented with `CROSS JOIN LATERAL`.
- **GIN index** on `user_ids` array is the correct index type for `@>` and `&&` operations.
- **Design docs** in `docs/design/annotation-queue-v2/` are thorough and well-structured.

---

## Summary of Findings

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 2 | DAO project scope bypass (security); `close_run` commented out |
| HIGH | 2 | `meta` containment on JSON column; flag query coercion |
| MEDIUM | 5 | Stale response; queue not updated on add; type ambiguity; retry loop; route removal |
| LOW | 4 | Fragile key conventions; hardcoded sequential filter; migration chain; type comparison |

**Recommendation:** Fix the two CRITICAL issues before merging. The DAO scope bypass is a tenant isolation vulnerability. The remaining HIGH and MEDIUM issues should be addressed or acknowledged with TODOs.
