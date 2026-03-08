# rubrics/services.md – Service Runtime Review

**Domain:** Service lifecycle, resilience, inter-service communication, data consistency, deployment semantics.
**Universal criteria:** All 10 criteria applied in the backend service context; Security (6), Performance (7), Architecture (8), Testability (9), Observability (10) at baseline.  See `criteria.md`.
**Applies to:** Backend services, microservices, message consumers, background workers, and scheduled jobs.

> **Scope note:** This rubric focuses on how the service *behaves at runtime* — under load, during failures, across deploys.  API contract design is covered by `api.md`; infrastructure and deployment pipeline concerns belong in `architecture.md`; this rubric covers the seam between them.

---

## Goals

- Confirm that the service starts, runs, and shuts down correctly under all conditions.
- Verify that communication with other services is resilient and does not cascade failures.
- Ensure data consistency guarantees are appropriate for the operation's semantics.
- Confirm that the service can be deployed, scaled, and rolled back safely.

---

## Checklist

### Lifecycle

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑1 | The service performs a graceful shutdown: it stops accepting new requests, drains in-flight work, and closes connections before exiting | high |
| SV‑2 | Startup does not fail silently; missing required configuration causes an immediate, descriptive error at boot | high |
| SV‑3 | The service is ready to serve traffic only after all dependencies (DB, cache, message broker) are reachable; readiness probes reflect this | high |
| SV‑4 | Liveness probes detect actual stuck states (deadlock, OOM loop), not just process existence | medium |
| SV‑5 | Long-running initialisation (schema migrations, cache warm-up) is separated from the serving path so the service can start without blocking traffic | medium |

### Resilience and fault tolerance

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑6 | All calls to downstream services have a timeout; no call can block indefinitely | high |
| SV‑7 | Retry logic uses exponential back-off with jitter; retries are bounded by a maximum attempt count | high |
| SV‑8 | A circuit breaker or bulkhead pattern prevents a slow dependency from exhausting the service's own resources | high |
| SV‑9 | The service degrades gracefully when non-critical dependencies are unavailable; it does not fail completely for a partial outage | medium |
| SV‑10 | Errors from downstream services are classified: retriable (5xx, timeout) vs. non-retriable (4xx, schema error); only retriable errors trigger retries | medium |

### Inter-service communication

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑11 | Synchronous calls are limited to operations that must be consistent within the same request; asynchronous messaging is used for work that can be decoupled | medium |
| SV‑12 | Messages published to a broker are idempotent: reprocessing the same message twice produces the same result | high |
| SV‑13 | The consumer acknowledges a message only after successfully processing it; no silent discard of unprocessable messages | high |
| SV‑14 | Dead-letter queues or equivalent are configured for messages that repeatedly fail processing | high |
| SV‑15 | Event schemas are versioned; the consumer handles both old and new schema versions during a rolling deploy | high |

### Data consistency

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑16 | Operations that must be atomic are wrapped in a database transaction; partial writes cannot leave the system in an inconsistent state | high |
| SV‑17 | Distributed operations that span services use an explicit consistency strategy (saga, outbox pattern, two-phase commit) and the trade-offs are documented | high |
| SV‑18 | The outbox pattern or equivalent is used when a database write and a message publish must succeed together | high |
| SV‑19 | Eventual consistency windows are bounded and documented; consumers know the maximum lag they should expect | medium |

### Concurrency

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑20 | Shared mutable state is protected by appropriate synchronisation (mutex, atomic, channel); no data races | high |
| SV‑21 | Worker pools, goroutine counts, and thread pool sizes are bounded; the service cannot exhaust OS resources under sustained load | high |
| SV‑22 | Database queries that must not run concurrently use pessimistic or optimistic locking as appropriate | high |

### Deployment safety

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑23 | The new version is backward-compatible with the running version during a rolling deploy (database schema, API contract, message format) | high |
| SV‑24 | The change can be rolled back by reverting the image tag alone; no rollback requires a manual data migration | high |
| SV‑25 | Feature flags or progressive rollout is used for high-risk behavioural changes, enabling instant rollback without a redeploy | medium |

### Observability (full depth for services)

| # | Criterion | Severity if violated |
|---|---|---|
| SV‑26 | Request latency, error rate, and throughput are instrumented and emitted as metrics for every inbound and outbound call | high |
| SV‑27 | Distributed trace context is propagated through all service boundaries, including async message boundaries | high |
| SV‑28 | Each log line includes a correlation ID that links it to the originating request or job | medium |
| SV‑29 | Alert thresholds exist for error rate, latency, and queue depth; they are set to actionable levels (not 100% error rate) | medium |

---

## Scoring guidance

Lifecycle failures (SV‑1 to SV‑4) are **high** because they cause outages during normal deploys.  Idempotency and dead-letter failures (SV‑12 to SV‑14) are **high** because they produce data loss or duplicate side effects silently.  Distributed consistency failures (SV‑16 to SV‑18) are **high** because they are the hardest class of bug to detect and recover from.

Concurrency violations (SV‑20 to SV‑22) are **high** — they are non-deterministic and may be invisible in normal load testing.

Resilience gaps (SV‑6 to SV‑10) that depend on the dependency's reliability SLA may be downgraded to **medium** if the dependency is internal and highly available — but this must be documented explicitly.
