# Loadables — Querying Strategies: Gap Analysis

------------------------------------------------------------------------

## Overview

This document maps each of the six loadable querying strategies onto the
current API implementation, identifies what is missing, and lists the
concrete changes required per component before every strategy is
testable end to end.

Reference: [loadables.querying.strategies.md](loadables.querying.strategies.md)

------------------------------------------------------------------------

## Flag defaults

The `include_*` flags have asymmetric defaults that reflect each type's common use case:

| Flag | Testset default | Query default |
|---|---|---|
| `include_testcase_ids` / `include_trace_ids` | `True` — IDs returned unless suppressed | `False` — IDs only if explicitly requested |
| `include_testcases` / `include_traces` | `True` — items returned unless suppressed | `False` — items only if explicitly requested |

Consequence: calling the testset retrieve endpoint with no flags returns full items ([A.2] behaviour); calling the query retrieve endpoint with no flags returns stored expressions only ([A.0] behaviour).

## Status Summary

| Strategy | Testset Revision → Testcases | Query Revision → Traces |
|---|---|---|
| **[A.0]** stored content | ❌ Requires `include_testcase_ids: false, include_testcases: false`; `include_testcase_ids` flag does not exist yet | ✅ Default behaviour (no flags) |
| **[A.1]** IDs | ❌ No `include_testcase_ids` flag; no `windowing` | ❌ No `include_trace_ids` flag; no `windowing`; no service logic |
| **[A.2]** full items | ⚠️ Default returns testcases but clears `testcase_ids`; no `windowing` | ❌ No `include_traces` flag; no `windowing`; no service logic |
| **[B.0]** push stored expressions | N/A | ✅ `POST /preview/traces/query` accepts `filtering` + `windowing` directly |
| **[B.1]** fetch by IDs | ✅ `GET /preview/testcases?testcase_ids=...` | ✅ `GET /preview/traces?trace_ids=...` |
| **[B.2]** fetch by revision ref | ❌ Only accepts flat `testset_revision_id` (UUID), not full ref objects | ❌ Not supported |

------------------------------------------------------------------------

## Gap Detail

### [A.0] — Testset Revision: cannot opt out of IDs and items

**Expected:** Caller passes `include_testcase_ids: false, include_testcases: false`
and receives revision metadata only — no `testcase_ids`, no `testcases`.

**Actual:** `include_testcase_ids` does not exist in `TestsetRevisionRetrieveRequest`,
so the opt-out cannot be expressed. `include_testcases: false` suppresses testcases
but still returns `testcase_ids` — that is [A.1], not [A.0].

**Missing:** `include_testcase_ids: Optional[bool]` field (also needed for [A.1]).

---

### [A.1] — Testset Revision: no `include_testcase_ids` flag

**Expected:** Caller passes `include_testcase_ids: true, include_testcases: false`
+ `windowing` and receives `data.testcase_ids[]` (paginated); `testcases` is absent.

**Note:** `include_testcases: false` already suppresses testcases and returns IDs
(partial A.1 without windowing). The `include_testcase_ids` flag is still needed
for symmetry, for [A.0] (opt out of IDs too), and to pair with `windowing`.

**Missing:**
- `include_testcase_ids: Optional[bool]` field in `TestsetRevisionRetrieveRequest`
- `windowing: Optional[Windowing]` field in `TestsetRevisionRetrieveRequest`
- Service logic to apply windowing when returning IDs

---

### [A.1] — Query Revision: no `include_trace_ids` flag

**Expected:** Caller passes `include_trace_ids: true` + `windowing` and
receives `data.trace_ids[]` (computed by executing the stored filter against
the trace store); `traces` is absent.

**Missing:**
- `include_trace_ids: Optional[bool]` field in `QueryRevisionRetrieveRequest`
- `windowing: Optional[Windowing]` field in `QueryRevisionRetrieveRequest`
- Service logic in `QueriesService` (or a collaborating tracing service) to
  execute `data.filtering + data.windowing` and return matching trace IDs

---

### [A.2] — Testset Revision: clears `testcase_ids` when returning testcases

