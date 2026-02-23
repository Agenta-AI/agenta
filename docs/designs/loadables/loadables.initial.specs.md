# Loadables Specification

**Generated on:** 2026-02-22T10:52:13.897106 UTC

------------------------------------------------------------------------

# 1. Overview

In the system, we distinguish between two major categories of entities:

-   **Runnables (Workflows)** --- entities that can be inspected and
    invoked, producing outputs and traces.
-   **Loadables** --- entities that produce collections of fundamental
    data items (e.g., test cases or traces).

This document formalizes the concept of **Loadables**, including
behavior, API semantics, windowing strategies, trade-offs, and
architectural decisions.

------------------------------------------------------------------------

# 2. Definition of a Loadable

A **Loadable** is a Git-based, revision-controlled entity whose purpose
is to produce a collection of items.

Each Loadable is uniquely identified by:

-   `artifact`
-   `variant`
-   `revision`

A Loadable revision is immutable and reproducible.

Loadables do NOT compute new outputs like workflows. Instead, they
enumerate existing data.

------------------------------------------------------------------------

# 3. Types of Loadables

## 3.1 Test Set (Revision)

### Stored Content

-   Ordered list of test cases.

### Fundamental Data

-   Test cases.

### Identity Model

-   Test case ID = hash(test_case_content + test_set_identity)
-   Same content within the same artifact → same ID.
-   Optional dedup salt can modify hash.

### Characteristics

-   Deterministic.
-   Ordered collection.
-   Fully reproducible from revision.

------------------------------------------------------------------------

## 3.2 Query (Revision)

### Stored Content

-   Filters defining which traces match.

### Fundamental Data

-   Traces (any type of trace).

### Characteristics

-   May depend on underlying database state.
-   Supports time windowing.
-   Potentially non-deterministic unless snapshot/as_of semantics are
    used.

------------------------------------------------------------------------

# 4. Core Operations of Loadables

All Loadables support the following fundamental operations.

## 4.1 Windowed Enumeration

Given a Loadable revision, clients can request:

-   The next N items
-   A specific window (time-based, token-based, offset-based)

This supports pagination.

Windowing may apply to:

-   Ordered lists (test sets)
-   Query result sets (traces)

------------------------------------------------------------------------

## 4.2 ID Enumeration

Instead of returning full items, the Loadable can return:

-   Item IDs only (paginated)
-   All IDs

This enables a two-step retrieval strategy.

------------------------------------------------------------------------

## 4.3 Fetch by IDs

Given a list of item IDs:

-   Fetch full items in batches.
-   Supports client-side pagination.

This operation exists independently of the Loadable and is shared across
the system.

------------------------------------------------------------------------

# 5. Two Retrieval Strategies

## Strategy A: Direct Materialization

Loadable → windowed full items

Example:

    GET /queries/{revision}/traces?next=<token>&limit=50

Advantages: - Simpler client logic. - Fewer round-trips.

Trade-offs: - Larger payload sizes. - Less flexible batching control.

------------------------------------------------------------------------

## Strategy B: Two-Step via IDs

Step 1:

    GET /queries/{revision}/trace-ids?next=<token>&limit=50

Step 2:

    POST /traces/batch
    [trace_ids]

Advantages: - Better batching control. - Cacheable ID lists. - Reusable
fetch-by-ID endpoint. - Supports client-side reordering or parallel
fetch.

Trade-offs: - More round-trips. - Slightly more complex client logic.

------------------------------------------------------------------------

# 6. Windowing Models

Loadables support multiple windowing strategies:

-   Cursor-based pagination
-   Offset-based pagination
-   Time-based windows (e.g., start/end timestamps)

Test Sets: - Natural ordering defined. - Deterministic pagination.

Queries: - May require stable sorting guarantees. - May require snapshot
or as_of parameter for determinism.

------------------------------------------------------------------------

# 7. Determinism & Reproducibility

## Test Sets

Fully deterministic:

    (test_set_revision, window parameters) → stable results

## Queries

May require additional parameters:

-   `as_of`
-   snapshot identifier
-   frozen materialization

Without these, live queries may vary over time.

Trade-off: - Live queries reflect current state. - Snapshots provide
reproducibility.

------------------------------------------------------------------------

# 8. Identity & Deduplication

### Test Cases

-   Content-addressed hash.
-   Stable within artifact.

### Traces

-   Identified by trace_id (+ project scope).
-   Naturally unique.

Set arithmetic (diffing, caching, tensor construction) relies on item
identity.

------------------------------------------------------------------------

# 9. Architectural Decisions

1.  Loadables are revision-scoped.
2.  Windowing is supported at the Loadable level.
3.  IDs can be retrieved separately from full items.
4.  Fetch-by-ID is universal and reusable.
5.  Loadables are first-class entities parallel to workflows.

------------------------------------------------------------------------

# 10. Trade-offs Summary

  Aspect               Direct Materialization   ID-Based Strategy
  -------------------- ------------------------ -------------------
  Simplicity           High                     Medium
  Network efficiency   Medium                   High
  Client flexibility   Low                      High
  Caching              Harder                   Easier
  Parallelism          Limited                  High

------------------------------------------------------------------------

# 11. Unified Mental Model

Loadable Revision =

-   A deterministic definition of a collection
-   With windowing support
-   Supporting either direct enumeration or ID-based enumeration
-   Backed by revision control (artifact/variant/revision)

------------------------------------------------------------------------

# 12. Relationship to Workflows

Workflows: - Inspect → Invoke → Produce output + trace

Loadables: - Enumerate → Produce collection of items

Both are revision-controlled. Only workflows execute computation.

------------------------------------------------------------------------

# 13. Example End-to-End Flow

Evaluation system example:

1.  Select Loadable (Test Set or Query revision).
2.  Enumerate item IDs.
3.  Fetch items in batches.
4.  For each item → invoke workflow.
5.  Store produced traces.

This flow is identical regardless of Loadable type.

------------------------------------------------------------------------

# 14. Conclusion

Loadables abstract the concept of a revision-controlled collection of
fundamental data items.

They unify: - Test sets (ordered, deterministic datasets) - Queries
(filter-based trace sets)

They support: - Inspection - Windowed enumeration - ID-based retrieval -
Deterministic or live semantics

This provides a consistent foundation for evaluation systems, batching,
caching, and large-scale trace-driven computation.

------------------------------------------------------------------------
