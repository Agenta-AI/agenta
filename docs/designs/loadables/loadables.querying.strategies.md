# Loadables — Querying Strategies

------------------------------------------------------------------------

## Overview

Two retrieval strategies apply uniformly across both Loadable types.
Each strategy has three sub-options (levels 0, 1, 2), producing six concrete access patterns in total.

**Types:**

- **Testset Revision** — stores an immutable, ordered list of testcase IDs; points to an immutable, ordered list of immutable testcases.
- **Query Revision** — stores an immutable set of `filtering` and `windowing` expressions to evaluate against mutable traces; points to a mutable, ordered list of mutable traces.

**Strategies:**

- **Strategy A** — the client goes through the revision endpoint, which can return progressively more information: stored content only in [A.0], IDs in [A.1], or full items proxied from the record store in [A.2].
- **Strategy B** — the client calls the record endpoint directly, at a matching level of indirection: by pushing the stored content from [A.0] in [B.0], by supplying IDs obtained from [A.1] in [B.1], or by passing a revision reference and letting the record endpoint dereference it internally in B.2].

**Refs:** In [A.0] and [B.2], a single ref identifies the revision — `testset_revision_ref | testset_variant_ref | testset_ref` for testsets; `query_revision_ref | query_variant_ref | query_ref` for queries. Resolution follows the same rules in both cases.

The two strategies are symmetric across three levels:

| Level | Strategy A (revision endpoint) | Strategy B (record endpoint) |
|---|---|---|
| 0 — by content | Returns stored content | Receives stored content |
| 1 — by IDs | Returns IDs | Receives IDs |
| 2 — by reference | Revision proxies to records | Record dereferences revision |

------------------------------------------------------------------------

## Strategy A

All sub-options in Strategy A go through a revision endpoint. Each level returns progressively more content.

------------------------------------------------------------------------

### A.0 — Stored content only (no IDs, no items)

The revision endpoint returns only what is structurally stored in the revision, without resolving or enumerating items.

| | Testset Revision | Query Revision |
|---|---|---|
| **Returns** | Revision metadata only; no `testcase_ids`, no `testcases` | Revision metadata + `filtering` + `windowing`; no `trace_ids`, no `traces` |

```
POST /api/preview/testsets/revisions/retrieve { refs }
→ { testset_revision: { id, slug, version, ... } }
```

```
POST /api/preview/queries/revisions/retrieve { refs }
→ { query_revision: { id, slug, version, ..., data: { filtering, windowing } } }
```

**Use case:** Read the revision's definition before deciding what to do with it. For queries, `filtering` and `windowing` are available at this level since they are stored in the revision.

------------------------------------------------------------------------

### A.1 — Include IDs (paginated)

The revision endpoint enumerates item IDs. In both cases the caller supplies pagination parameters (`limit`, `cursor`), but the role of windowing differs between the two types.

| | Testset Revision | Query Revision |
|---|---|---|
| **Source of IDs** | Directly stored in the revision | Computed by executing `filtering` + stored `windowing` against the trace store |
| **Endpoint windowing** | Pagination only (`limit`, `cursor`) — this is all that applies | Pagination only (`limit`, `cursor`) — merged into and bounded by the stored `windowing` |
| **Stored windowing** | N/A — ordering is defined by the stored ID list itself | Defines the universe: time bounds, ordering, and any other constraints; the endpoint pagination operates within these bounds |
| **Determinism** | Fully deterministic | Live — depends on trace store state at query time |

```
POST /api/preview/testsets/revisions/retrieve
{ refs, "include_testcase_ids": true, "windowing": { "limit": 500, "cursor": "<cursor>" } }
→ { testset_revision: { id, ..., data: { testcase_ids } } }
```

```
POST /api/preview/queries/revisions/retrieve
{ refs, "include_trace_ids": true, "windowing": { "limit": 500, "cursor": "<cursor>" } }
→ { query_revision: { id, ..., data: { filtering, windowing, trace_ids } } }
```

**Use case:** Enumerate IDs to drive a subsequent batch fetch [B.1], or to cache the ID list for reuse across multiple passes.

------------------------------------------------------------------------

### A.2 — Include data (full items, paginated)

The revision endpoint acts as a proxy to the underlying record store, returning full items directly alongside the revision.

| | Testset Revision | Query Revision |
|---|---|---|
| **Source of items** | Testcase store, looked up by stored IDs | Trace store, queried via `filtering` + `windowing` |
| **Determinism** | Fully deterministic | Live — depends on trace store state at query time |

```
POST /api/preview/testsets/revisions/retrieve
{ refs, "include_testcases": true, "windowing": { "limit": 50, "cursor": "<cursor>" } }
→ { testset_revision: { id, ..., data: { testcase_ids, testcases } } }
```

```
POST /api/preview/queries/revisions/retrieve
{ refs, "include_traces": true, "windowing": { "limit": 50, "cursor": "<cursor>" } }
→ { query_revision: { id, ..., data: { filtering, windowing, trace_ids, traces } } }
```

**Use case:** Simplest client — a single call returns everything needed. The revision endpoint owns the full resolution, including pagination.

------------------------------------------------------------------------

## Strategy B

