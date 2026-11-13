# Loadables — Querying Strategies

------------------------------------------------------------------------

## Overview

Two retrieval strategies apply uniformly across both Loadable types.
Each strategy has three sub-options (levels 0, 1, 2), producing six concrete access patterns in total.

**Types:**

- **Testset Revision** — stores an immutable, ordered list of testcase IDs; points to an immutable, ordered list of immutable testcases.
- **Query Revision** — stores immutable query expressions (`formatting`, `filtering`, `windowing`) to evaluate against mutable records. `formatting.focus` selects trace lane (`trace`) or span lane (`span`).

**Strategies:**

- **Strategy A** — the client goes through the revision endpoint, which can return progressively more information: stored content only in [A.0], IDs in [A.1], or full items proxied from the record store in [A.2].
- **Strategy B** — the client calls the record endpoint directly, at a matching level of indirection: by pushing the stored content from [A.0] in [B.0], by supplying IDs obtained from [A.1] in [B.1], or by passing a revision reference and letting the record endpoint dereference it internally in [B.2].

**Refs:** In [A.0] and [B.2], a single ref identifies the revision — `testset_revision_ref | testset_variant_ref | testset_ref` for testsets; `query_revision_ref | query_variant_ref | query_ref` for queries. Resolution follows the same rules in both cases.

The two strategies are symmetric across three levels:

| Level | Strategy A (revision endpoint) | Strategy B (record endpoint) |
|---|---|---|
| 0 — by content | Returns stored content | Receives stored content |
| 1 — by IDs | Returns IDs | Receives IDs |
| 2 — by reference | Revision proxies to records | Record dereferences revision |

------------------------------------------------------------------------

## Defaults And Notes

### Include flag defaults

| Flag | Testset default | Query default |
|---|---|---|
| `include_testcase_ids` / `include_trace_ids` | `True` — IDs returned unless explicitly suppressed | `False` — IDs returned only when requested |
| `include_testcases` / `include_traces` | `True` — full items returned unless explicitly suppressed | `False` — full items returned only when requested |

Consequences:
- `POST /testsets/revisions/retrieve` with no include flags behaves like [A.2].
- `POST /queries/revisions/retrieve` with no include flags behaves like [A.0].

### Caching behavior

- Query revision retrieve caches only when `include_trace_ids=false` and `include_traces=false`.
- Testset revision retrieve caches only when `include_testcase_ids=false` and `include_testcases=false`.

### Permission coupling for trace expansion

- Query revision retrieve that includes traces (`include_trace_ids` or `include_traces`) requires both query-view and trace-view permissions.
- Traces query by query ref (`query_ref` / `query_variant_ref` / `query_revision_ref`) requires both trace-view and query-view permissions.

### Query lane selection from formatting

- `query_revision.data.formatting.focus=trace` uses `/traces/*`.
- `query_revision.data.formatting.focus=span` uses `/spans/*`.
- If `formatting` is missing, default lane is trace (`focus=trace`, `format=agenta`).

------------------------------------------------------------------------

## Strategy A

All sub-options in Strategy A go through a revision endpoint. Each level returns progressively more content.

------------------------------------------------------------------------

### A.0 — Stored content only (no IDs, no items)

The revision endpoint returns only what is structurally stored in the revision, without resolving or enumerating items.

| | Testset Revision | Query Revision |
|---|---|---|
| **Returns** | Revision metadata only; no `testcase_ids`, no `testcases` | Revision metadata + `formatting` + `filtering` + `windowing`; no `trace_ids`, no `traces` |

```
POST /api/testsets/revisions/retrieve { refs }
→ { testset_revision: { id, slug, version, ... } }
```

```
POST /api/queries/revisions/retrieve { refs }
→ { query_revision: { id, slug, version, ..., data: { formatting, filtering, windowing } } }
```

**Use case:** Read the revision's definition before deciding what to do with it. For queries, `formatting`, `filtering`, and `windowing` are available at this level since they are stored in the revision.

------------------------------------------------------------------------

### A.1 — Include IDs (paginated)

