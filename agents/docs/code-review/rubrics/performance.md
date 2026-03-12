# rubrics/performance.md – Performance Review

**Domain:** Algorithmic complexity, I/O, database queries, caching, resource use.
**Universal criterion:** Performance (7) — full depth.  See `criteria.md` for the baseline questions that apply in every review.
**Applies to:** Changes on hot paths, data-access layers, batch jobs, or endpoints with latency SLOs.

---

## Goals

- Identify algorithmic or I/O patterns that degrade under realistic load.
- Confirm that resources (connections, memory, goroutines/threads) are bounded and released.
- Verify that caching is used where appropriate and invalidated correctly.

---

## Checklist

### Algorithmic complexity

| # | Criterion | Severity if violated |
|---|---|---|
| P‑1 | Loops do not contain nested I/O or database calls (N+1 pattern) | high |
| P‑2 | Data structures are chosen for the access pattern (O(1) lookup vs O(n) scan) | medium |
| P‑3 | Sorting or searching over large collections uses appropriate algorithms | medium |
| P‑4 | Recursive functions have a bounded depth and a clear base case | medium |
| P‑5 | Large collections are processed in batches or streams, not loaded entirely into memory | high |

### Database and I/O

| # | Criterion | Severity if violated |
|---|---|---|
| P‑6 | Queries select only required columns; `SELECT *` is avoided on large tables | medium |
| P‑7 | Queries on large tables use indexed columns in `WHERE` and `JOIN` clauses | high |
| P‑8 | Bulk inserts/updates use batch operations, not one statement per row | medium |
| P‑9 | Transactions are scoped tightly; long-held locks are avoided | high |
| P‑10 | Database connections are obtained from a pool and released promptly | high |
| P‑11 | Blocking I/O is not performed on an async event loop or in a thread pool without proper offloading | high |

### Caching

| # | Criterion | Severity if violated |
|---|---|---|
| P‑12 | Frequently read, rarely changed data is cached at an appropriate layer | medium |
| P‑13 | Cache entries have TTLs or eviction policies; unbounded cache growth is prevented | medium |
| P‑14 | Cache invalidation is triggered on write; stale data cannot persist beyond acceptable duration | high |
| P‑15 | Cache keys are deterministic and cannot collide across tenants or users | high |

### Resource management

| # | Criterion | Severity if violated |
|---|---|---|
| P‑16 | Files, sockets, and connections are closed in `finally` / `defer` / `using` blocks | high |
| P‑17 | Memory-intensive objects are released promptly; no avoidable object retention | medium |
| P‑18 | Background goroutines/threads/tasks are bounded and have cancellation paths | high |
| P‑19 | Retry logic uses exponential back-off with jitter and a maximum attempt count | medium |

### Observability

| # | Criterion | Severity if violated |
|---|---|---|
| P‑20 | Latency, error rate, and throughput metrics are instrumented on changed code paths | medium |
| P‑21 | Slow-query or slow-request logging is in place and set to an appropriate threshold | low |

---

## Scoring guidance

Benchmark or profile evidence is required for **high** findings on hot paths.  Where profiling is not feasible, document the hypothesis and mark the finding as **medium** pending measurement.