**Expected:** Default (no flags, both default to `true`) or explicit
`include_testcase_ids: true, include_testcases: true` + `windowing` returns
both `data.testcase_ids[]` and `data.testcases[]`.

**Actual:** `_populate_testcases` explicitly sets `testcase_ids = None` after
fetching testcases:
```python
testset_revision.data.testcase_ids = None  # cleared — wrong
```

**Missing:**
- Remove the line that clears `testcase_ids`
- `windowing: Optional[Windowing]` field in `TestsetRevisionRetrieveRequest`
- Service logic to apply windowing when paginating through testcases

---

### [A.2] — Query Revision: no `include_traces` flag

**Expected:** Caller passes `include_traces: true` + `windowing` and receives
both `data.trace_ids[]` and `data.traces[]`.

**Missing:**
- `include_traces: Optional[bool]` field in `QueryRevisionRetrieveRequest`
- `windowing: Optional[Windowing]` field in `QueryRevisionRetrieveRequest`
- Service logic to execute the stored filter and return trace IDs + traces

---

### [B.0] — Query Revision: already supported

`POST /preview/traces/query { filtering, windowing }` already accepts filter
expressions and windowing directly. No changes needed.

---

### [B.1] — Testcases: already supported

`GET /preview/testcases?testcase_ids=<id1>,<id2>,...` already exists.
No changes needed.

---

### [B.1] — Traces: already supported

`GET /preview/traces?trace_ids=<id1>,<id2>,...` already exists.
No changes needed.

---

### [B.2] — Testcases: only flat UUID, no full ref objects

**Expected:** `POST /preview/testcases/query { testset_revision_ref | testset_variant_ref | testset_ref, windowing }`
lets the record endpoint dereference the revision internally, then return testcases.

**Actual:** `TestcasesQueryRequest` only has `testset_revision_id: Optional[UUID]`.
This partially covers a narrow sub-case of [B.2] (revision by ID only) but is
not the full ref-based pattern.

**Missing:**
- `testset_revision_ref: Optional[Reference]` in `TestcasesQueryRequest`
- `testset_variant_ref: Optional[Reference]` in `TestcasesQueryRequest`
- `testset_ref: Optional[Reference]` in `TestcasesQueryRequest`
- Service / router logic to call `fetch_testset_revision(ref)`, extract
  `testcase_ids`, then fetch testcases — same resolution path as [B.2] implies

---

### [B.2] — Traces: no revision ref support

**Expected:** `POST /preview/traces/query { query_revision_ref | query_variant_ref | query_ref, windowing }`
resolves the query revision, executes its stored filter (merged with request
windowing), and returns traces.

**Actual:** `POST /preview/traces/query` (TracingRouter.query_spans) accepts
`TracingQuery` (filtering + windowing + formatting) but has no concept of
revision references.

**Missing:**
- `query_revision_ref: Optional[Reference]` in the traces query request (or
  merged via a parallel request model)
- `query_variant_ref: Optional[Reference]`
- `query_ref: Optional[Reference]`
- Logic (in router or service) to resolve the ref → fetch query revision →
  extract `data.filtering + data.windowing` → merge with request windowing
  (stored bounds take precedence) → execute query

------------------------------------------------------------------------

## Required Changes

### 1. `TestsetRevisionRetrieveRequest` — `testsets/models.py`

```python
# Add
include_testcase_ids: Optional[bool] = None   # [A.1]
windowing: Optional[Windowing] = None          # [A.1] + [A.2]
```

The existing `include_testcases: Optional[bool]` field already covers [A.2]
but its semantics need updating (see item 2 below).

---

### 2. `TestsetsService._populate_testcases` — `core/testsets/service.py`

Defaults: both `include_testcase_ids` and `include_testcases` are `True` when
`None` (i.e. the caller gets everything unless they explicitly opt out).

Three behavioral changes:

a. **[A.0]:** When `include_testcase_ids=False` AND `include_testcases=False`,
   clear both from `data` — return revision metadata only.

b. **[A.1]:** When `include_testcase_ids=True` (default) AND `include_testcases=False`,
   return `data.testcase_ids` with windowing applied; do not fetch testcases.

