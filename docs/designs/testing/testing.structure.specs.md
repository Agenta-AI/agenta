# Testing Structure -- Folder Layout and File Types

This document describes the physical organization of test files across the monorepo. It covers the organizing principle, test categories, standardized directory layouts, file naming, and handling of legacy and manual tests.

For what to test at each architectural layer, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For the five system interfaces, see [testing.interfaces.specs.md](testing.interfaces.specs.md) and the per-interface specs ([API](testing.interface.api.specs.md), [SDK](testing.interface.sdk.specs.md), [Web](testing.interface.web.specs.md)).

---

## Organizing principle

Test files are organized by **test runner first, then by test type, then by domain**:

```
<component>/tests/
  manual/                   # Not automated, developer reference (no fixed substructure)
  legacy/                   # Old tests, not run, preserved for reference
  <runner>/                 # pytest/ or playwright/
    conftest.py             # Runner-level config and shared fixtures (pytest only)
    e2e/                    # E2E tests organized by domain
    unit/                   # Unit tests organized by boundary layer
    utils/                  # Shared fixture modules
```

**Why runner at top level, not domain?**

- CI pipelines invoke by runner (`pytest`, `playwright`), not by domain. A single `pytest` invocation sweeps all domains.
- Runner config files (`conftest.py`, `playwright.config.ts`) naturally scope to the runner directory.
- Putting runner inside domain (e.g., `annotations/{pytest/,manual/}`) would force N separate runner invocations and N separate configs.

**License split (OSS/EE) stays at the component level.** Each component has `oss/tests/` and `ee/tests/` (except SDK which is OSS-only) because:
- It matches source code organization (`oss/src/` vs `ee/src/`).
- EE tests can depend on EE code.
- OSS distribution can exclude `ee/` entirely.

Within each license directory, the runner/type/domain hierarchy applies identically.

**Standardization:** All interfaces follow this structure. Empty folders include `.gitkeep` files to ensure they're tracked by git.

---

## Folder semantics

| Folder | Purpose | Testing mode | Execution |
|--------|---------|--------------|-----------|
| `manual/` | Freestyle tests and scripts in any format (`.http`, `.sh`, `.py`, `.ts`, `.curl`, etc.) | N/A | Not run automatically. Not in CI. No framework required. May be run manually by developers or agents. |
| `legacy/` | Archived historical tests | N/A | Not run. Preserved for reference during migration. |
| `pytest/` or `playwright/` | Framework-based automated tests | Follows tool's conventions | Run by pytest/playwright tool. Can be invoked by agents, humans, or CI. |
| `e2e/` | End-to-end tests | **Black box** | System running behind it. Tests only interact with public surfaces (API URL, Web URL) using credentials. Full system integration. |
| `unit/` | Unit tests | **White box** | System NOT running. Tests internal parts and layers using dependency injection and mocks. No external dependencies. |
| `utils/` | Utilities and library tests | **White box** | Tests tools, libraries, internal benchmarks, and helper functions the system uses but that aren't part of the system itself. Gray line with `unit/`. |

### Test file conventions

| Type | Pattern | Example |
|------|---------|---------|
| Python test file | `test_*.py` | `test_workflows_basics.py` |
| Python test class | `TestXxxBasics`, `TestXxxQueries` | `TestWorkflowsBasics` |
| Playwright E2E | `*.spec.ts` | `create.spec.ts` |
| Component unit (Web) | `*.test.ts` | `core.test.ts` |
| Manual HTTP | `*.http` | `billing.http` |
| Manual script | `*.sh`, `*.py`, `*.ts` | `smoke.http`, `test-apps.ts` |
| Python conftest | `conftest.py` | Always this name |

---

## Standardized directory layout

The following structure is now implemented and standardized across all interfaces.

### API

