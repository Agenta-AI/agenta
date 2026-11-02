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
| `AGENTA_TEST_OSS_OWNER_PASSWORD` | Web E2E (OSS) | Yes | -- | OSS owner account password |
| `AGENTA_TEST_OSS_OWNER_EMAIL` | Web E2E (OSS) | Optional | -- | OSS owner email |
| `NEXT_PUBLIC_AGENTA_API_URL` | Web data layer | Yes | -- | API URL for frontend tests |
| `AGENTA_TEST_NO_DATABASE` | API integration, API acceptance | For a remote deployment | unset | Declares that this runner has no route to the deployment's Postgres |
| `AGENTA_TESTS_EXPECT_LLM_GATEWAY` | Services acceptance | For a deployment with the plane off | `true` | Declares whether the deployment is expected to serve the LLM gateway |

### Declarations about the deployment under test

Two layers refuse to guess what the deployment they are pointed at can do, because guessing wrong produces a green run that covered nothing. A run against a deployment it did not configure has to state the facts below, and the statement belongs in the workflow or shell that points at that deployment, not in a default.

The API integration layer reads the deployment's Postgres directly. When it cannot reach one it fails rather than skips, so a run that touched no database cannot report success. A runner that reaches the deployment only over HTTPS has no route to its Postgres at all, which is the shape of every remote stage and of the Railway previews in `.github/workflows/44-railway-tests.yml`. Set `AGENTA_TEST_NO_DATABASE=1` for the integration layer there, and for the acceptance layer too: its few database-adjacent cases (the modules marked `integration`, such as the channels bridge and differential suites and the mounts and sessions attachment cases) go through the same guard and fail the same way. Every database-bound case then skips with a reason naming the declaration, and the run prints the count of them in its terminal summary and in the GitHub job summary, so the skip is harder to miss than the failure was.

The services gateway acceptance suites exist to prove that a gateway refusal reaches the caller, so they expect the deployment to serve the LLM gateway plane and fail when it does not. The plane ships off, so a run pointed at a stack that keeps it off has to say so with `AGENTA_TESTS_EXPECT_LLM_GATEWAY=false`, and the suites then skip. Do not set it on a deployment that is supposed to serve the plane. The point of the default is that a misconfigured deployment stays loud.

The web MCP acceptance suites drive a mock upstream that exists only in a stack started with `AGENTA_GATEWAYS_MOCKS_ENABLED=true`, and they have no equivalent declaration. They fail against a deployment that does not run the mock, which is deliberate. They used to skip whenever an address was unset, the address was set nowhere in the repository, and the feature's only end-to-end coverage never ran while every run reported green.

---

## Commands by interface

### API

```bash
# Acceptance tests
cd api && pytest oss/tests/pytest/ -v

# Acceptance tests with dimension filter
cd api && pytest oss/tests/pytest/ -v -m "coverage_smoke and path_happy"

# EE tests only
cd api && pytest ee/tests/pytest/ -v

# Unit tests
cd api && pytest oss/tests/pytest/unit/ -v
```

### SDK

```bash
# All SDK tests (unit + acceptance, acceptance skips if no credentials)
cd sdk && pytest oss/tests/pytest/ -v

# Unit tests only
cd sdk && pytest oss/tests/pytest/unit/ -v

# Unit tests with coverage
cd sdk && pytest oss/tests/pytest/unit/ --cov=agenta.sdk --cov-report=html

# Acceptance tests only (requires credentials)
AGENTA_API_KEY=<key> AGENTA_HOST=<url> cd sdk && pytest oss/tests/pytest/acceptance/ -v

# Specific acceptance domain
AGENTA_API_KEY=<key> cd sdk && pytest oss/tests/pytest/acceptance/observability/ -v

# Specific test class
cd sdk && pytest oss/tests/pytest/unit/test_tracing_decorators.py::TestGeneratorTracing -v
```

### Web

```bash
# Acceptance tests (from web/tests/)
cd web/tests && pnpm test:acceptance

# Acceptance with UI mode
cd web/tests && pnpm test:acceptance:ui

# Acceptance debug mode
cd web/tests && pnpm test:acceptance:debug

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
pnpm test:acceptance -- -coverage smoke

# Happy path smoke tests
pnpm test:acceptance -- -coverage smoke -path happy

# Specific scope
pnpm test:acceptance -- -scope playground

# Functional tests for owner permission
pnpm test:acceptance -- -lens functional -permission owner
```

---

## CI pipeline

### Current state

Only linting checks are active in CI:

| Workflow | File | What it checks |
|----------|------|---------------|
| Code styling | `.github/workflows/11-check-code-styling.yml` | Python `ruff format --check` and `ruff check`, plus TypeScript Prettier and ESLint |
| Unit tests | `.github/workflows/12-check-unit-tests.yml` | OSS unit checks for API, SDK, services, and web |

No test execution workflows are currently active.

### Target state

| Trigger | What runs | Infrastructure | Coverage filter |
|---------|-----------|---------------|----------------|
| Every PR | API unit tests | None (pure Python) | All |
| Every PR | SDK unit tests | None (pure Python) | All |
| Every PR | Web component unit tests | None (Node.js) | All |
| Merge to main | API acceptance tests | Postgres (docker-compose) | `coverage_smoke` |
| Merge to main | SDK integration tests | Running API + Postgres | `coverage_smoke` |
| Merge to main | Web acceptance tests | Running app + API + Postgres | `coverage_smoke` |
| Nightly | API acceptance tests | Postgres (docker-compose) | Full (no filter) |
| Nightly | SDK integration tests | Running API + Postgres | Full (no filter) |
| Nightly | Web acceptance tests | Running app + API + Postgres | Full (no filter) |

### Infrastructure requirements

- **Postgres:** Service container or docker-compose for API acceptance and SDK integration tests.
- **API server:** Required for SDK integration and Web acceptance (can run in-process or as container).
- **Web app:** Required for Web acceptance (Next.js dev server or built app).
- **Credentials:** Stored as GitHub Actions secrets (`AGENTA_AUTH_KEY`, `AGENTA_API_KEY`, `TESTMAIL_API_KEY`, `TESTMAIL_NAMESPACE`).
