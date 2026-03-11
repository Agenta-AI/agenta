# rubrics/testability.md – Testability Review

**Domain:** Testability as a structural property of the code under review.
**Universal criterion:** Testability (9) — full depth.  See `criteria.md` for the baseline questions that apply in every review.
**Applies to:** Core business logic, domain models, services, and any component where test isolation matters.

> **Scope note:** This rubric assesses whether the *code under review* is designed to be testable.  It does not assess whether the accompanying tests are adequate — that is covered by Completeness (criterion 2) and Correctness (criterion 1) via `general.md`.

---

## Goals

- Identify design decisions that will make the code hard or impossible to test in isolation.
- Verify that dependencies are injectable and business logic is decoupled from infrastructure.
- Confirm that the code exposes the right seams for future testing without requiring a rewrite.

---

## Checklist

### Dependency injection and inversion

| # | Criterion | Severity if violated |
|---|---|---|
| T‑1 | Dependencies are injected (constructor, function parameter, or DI container); not obtained via global state, module-level singletons, or `import`-time side effects | high |
| T‑2 | The `new` keyword (or equivalent instantiation) does not appear inside business logic for collaborators; factories or DI supply instances instead | medium |
| T‑3 | Service locators and static accessor methods are not used to obtain dependencies inside units under test | medium |

### Separation of concerns

| # | Criterion | Severity if violated |
|---|---|---|
| T‑4 | Business logic is separated from I/O (database reads, HTTP calls, file system) and can be exercised without a running server or database | high |
| T‑5 | Business logic is not embedded directly in framework lifecycle hooks, middleware, or routing glue; it resides in units that can be tested in isolation | high |
| T‑6 | Functions and methods have a single, clearly stated responsibility; testing one behaviour does not require triggering unrelated side effects | medium |
| T‑7 | Side effects (emails, events, writes to external systems) are triggered through an injected abstraction, not directly | high |

### External boundaries

| # | Criterion | Severity if violated |
|---|---|---|
| T‑8 | External boundaries (network calls, file system, message queues, clock, randomness) are isolated behind an interface or abstraction that can be replaced in tests | high |
| T‑9 | Time-dependent logic uses an injectable clock abstraction; `time.Now()`, `datetime.now()`, `Date.now()`, or equivalent are not embedded in business logic | medium |
| T‑10 | Randomness used in testable paths is seeded through an injectable source | medium |

### State and isolation

| # | Criterion | Severity if violated |
|---|---|---|
| T‑11 | Hidden globals, thread-local state, or module-level singletons do not prevent parallel or isolated test execution | high |
| T‑12 | Shared mutable state between units is minimised; where it exists, it is clearly owned and its access is controlled | medium |
| T‑13 | Database or file-system state required for a test is set up and torn down predictably; tests do not rely on pre-existing data | high |

### Contracts and seams

| # | Criterion | Severity if violated |
|---|---|---|
| T‑14 | Public interfaces (function signatures, event schemas) are stable enough to write contracts against; they do not change arbitrarily with internal refactors | medium |
| T‑15 | Internal state that determines behaviour is reflected in observable outputs or accessible via an explicit accessor; black-box testing is viable | medium |
| T‑16 | Error paths return distinct, inspectable values or typed exceptions; callers can assert on failure mode as well as success | medium |
| T‑17 | Non-deterministic operations (scheduling, concurrency order) are not embedded in paths that must produce deterministic results in tests | medium |

---

## Scoring guidance

T‑1, T‑4, T‑7, T‑8, T‑11, and T‑13 are **high** because they are architectural: once code is shipped in an untestable shape, fixing it requires a refactor, not just adding tests.  Flag these early.

T‑6, T‑14 through T‑17 are **medium**: they reduce test quality and increase maintenance cost but do not block testing outright.

Record the precise location where the injection or coupling violation occurs and propose the minimum refactor needed to introduce the seam.