```
api/
  pytest.ini                              # Test config (testpaths: oss/tests/pytest, ee/tests/pytest)
  oss/tests/
    manual/                               # Manual tests (no fixed substructure)
      annotations/crud.http
      auth/admin.http
      evaluations/*.http
      testsets/*.http
      tracing/*.http
      workflows/*.http
    legacy/                               # Legacy tests (NOT run, ~60 files, preserved for reference)
      conftest.py, ...
    pytest/
      conftest.py                         # Root conftest (imports from utils/)
      e2e/                                # E2E tests organized by domain (155 tests)
        workflows/
          test_workflows_basics.py
          test_workflows_queries.py
          test_workflows_retrieve.py
          test_workflow_variants_basics.py
          test_workflow_variants_queries.py
          test_workflow_revisions_basics.py
          test_workflow_revisions_queries.py
          test_workflow_lineage.py
        evaluations/
          test_evaluation_runs_basics.py
          test_evaluation_runs_queries.py
          test_evaluation_scenarios_basics.py
          test_evaluation_scenarios_queries.py
          test_evaluation_steps_basics.py
          test_evaluation_steps_queries.py
          test_evaluation_metrics_basics.py
          test_evaluation_metrics_queries.py
        testsets/
          test_testsets_basics.py
          test_testsets_queries.py
          test_testsets_files.py
          test_testcases_basics.py
        evaluators/
          test_evaluators_basics.py
          test_evaluators_queries.py
        annotations/
          test_annotations_basics.py
          test_annotations_queries.py
        tracing/
          test_traces_basics.py
          test_spans_basics.py
          test_spans_queries.py
        healthchecks/
          test_healthchecks.py
      unit/                               # Unit tests (.gitkeep placeholder)
      utils/                              # Shared fixtures
        api.py                            # authed_api, unauthed_api fixtures
        accounts.py                       # cls_account, mod_account, foo_account fixtures
        env.py                            # ag_env fixture (AGENTA_API_URL, AGENTA_AUTH_KEY)
        constants.py                      # BASE_TIMEOUT = 10
  ee/tests/
    manual/                               # Manual tests
      auth/*.http                         # Auth flow tests (discovery, policy, etc.)
      billing.http
      evaluations/sdk/*.py
    legacy/                               # .gitkeep placeholder
    pytest/
      e2e/
        test_billing_period.py            # Billing period E2E test
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
```

### SDK

SDK is OSS-only (no EE split), so tests live directly under `sdk/tests/`.

```
sdk/
  pytest.ini                              # Test config (testpaths: tests/pytest)
  tests/
    manual/                               # Manual tests
      imports/*.py                        # Import and init tests
      workflows/*.py                      # SDK workflow manual tests
      tools/*.py                          # Tool invocation tests
    legacy/                               # Legacy tests (NOT run, preserved for reference)
      annotations/, baggage/, custom_workflows/, debugging/, management/, ...
    pytest/
      conftest.py
      e2e/                                # SDK E2E tests (66 tests, against live API)
        workflows/
          test_apps_shared_manager.py
          test_legacy_applications_manager.py
        evaluations/
          test_evaluations_flow.py
        evaluators/
          test_evaluators_manager.py
        integrations/
          test_prompt_template_storage.py
          test_testsets_manager.py
          test_vault_secrets.py
        observability/
          test_observability_traces.py
        healthchecks/
          test_healthchecks.py
      unit/                               # Unit tests (22 tests, no external deps)
        conftest.py
        test_tracing_decorators.py
      utils/                              # Shared fixtures
        env.py                            # Environment variables
        sdk.py                            # SDK client fixtures
        accounts.py                       # Account management
        constants.py                      # Test constants
```

### Web

```
web/
  tests/                                  # Shared Playwright infrastructure
    package.json                          # E2E scripts (test:e2e, test:e2e:ui, test:e2e:debug)
    playwright.config.ts                  # Playwright configuration (testDir points to e2e/)
    playwright/
      config/
        testTags.ts                       # Tag definitions and syntax
        types.d.ts                        # Tag type definitions
      global-setup.ts                     # Auth setup before all tests
      global-teardown.ts                  # Cleanup after all tests
      scripts/
        run-tests.ts                      # Test runner script
      utils/                              # .gitkeep placeholder
    tests/
      fixtures/
        base.fixture/                     # apiHelpers, uiHelpers, llmKeysSettingsHelpers
        user.fixture/                     # authHelpers (email/password/OTP flows)
        session.fixture/                  # Browser session management
    guides/
      E2E_TEST_GENERATION_GUIDE.md
      E2E_TEST_ORGANIZATION_GUIDE.md
      UTILITIES_AND_FIXTURES_GUIDE.md
      RECORDING_GUIDE.md
  oss/tests/
    manual/                               # Manual tests
      datalayer/
        test-apps.ts                      # Data layer integration tests
        test-observability.ts
    legacy/                               # .gitkeep placeholder
    playwright/
      e2e/                                # E2E test suites organized by feature
        settings/
        app/
        playground/
        prompt-registry/
        testsset/
        observability/
        deployment/
        smoke.spec.ts                     # Smoke test
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
  ee/tests/
    manual/                               # .gitkeep placeholder
    legacy/                               # .gitkeep placeholder
    playwright/
      e2e/                                # EE E2E test suites
        settings/
        app/
        playground/
        prompt-registry/
        testsset/
        auto-evaluation/
        observability/
        deployment/
        human-annotation/
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
  oss/src/components/Playground/state/atoms/__tests__/
    core.test.ts                          # Component unit test (colocated with source)
```