Strategy B decouples the revision retrieval from the item fetch. The client calls the record endpoint directly. Three sub-options exist, but not all apply to both Loadable types:

- **B.0** — push stored expressions to record query. Applies to **Query Revisions only**: the stored `filtering` + `windowing` are the direct input to `POST /traces/query`. Testset Revisions have no stored expressions; their content is an ID list — use [B.1] — or a revision reference — use [B.2].
- **B.1** — fetch by IDs obtained from [A.1]. Applies to both types.
- **B.2** — pass the revision reference to the record endpoint and let it dereference internally. Applies to both types.

------------------------------------------------------------------------

### B.0 — Push stored expressions to record query (Query Revision only)

Applies only to Query Revisions. The stored `filtering` and `windowing` expressions retrieved via [A.0] are pushed directly to the record endpoint.

```
# Step 1 — get data.filtering + data.windowing from [A.0]
# Step 2 — push to record query endpoint
POST /api/preview/traces/query
{ "filtering": { <from query_revision.data.filtering> },
  "windowing": { <from query_revision.data.windowing, overridable> } }
→ { traces: [...] }
```

| | Query Revision |
|---|---|
| **Applies to** | Query Revision only |
| **Content pushed** | `data.filtering` + `data.windowing` — from [A.0] |
| **Total steps** | 2 |
| **Pagination owner** | Record endpoint |

**Use case:** The natural pattern for query revisions — the stored filter expressions are the direct input to `POST /traces/query`.

------------------------------------------------------------------------

### B.1 — Fetch by IDs (IDs from [A.1])

The client retrieves IDs via [A.1], then calls the record endpoint directly to fetch full items by those IDs. Pagination is controlled by the client by slicing the ID list.

```
# Testcases
# Step 1 — get data.testcase_ids from [A.1]
# Step 2 — fetch from record endpoint by IDs
GET /api/preview/testcases?testcase_ids=<id1>,<id2>,...
→ { testcases: [...] }
```

```
# Traces
# Step 1 — get data.trace_ids from [A.1]
# Step 2 — fetch from record endpoint by IDs
GET /api/preview/traces?trace_ids=<id1>,<id2>,...
→ { traces: [...] }
```

| | Testset Revision | Query Revision |
|---|---|---|
| **Total steps** | 2 | 2 |
| **Client controls** | Slice size, ordering, parallelism | Slice size, ordering, parallelism |

**Use case:** The client wants full control over batching and can parallelize fetches. Fetch calls are cacheable by item ID.

------------------------------------------------------------------------

### B.2 — Fetch by revision reference (record dereferences internally)

Windowing rules match [A.1] / [A.2]:
- **Testcases**: endpoint windowing is pagination only (`limit`, `cursor`).
- **Traces**: endpoint windowing is pagination only (`limit`, `cursor`),
  merged into and bounded by the stored `windowing` of the resolved
  query revision. Stored bounds (time range, ordering, etc.) take
  precedence.

```
# Testcases
POST /api/preview/testcases/query
{ refs, "windowing": { "limit": 50, "cursor": "<cursor>" } }
→ { testcases: [...] }
```

```
# Traces
POST /api/preview/traces/query
{ refs, "windowing": { "limit": 50, "cursor": "<cursor>" } }
→ { traces: [...] }
```

| | Testset Revision | Query Revision |
|---|---|---|
| **Internal resolution** | Record endpoint resolves stored IDs | Record endpoint executes stored filter |
| **Endpoint windowing** | Pagination only (`limit`, `cursor`) | Pagination only — merged into and bounded by stored `windowing` |
| **Total steps** | 1 (no prior retrieve needed) | 1 |

**Use case:** The client only holds a revision (or variant, or artifact)
reference and wants the record endpoint to own the full resolution.
Equivalent result to [A.2], but the record endpoint drives the logic
rather than the revision endpoint.

------------------------------------------------------------------------

## Summary

|  | **Testset Revision → Testcases** | **Query Revision → Traces** |
|---|---|---|
| **What revision stores** | Immutable, ordered list of testcase IDs | Immutable `filtering` + `windowing` expressions |
| **Points to** | Immutable, ordered list of immutable testcases | Mutable, ordered list of mutable traces |
| **A.0** — by content (revision) | Revision metadata only (no IDs, no items) | Revision metadata + `filtering` + `windowing` (no IDs, no items) |
| **A.1** — by IDs (revision) | Revision with `data.testcase_ids[]` (stored, paginated) | Revision with `data.trace_ids[]` (computed by filter, paginated) |
| **A.2** — by reference (revision proxies) | Revision with `data.testcase_ids[]` + `data.testcases[]` (proxied, paginated) | Revision with `data.trace_ids[]` + `data.traces[]` (proxied, paginated) |
| **B.0** — by content (record) | N/A — no stored expressions; use [B.1] with IDs or [B.2] with a revision ref | `data.filtering + data.windowing` from [A.0] → `POST /traces/query { filtering, windowing }` |
| **B.1** — by IDs (record) | IDs from [A.1] → `GET /testcases?testcase_ids=...` | IDs from [A.1] → `GET /traces?trace_ids=...` |
| **B.2** — by reference (record dereferences) | `POST /testcases/query { refs }` | `POST /traces/query { refs }` |