c. **[A.2] fix:** When both are `True` (default or explicit), return both
   `data.testcase_ids` and `data.testcases` (remove the line that clears
   `testcase_ids`); apply windowing when paginating.

---

### 3. `QueryRevisionRetrieveRequest` — `queries/models.py`

```python
# Add
include_trace_ids: Optional[bool] = None   # [A.1]
include_traces: Optional[bool] = None      # [A.2]
windowing: Optional[Windowing] = None      # [A.1] + [A.2]
```

---

### 4. `QueriesService` — `core/queries/service.py`

Add a method (or extend `fetch_query_revision`) to populate traces:

- **[A.1]:** When `include_trace_ids=True`, call the tracing service with
  `data.filtering + data.windowing` (merged with request windowing, stored
  bounds take precedence), return only trace IDs.
- **[A.2]:** When `include_traces=True`, same call, return both trace IDs and
  full trace objects.

Requires injecting a tracing service dependency into `QueriesService`.

---

### 5. Queries router handler — `apis/fastapi/queries/router.py`

Pass the new flags and windowing through to the service:

```python
query_revision = await self.queries_service.fetch_query_revision(
    ...,
    include_trace_ids=query_revision_retrieve_request.include_trace_ids,
    include_traces=query_revision_retrieve_request.include_traces,
    windowing=query_revision_retrieve_request.windowing,
)
```

---

### 6. `TestcasesQueryRequest` — `testcases/models.py`

```python
# Add (alongside existing testset_revision_id for backward compat)
testset_revision_ref: Optional[Reference] = None   # [B.2]
testset_variant_ref: Optional[Reference] = None    # [B.2]
testset_ref: Optional[Reference] = None            # [B.2]
```

---

### 7. Testcases router / service — `testcases/router.py` and/or `testsets/service.py`

When any of the new ref fields is present in `TestcasesQueryRequest`:
1. Resolve the revision via `TestsetsService.fetch_testset_revision(ref)`.
2. Extract `testcase_ids` from the resolved revision.
3. Fetch and return testcases by those IDs, with windowing.

This mirrors the existing `testset_revision_id` logic but accepts full ref
objects instead of a flat UUID.

---

### 8. Traces query request — `tracing/models.py` or `tracing/router.py`

Add revision ref fields to the model parsed by `POST /preview/traces/query`:

```python
query_revision_ref: Optional[Reference] = None   # [B.2]
query_variant_ref: Optional[Reference] = None    # [B.2]
query_ref: Optional[Reference] = None            # [B.2]
```

---

### 9. Tracing router / service — `tracing/router.py` and/or `core/tracing/service.py`

When any of the new ref fields is present:
1. Resolve the query revision via `QueriesService.fetch_query_revision(ref)`.
2. Extract `data.filtering + data.windowing`.
3. Merge with any request-level windowing (stored bounds take precedence).
4. Execute the trace query with the merged parameters.

Requires injecting a queries service dependency into the tracing router or
service.

------------------------------------------------------------------------

## Dependency Injection Notes

Two new cross-domain dependencies are introduced:

| From | To | Required for |
|---|---|---|
| `QueriesService` | `TracingService` | [A.1], [A.2] queries |
| `TracingRouter` / `TracingService` | `QueriesService` | [B.2] traces |
| `TestcasesRouter` | `TestsetsService` | [B.2] testcases (already partially present via `testset_revision_id` path) |

Wiring should happen in `api/entrypoints/routers.py` per the existing pattern.

------------------------------------------------------------------------

## Implementation Order

Recommended sequence (each step is independently testable):

1. **[A.0] testset fix** — change `_populate_testcases` default behavior
2. **[A.1] testset** — add `include_testcase_ids` + `windowing` to request; service
3. **[A.2] testset** — stop clearing `testcase_ids`; add windowing
4. **[B.2] testcases** — add ref fields to `TestcasesQueryRequest`; service logic
5. **[A.1] query** — add `include_trace_ids` + `windowing`; inject tracing service
6. **[A.2] query** — add `include_traces`; reuse tracing service call
7. **[B.2] traces** — add ref fields to traces query; inject queries service
