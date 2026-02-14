# Testing

This directory specifies the testing strategy for the Agenta monorepo, covering all system interfaces: API, SDK, Web, Services, and Docs. The strategy uses orthogonal documents: principles describe the philosophy, boundaries describe architectural layers, dimensions describe filtering, structure describes folder layout, and interface documents describe per-component specifics.

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

Test folder structure is now **standardized** across all components with `manual/`, `legacy/`, and `pytest/`|`playwright/` containing `e2e/`, `unit/`, and `utils/` subdirectories.

| Component | Unit Tests | E2E Tests | Manual Tests | CI |
|-----------|-----------|-----------|--------------|-----|
| **API** | Structure ready (.gitkeep) | ✅ 155 tests across 7 domains | ✅ HTTP files, scripts | Linting only |
| **SDK** | ✅ 22 tests (tracing decorators) | ✅ 66 tests (SDK against live API) | ✅ Workflow tests, imports | Linting only |
| **Web** | ✅ Jotai atom tests (colocated) | ✅ Playwright feature suites | ✅ Data layer tests (manual) | Linting only |
| **Services** | Structure ready (.gitkeep) | Structure ready (.gitkeep) | ✅ smoke.http | N/A |
| **Docs** | N/A | Planned (link checking, build) | N/A | N/A |

---

## Quick Start: Running Tests

### API Tests

```bash
# Run all E2E tests
cd api
AGENTA_API_URL=http://localhost:10180/api AGENTA_AUTH_KEY=change-me-auth \
  python -m pytest oss/tests/pytest/ -v

# Run smoke tests only (fast subset)
python -m pytest oss/tests/pytest/ -v -m coverage_smoke

# Run specific domain
python -m pytest oss/tests/pytest/e2e/workflows/ -v

# Run with dimension filters
python -m pytest oss/tests/pytest/ -v -m "coverage_smoke and path_happy"
python -m pytest oss/tests/pytest/ -v -m "cost_free"  # Exclude paid tests
```

### SDK Tests

```bash
# Run all tests (unit + E2E)
cd sdk
AGENTA_API_URL=http://localhost:10180/api AGENTA_AUTH_KEY=change-me-auth \
  poetry run pytest tests/pytest/ -v

# Run unit tests only (no external deps)
poetry run pytest tests/pytest/unit/ -v

# Run E2E tests only (requires running API)
poetry run pytest tests/pytest/e2e/ -v -m e2e

# Run with dimension filters
poetry run pytest tests/pytest/e2e/ -v -m "coverage_smoke and cost_free"
```

### Web Tests

```bash
cd web/tests

# Run smoke tests (OSS) - AGENTA_LICENSE not needed when path is explicit
AGENTA_WEB_URL=http://localhost:10180 \
TESTMAIL_NAMESPACE=<your-namespace> \
TESTMAIL_API_KEY=<your-key> \
  npx playwright test ../oss/tests/playwright/e2e/smoke.spec.ts

# Run smoke tests (EE)
AGENTA_WEB_URL=http://localhost:10180 \
TESTMAIL_NAMESPACE=<your-namespace> \
TESTMAIL_API_KEY=<your-key> \
  npx playwright test ../ee/tests/playwright/e2e/smoke.spec.ts

# Run all E2E tests for a specific feature (OSS)
npx playwright test ../oss/tests/playwright/e2e/settings/

# Run with tag filters (requires AGENTA_LICENSE when using default testDir)
AGENTA_LICENSE=oss npx playwright test --grep "@coverage:smoke"
AGENTA_LICENSE=oss npx playwright test --grep "@coverage:smoke.*@cost:free"
```

**Note:** Web tests require valid TESTMAIL credentials. See [web/tests/playwright.config.ts](../../web/tests/playwright.config.ts) for configuration details.

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
