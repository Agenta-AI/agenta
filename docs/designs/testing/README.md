# Testing

This directory specifies the testing strategy for the Agenta monorepo, covering the API, SDK, and Web frontend. The strategy uses orthogonal documents: principles describe the philosophy, boundaries describe architectural layers, dimensions describe filtering, and interface documents describe per-component specifics.

---

## Quick Reference

### Core Specifications

| Document | Description |
|----------|-------------|
| [testing.principles.specs.md](testing.principles.specs.md) | Philosophy, test pyramid, tradeoffs, mocking approach |
| [testing.boundaries.specs.md](testing.boundaries.specs.md) | Architectural test layers and what to test at each |
| [testing.dimensions.specs.md](testing.dimensions.specs.md) | Unified marker/tag taxonomy across all runners |
| [testing.structure.specs.md](testing.structure.specs.md) | Folder layout, file types, naming conventions |

### Interface Specifications

| Document | Description |
|----------|-------------|
| [testing.interfaces.specs.md](testing.interfaces.specs.md) | Overview of all system interfaces and testing matrix |
| [testing.interface.api.specs.md](testing.interface.api.specs.md) | API testing: current state, targets, mocking guidance |
| [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md) | SDK testing: unit, integration, smoke |
| [testing.interface.web.specs.md](testing.interface.web.specs.md) | Web testing: Playwright E2E, data layer, component unit |

### Supporting Documents

| Document | Description |
|----------|-------------|
| [testing.fixtures.specs.md](testing.fixtures.specs.md) | Shared test infrastructure, accounts, helpers, scoping |
| [testing.running.specs.md](testing.running.specs.md) | How to run tests: local, cloud, CI |
| [testing.initial.specs.md](testing.initial.specs.md) | Original discussion-format spec (preserved as reference) |

---

## Status Matrix

| Component | Unit Tests | Integration Tests | E2E Tests | CI |
|-----------|-----------|-------------------|-----------|-----|
| **API** | Planned | N/A (by design) | 38+ tests across 7 domains | Linting only |
| **SDK** | Tracing decorators | SDK managers against live API | N/A | Linting only |
| **Web** | Jotai atom tests | Data layer tests | Playwright (feature-numbered suites) | Linting only |

---

## Related In-Tree Documentation

| Location | Description |
|----------|-------------|
| `web/tests/guides/` | Playwright E2E guides (generation, organization, fixtures, recording) |
| `sdk/tests/unit/README.md` | SDK unit test quick start |
| `sdk/tests/unit/TESTING_PATTERNS.md` | SDK testing patterns and approaches |
| `web/tests/playwright/config/testTags.ts` | Web test tag definitions |
| `api/pytest.ini` | API pytest configuration and markers |
| `sdk/pytest.ini` | SDK pytest configuration and markers |