### Services

Services follows the same standardized structure as API and SDK.

```
services/
  oss/tests/
    manual/                               # Manual tests
      smoke.http                          # Existing smoke test
    legacy/                               # .gitkeep placeholder
    pytest/
      e2e/                                # .gitkeep placeholder (ready for E2E tests)
      unit/                               # .gitkeep placeholder (ready for unit tests)
      utils/                              # .gitkeep placeholder (ready for fixtures)
  ee/tests/
    manual/                               # .gitkeep placeholder
    legacy/                               # .gitkeep placeholder
    pytest/
      e2e/                                # .gitkeep placeholder
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
```

Services currently has minimal test coverage (one manual smoke test). The structure is in place and ready for expansion as services testing grows.

---

## Future expansion

### Unit test organization

When unit tests are added, they should be organized by [boundary layer](testing.boundaries.specs.md):

```
pytest/unit/
  utils/                                  # Layer 1: Pure functions
    test_*.py
  core/                                   # Layer 2: Business logic with mocked ports
    test_*.py
  adapters/
    db/                                   # Layer 3: DAO with mocked session
      test_*.py
    http/                                 # Layer 4: Routers with in-process client
      test_*.py
```

### Component unit tests (Web)

Web component unit tests remain **colocated with source code** in `__tests__/` directories:

```
web/oss/src/
  components/<Feature>/state/atoms/__tests__/*.test.ts
  lib/helpers/__tests__/*.test.ts
```

This keeps unit tests close to the code they test and allows for fast feedback during development.

---

## Understanding the test folder types

### manual/ -- Freestyle, no framework

The `manual/` folder accepts any kind of scripts or documentation. It's **freestyle** -- no required format, no required framework, no hard-coded checks. Files may include:
- `.http` files (REST client format)
- `.sh` shell scripts with curl commands
- `.py` Python scripts
- `.ts` / `.js` TypeScript/JavaScript scripts
- `.curl` curl command files
- `.md` documentation

**Key characteristics:**
- Not run automatically
- Not in CI
- No framework required
- May be run manually by developers or agents
- Useful for ad-hoc testing, reproducing issues, or developer reference

**Examples:**
- `api/oss/tests/manual/annotations/crud.http` -- Manual CRUD operations
- `api/ee/tests/manual/auth/*.http` -- Auth flow testing
- `web/oss/tests/manual/datalayer/*.ts` -- Data layer integration tests (run manually with tsx)

### legacy/ -- Archived tests

Historical tests preserved for reference during migration. **Not run.** May be deleted once migration is complete.

### e2e/ -- Black box, system running

End-to-end tests that treat the system as a **black box**. Expects a running system behind it (API server, web server, database, etc.). Tests only interact with public surfaces using credentials:
- API E2E: HTTP requests to API endpoints (`AGENTA_API_URL`, `AGENTA_AUTH_KEY`)
- SDK E2E: SDK client calls against live API (`AGENTA_HOST`, `AGENTA_API_KEY`)
- Web E2E: Playwright browser tests against running web app (`AGENTA_WEB_URL`)

**No access to internals.** Tests validate behavior from the outside.

### unit/ -- White box, system NOT running

Unit tests that test **internal parts and layers** of the system. The system is **NOT running** -- no servers, no databases, no external dependencies. Uses:
- Dependency injection
- Mocked ports and adapters
- In-memory fakes
- Direct function/class invocation

Tests are organized by [boundary layer](testing.boundaries.specs.md):
- `unit/utils/` -- Pure functions (parsing, formatting, validation)
- `unit/core/` -- Business logic with mocked ports
- `unit/adapters/db/` -- DAO with mocked database session
- `unit/adapters/http/` -- HTTP routers with in-process test client

### utils/ -- Testing the tools themselves

Tests for **libraries, tools, and helper functions** that the system uses but that aren't part of the system's core business logic. Examples:
- Testing a shared validation library
- Testing internal benchmark utilities
- Testing helper functions with boundary cases

There's a **gray line** between `unit/utils/` (pure business utilities) and `utils/` (tooling utilities). When in doubt:
- If it's business domain logic → `unit/utils/`
- If it's infrastructure/tooling → `utils/`

The `utils/` folder may also contain **shared test fixtures** (conftest helpers, account management, API clients) used by `e2e/` and `unit/` tests.
