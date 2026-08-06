# rubrics/architecture.md – Architecture Review

**Domain:** Service boundaries, dependency direction, scalability, coupling, extensibility.
**Universal criteria:** Architecture (8) at full depth; Security (6), Performance (7), Testability (9), Observability (10) at baseline.  See `criteria.md`.
**Applies to:** Changes that cross module or service boundaries, introduce new dependencies, or alter system topology.

---

## Goals

- Confirm that the change respects established architectural boundaries and decisions.
- Identify coupling, cyclic dependencies, or responsibility leaks that will hinder future change.
- Assess whether the design scales to expected load and is extensible without rewrites.

---

## Checklist

### Dependency direction and modularity

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑1 | Dependencies point in the established direction (e.g., domain ← application ← infrastructure); no upward dependencies | high |
| AR‑2 | Cyclic dependencies between modules or packages are not introduced | high |
| AR‑3 | A module does not directly access the internals of another module; it uses the published interface | high |
| AR‑4 | New external libraries are justified by clear need; they do not duplicate existing utilities | medium |
| AR‑5 | Third-party dependencies are isolated behind an adapter or facade, not scattered across business logic | medium |

### Service and component boundaries

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑6 | The change does not split a single logical transaction across two services without a compensation strategy | high |
| AR‑7 | Cross-service communication uses the agreed protocol (REST, gRPC, events); ad-hoc calls are not introduced | high |
| AR‑8 | Shared databases between services are not introduced; each service owns its data | high |
| AR‑9 | Events published to a message bus follow the established schema and versioning strategy | high |
| AR‑10 | Synchronous calls to downstream services include timeout and circuit-breaker handling | high |

### Scalability and resilience

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑11 | State that must survive restarts is externalised (database, cache, message queue); stateless design is preferred | medium |
| AR‑12 | The change does not introduce a single point of failure without a mitigation plan | high |
| AR‑13 | Fan-out operations (broadcast, scatter-gather) are bounded; unbounded parallelism is controlled | medium |
| AR‑14 | Backpressure and queue depth limits are defined for async consumers | medium |
| AR‑15 | The design handles partial failure gracefully; one failing component does not cascade to the whole system | high |

### Extensibility and evolvability

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑16 | Extension points are open for addition without modification of existing code (Open/Closed Principle) | medium |
| AR‑17 | Abstractions are not over-engineered; YAGNI applies — no speculative generality for undecided future features | low |
| AR‑18 | Configuration values that are likely to change are externalised, not hardcoded | medium |
| AR‑19 | The change does not lock the system into a technology that is hard to replace | medium |

### Observability and operability

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑20 | New services or components emit structured logs, metrics, and traces from the start | medium |
| AR‑21 | Health check and readiness endpoints exist for new deployable components | medium |
| AR‑22 | The deployment unit can be rolled back independently of its dependencies | high |
| AR‑23 | Feature flags or progressive rollout is used for high-risk behavioural changes | medium |

### Testability (baseline)

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑26 | New components accept their collaborators through constructor or function parameters; no hardcoded instantiation of complex dependencies | high |
| AR‑27 | Service boundaries are expressed as explicit interfaces or contracts, enabling test doubles at those seams | medium |
| AR‑28 | The deployment unit can be exercised with realistic data in an isolated environment (staging, local compose) without affecting production | medium |

*For a full testability deep-dive, escalate to `testability.md`.*

### Documentation of decisions

| # | Criterion | Severity if violated |
|---|---|---|
| AR‑24 | Significant architectural decisions are recorded in an ADR (Architecture Decision Record) | medium |
| AR‑25 | The decision's trade-offs and rejected alternatives are documented | medium |

---

## Scoring guidance

Boundary violations and cyclic dependencies are **high** because they compound over time.  YAGNI violations and over-engineering are **low** — flag as observations rather than blockers.  Missing ADRs for significant decisions are **medium**; they do not block release but must be addressed before the next review cycle.