The revision endpoint enumerates item IDs. In both cases the caller supplies pagination parameters (`limit`, `next`), but the role of windowing differs between the two types.

| | Testset Revision | Query Revision |
|---|---|---|
| **Source of IDs** | Directly stored in the revision | Computed by executing stored query expressions against the lane selected by `formatting.focus` |
| **Endpoint windowing** | Pagination only (`limit`, `next`) — this is all that applies | Pagination only (`limit`, `next`) — merged into and bounded by the stored `windowing` |
| **Stored windowing** | N/A — ordering is defined by the stored ID list itself | Defines the universe: time bounds, ordering, and any other constraints; the endpoint pagination operates within these bounds |
| **Determinism** | Fully deterministic | Live — depends on trace store state at query time |

```
POST /api/testsets/revisions/retrieve
{ refs, "include_testcase_ids": true, "windowing": { "limit": 500, "next": "<uuid>" } }
→ { testset_revision: { id, ..., data: { testcase_ids } } }
```

```
POST /api/queries/revisions/retrieve
{ refs, "include_trace_ids": true, "windowing": { "limit": 500, "next": "<uuid>" } }
→ { query_revision: { id, ..., data: { formatting, filtering, windowing, trace_ids } } }
```

**Use case:** Enumerate IDs to drive a subsequent batch fetch [B.1], or to cache the ID list for reuse across multiple passes.

------------------------------------------------------------------------

### A.2 — Include data (full items, paginated)

The revision endpoint acts as a proxy to the underlying record store, returning full items directly alongside the revision.

| | Testset Revision | Query Revision |
|---|---|---|
| **Source of items** | Testcase store, looked up by stored IDs | Record store selected by `formatting.focus` and queried via stored expressions |
| **Determinism** | Fully deterministic | Live — depends on trace store state at query time |

```
POST /api/testsets/revisions/retrieve
{ refs, "include_testcases": true, "windowing": { "limit": 50, "next": "<uuid>" } }
→ { testset_revision: { id, ..., data: { testcase_ids, testcases } } }
```

```
POST /api/queries/revisions/retrieve
{ refs, "include_traces": true, "windowing": { "limit": 50, "next": "<uuid>" } }
→ { query_revision: { id, ..., data: { formatting, filtering, windowing, trace_ids, traces } } }
```

**Use case:** Simplest client — a single call returns everything needed. The revision endpoint owns the full resolution, including pagination.

------------------------------------------------------------------------

## Strategy B

Strategy B decouples the revision retrieval from the item fetch. The client calls the record endpoint directly. Three sub-options exist, but not all apply to both Loadable types:

- **B.0** — push stored expressions to record query. Applies to **Query Revisions only**: route to `/api/traces/query` or `/api/spans/query` from `data.formatting.focus`, then push stored expressions.
- **B.1** — fetch by IDs obtained from [A.1]. Applies to both types.
- **B.2** — pass the revision reference to the lane-matching record endpoint and let it dereference internally.

------------------------------------------------------------------------

### B.0 — Push stored expressions to record query (Query Revision only)

Applies only to Query Revisions. The stored `formatting`, `filtering`, and `windowing` expressions retrieved via [A.0] are pushed directly to the lane-matching record endpoint.

```
# Step 1 — get data.formatting + data.filtering + data.windowing from [A.0]
# Step 2 — push to record query endpoint
POST /api/{traces|spans}/query
{ "formatting": { <from query_revision.data.formatting> },
  "filtering": { <from query_revision.data.filtering> },
  "windowing": { <from query_revision.data.windowing, overridable> } }
→ { traces: [...] } | { spans: [...] }
```

| | Query Revision |
|---|---|
| **Applies to** | Query Revision only |
| **Content pushed** | `data.formatting` + `data.filtering` + `data.windowing` — from [A.0] |
| **Total steps** | 2 |
| **Pagination owner** | Record endpoint |

**Use case:** The natural pattern for query revisions — `formatting.focus` picks traces vs spans endpoint, then stored expressions are pushed directly.

------------------------------------------------------------------------

### B.1 — Fetch by IDs (IDs from [A.1])

