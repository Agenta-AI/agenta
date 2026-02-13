# Running Tests

This document describes how to run tests across all interfaces and execution environments. It covers the three execution modes (local-against-local, local-against-cloud, CI-against-cloud), environment variables, commands per interface, dimension-based filtering, and the CI pipeline strategy.

For dimension/marker definitions, see [testing.dimensions.specs.md](testing.dimensions.specs.md).
For per-interface details, see [testing.interface.api.specs.md](testing.interface.api.specs.md), [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md), [testing.interface.web.specs.md](testing.interface.web.specs.md).

---

## Execution environments

Tests can run in three modes, distinguished by where the tests execute and what backend they target.

### Local against local

All services run locally (via docker-compose or manual processes). Tests execute on the developer's machine and hit `localhost`.

**When to use:** Day-to-day development, debugging, writing new tests.

**Setup:**
- Start the API and database locally (e.g., `docker-compose up`)
- Set environment variables to point to local services
- Run tests directly via pytest or pnpm

### Local against cloud

Tests execute on the developer's machine but hit a cloud or staging API.

**When to use:** Validating SDK or Web behavior against a deployed environment without running the full stack locally.

**Setup:**
- Set `AGENTA_API_URL` / `AGENTA_HOST` to the cloud URL (e.g., `https://cloud.agenta.ai`)
- Provide cloud credentials (`AGENTA_API_KEY`, `AGENTA_AUTH_KEY`)
- Run tests directly via pytest or pnpm

### CI against cloud

Tests execute in GitHub Actions and target a cloud/staging environment.

**When to use:** Automated quality gates on PRs and merges.

**Setup:** Configured via GitHub Actions workflows with secrets for credentials and service containers for infrastructure.

---

## Environment variables

Master table of all variables across all interfaces and modes:

| Variable | Interface | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `AGENTA_API_URL` | API | Yes | -- | Base URL of the API under test |
| `AGENTA_AUTH_KEY` | API | Yes | -- | Admin key for creating test accounts |
| `AGENTA_HOST` | SDK | For integration | `https://cloud.agenta.ai` | API host for SDK tests |
| `AGENTA_API_KEY` | SDK | For integration | -- | API key for SDK authentication |
| `TESTMAIL_API_KEY` | Web E2E | Yes | -- | Testmail API key for email auth flows |
| `TESTMAIL_NAMESPACE` | Web E2E | Yes | -- | Testmail namespace |
| `AGENTA_OSS_OWNER_PASSWORD` | Web E2E (OSS) | Yes | -- | OSS owner account password |
| `AGENTA_OSS_OWNER_EMAIL` | Web E2E (OSS) | Optional | -- | OSS owner email |
| `NEXT_PUBLIC_AGENTA_API_URL` | Web data layer | Yes | -- | API URL for frontend tests |

---

## Commands by interface

### API

```bash
# E2E tests (existing suite)
cd api && pytest oss/tests/pytest/ -v

# E2E tests with dimension filter
cd api && pytest oss/tests/pytest/ -v -m "coverage_smoke and path_happy"

# EE tests only
cd api && pytest ee/tests/pytest/ -v

# Future: unit tests
cd api && pytest oss/tests/pytest/unit/ -v
```

### SDK

**Current paths** (before migration):

```bash
# Unit tests
cd sdk && pytest tests/unit/ -v

# Integration tests (requires credentials)
AGENTA_API_KEY=<key> AGENTA_HOST=<url> cd sdk && pytest tests/integration/ -v

# Healthcheck tests
cd sdk && pytest tests/pytest/ -v
```

**Target paths** (after migration to `tests/pytest/`):

```bash
# All SDK tests (unit + E2E, E2E skips if no credentials)
cd sdk && pytest tests/pytest/ -v

# Unit tests only
cd sdk && pytest tests/pytest/unit/ -v

# Unit tests with coverage
cd sdk && pytest tests/pytest/unit/ --cov=agenta.sdk --cov-report=html

# E2E tests only (requires credentials)
AGENTA_API_KEY=<key> AGENTA_HOST=<url> cd sdk && pytest tests/pytest/e2e/ -v

# Specific E2E domain
AGENTA_API_KEY=<key> cd sdk && pytest tests/pytest/e2e/observability/ -v

# Specific test class
cd sdk && pytest tests/pytest/unit/test_tracing_decorators.py::TestGeneratorTracing -v
```

### Web

```bash
# E2E tests (from web/tests/)
cd web/tests && pnpm test:e2e

# E2E with UI mode
cd web/tests && pnpm test:e2e:ui

# E2E debug mode
cd web/tests && pnpm test:e2e:debug

# Data layer tests (from web/)
cd web && pnpm test:datalayer

# Individual data layer tests
cd web && pnpm test:apps
cd web && pnpm test:observability
```

---

## Dimension-based filtering

### Pytest (API/SDK)

The `-m` flag filters by markers:

```bash
# Smoke tests only
pytest -m coverage_smoke

# Happy path smoke tests
pytest -m "coverage_smoke and path_happy"

# Functional tests for owner role
pytest -m "lens_functional and role_owner"

# Exclude slow tests
pytest -m "not speed_slow"
```

Note: `coverage_full` is not a filter -- it means "run all tests" (no `-m` flag).

### Playwright (Web)

Dimension-specific CLI flags filter tests:

```bash
# Smoke tests
pnpm test:e2e -- -coverage smoke

# Happy path smoke tests
pnpm test:e2e -- -coverage smoke -path happy

# Specific scope
pnpm test:e2e -- -scope playground

# Functional tests for owner permission
pnpm test:e2e -- -lens functional -permission owner
```

---

## CI pipeline

### Current state

Only linting checks are active in CI:

| Workflow | File | What it checks |
|----------|------|---------------|
| Python formatting | `.github/workflows/02-check-python-formatting.yml` | `ruff format` on `api/` and `sdk/` |
| Python linting | `.github/workflows/03-check-python-linting.yml` | `ruff check` on `api/` and `sdk/` |
| Frontend linting | `.github/workflows/04-check-frontend-linting.yml` | ESLint and Prettier on `web/` |

No test execution workflows are currently active.

### Target state

| Trigger | What runs | Infrastructure | Coverage filter |
|---------|-----------|---------------|----------------|
| Every PR | API unit tests | None (pure Python) | All |
| Every PR | SDK unit tests | None (pure Python) | All |
| Every PR | Web component unit tests | None (Node.js) | All |
| Merge to main | API E2E tests | Postgres (docker-compose) | `coverage_smoke` |
| Merge to main | SDK integration tests | Running API + Postgres | `coverage_smoke` |
| Merge to main | Web E2E tests | Running app + API + Postgres | `coverage_smoke` |
| Nightly | API E2E tests | Postgres (docker-compose) | Full (no filter) |
| Nightly | SDK integration tests | Running API + Postgres | Full (no filter) |
| Nightly | Web E2E tests | Running app + API + Postgres | Full (no filter) |

### Infrastructure requirements

- **Postgres:** Service container or docker-compose for API E2E and SDK integration tests.
- **API server:** Required for SDK integration and Web E2E (can run in-process or as container).
- **Web app:** Required for Web E2E (Next.js dev server or built app).
- **Credentials:** Stored as GitHub Actions secrets (`AGENTA_AUTH_KEY`, `AGENTA_API_KEY`, `TESTMAIL_API_KEY`, `TESTMAIL_NAMESPACE`).
