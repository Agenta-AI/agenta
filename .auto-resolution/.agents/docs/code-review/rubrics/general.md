# rubrics/general.md – General Code Quality

**Domain:** Code quality, logic, style, testing.
**Applies to:** All review types as a baseline pass.
**Use alongside:** Domain-specific rubrics (security, performance, api, etc.) as warranted by scope.

---

## Goals

- Verify the change is correct, readable, and maintainable.
- Ensure tests exist and adequately cover new behaviour.
- Confirm that documentation and comments reflect current logic.

---

## Checklist

### Correctness and logic

| # | Criterion | Severity if violated |
|---|---|---|
| G‑1 | Logic matches the stated intent or spec | high |
| G‑2 | Edge cases are handled (empty input, zero, null, max value, concurrent access) | high |
| G‑3 | Error conditions are caught and handled; errors are not silently swallowed | high |
| G‑4 | Control flow is deterministic; no unintended non-determinism | medium |
| G‑5 | No unintended side effects in shared or global state | medium |
| G‑6 | Off-by-one errors, integer overflow, and type coercion are addressed | medium |

### Maintainability and style

| # | Criterion | Severity if violated |
|---|---|---|
| G‑7 | Naming is clear, consistent with the existing convention, and unambiguous | low |
| G‑8 | Functions and methods do one thing; they are short enough to reason about | low |
| G‑9 | No dead code, commented-out blocks, or unused variables/imports | low |
| G‑10 | Duplication is avoided; shared logic is extracted appropriately | medium |
| G‑11 | Magic numbers and strings are replaced with named constants | low |
| G‑12 | Complex logic is explained with a comment stating *why*, not *what* | low |

### Testing

| # | Criterion | Severity if violated |
|---|---|---|
| G‑13 | New or modified behaviour has corresponding unit tests | high |
| G‑14 | Tests are independent, deterministic, and do not rely on external state | medium |
| G‑15 | Test names describe the scenario and expected outcome | low |
| G‑16 | Edge cases identified in G‑2 are represented in tests | medium |
| G‑17 | Mocks and stubs are limited to external boundaries; business logic is tested directly | medium |

### Documentation

| # | Criterion | Severity if violated |
|---|---|---|
| G‑18 | Public interfaces have accurate doc-comments (purpose, parameters, return value, exceptions) | low |
| G‑19 | README or inline documentation reflects the change | low |
| G‑20 | Breaking changes are noted with a migration path | medium |

---

## Scoring guidance

Score each criterion as: **Pass** · **Fail** · **N/A**.

- A single `critical` or multiple `high` failures → recommend **Fail** verdict.
- Isolated `high` failures with remediation plans in place → **Pass with conditions**.
- Only `medium` / `low` failures → **Pass**.

Record evidence for every **Fail**.  State N/A with a brief rationale.