The client retrieves IDs via [A.1], then calls the record endpoint directly to fetch full items by those IDs. Pagination is controlled by the client by slicing the ID list.

```
# Testcases
# Step 1 — get data.testcase_ids from [A.1]
# Step 2 — fetch from record endpoint by IDs
GET /api/testcases?testcase_ids=<id1>,<id2>,...
→ { testcases: [...] }
```

```
# Query Revision (current contract)
# Step 1 — get data.trace_ids from [A.1]
# Step 2 — fetch from record endpoint by IDs
GET /api/traces?trace_ids=<id1>,<id2>,...
→ { traces: [...] }
```

For `formatting.focus=span`, use [B.0] or [B.2] today. [A.1] does not currently emit `span_ids`.

| | Testset Revision | Query Revision |
|---|---|---|
| **Total steps** | 2 | 2 |
| **Client controls** | Slice size, ordering, parallelism | Slice size, ordering, parallelism |

**Use case:** The client wants full control over batching and can parallelize fetches. Fetch calls are cacheable by item ID.

------------------------------------------------------------------------

### B.2 — Fetch by revision reference (record dereferences internally)

Windowing rules match [A.1] / [A.2]:
- **Testcases**: endpoint windowing is pagination only (`limit`, `next`).
- **Traces**: endpoint windowing is pagination only (`limit`, `next`),
  merged into and bounded by the stored `windowing` of the resolved
  query revision. Stored bounds (time range, ordering, etc.) take
  precedence.

```
# Testcases
POST /api/testcases/query
{ refs, "windowing": { "limit": 50, "next": "<uuid>" } }
→ { testcases: [...] }
```

```
# Traces
POST /api/traces/query
{ refs, "windowing": { "limit": 50, "next": "<uuid>" } }
→ { traces: [...] }
```

| | Testset Revision | Query Revision |
|---|---|---|
| **Internal resolution** | Record endpoint resolves stored IDs | Record endpoint executes stored query expressions in lane selected by `formatting.focus` |
| **Endpoint windowing** | Pagination only (`limit`, `next`) | Pagination only — merged into and bounded by stored `windowing` |
| **Total steps** | 1 (no prior retrieve needed) | 1 |

**Use case:** The client only holds a revision (or variant, or artifact)
reference and wants the record endpoint to own the full resolution.
Equivalent result to [A.2], but the record endpoint drives the logic
rather than the revision endpoint.

------------------------------------------------------------------------

## Summary

|  | **Testset Revision → Testcases** | **Query Revision → Traces** |
|---|---|---|
| **What revision stores** | Immutable, ordered list of testcase IDs | Immutable `formatting` + `filtering` + `windowing` expressions |
| **Points to** | Immutable, ordered list of immutable testcases | Mutable, ordered list of mutable traces |
| **A.0** — by content (revision) | Revision metadata only (no IDs, no items) | Revision metadata + `formatting` + `filtering` + `windowing` (no IDs, no items) |
| **A.1** — by IDs (revision) | Revision with `data.testcase_ids[]` (stored, paginated) | Revision with `data.trace_ids[]` (computed by filter, paginated) |
| **A.2** — by reference (revision proxies) | Revision with `data.testcase_ids[]` + `data.testcases[]` (proxied, paginated) | Revision with `data.trace_ids[]` + `data.traces` (proxied, paginated) |
| **B.0** — by content (record) | N/A — no stored expressions; use [B.1] with IDs or [B.2] with a revision ref | `data.formatting + data.filtering + data.windowing` from [A.0] → lane endpoint (`/api/traces/query` or `/api/spans/query`) |
| **B.1** — by IDs (record) | IDs from [A.1] → `GET /api/testcases?testcase_ids=...` | IDs from [A.1] → `GET /api/traces?trace_ids=...` (current contract; no `span_ids` yet) |
| **B.2** — by reference (record dereferences) | `POST /api/testcases/query { refs }` | Lane endpoint by `formatting.focus` (`POST /api/traces/query { refs }` or `POST /api/spans/query { refs }`) |
