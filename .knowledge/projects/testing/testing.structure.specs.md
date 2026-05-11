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
    acceptance/             # Black box tests through public interfaces (was: e2e/)
    integration/            # Adapter tests against real dependencies
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
| `acceptance/` | Full system tests through a public interface | **Black box** | Full system running. Tests only interact with public surfaces (API URL, Web URL) using credentials. All dependencies are real. |
| `integration/` | Adapter implementation tests against real dependencies | **Gray box** | Relevant dependencies real (DB, Redis, external service). Part of system may be running. |
| `unit/` | Code in isolation | **White box** | System NOT running. All dependencies mocked/faked. Tests internal parts and layers using dependency injection. |
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
      acceptance/                         # Acceptance tests organized by domain (155 tests)
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
      integration/                        # Integration tests (.gitkeep placeholder)
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
      acceptance/
        test_billing_period.py            # Billing period acceptance test
      integration/                        # .gitkeep placeholder
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
```

### SDK

SDK is OSS-only (no EE split), so tests live directly under `sdk/tests/`.

```
sdk/
  pytest.ini                              # Test config (testpaths: oss/tests/pytest, ee/tests/pytest)
  oss/tests/
    manual/                               # Manual tests
      imports/*.py                        # Import and init tests
      workflows/*.py                      # SDK workflow manual tests
      tools/*.py                          # Tool invocation tests
    legacy/                               # Legacy tests (NOT run, preserved for reference)
      annotations/, baggage/, custom_workflows/, debugging/, management/, ...
    pytest/
      conftest.py
      acceptance/                         # SDK acceptance tests (66 tests, against live API)
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
      integration/                        # Integration tests (.gitkeep placeholder)
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
    package.json                          # Acceptance scripts (test:acceptance, test:acceptance:ui, test:acceptance:debug)
    playwright.config.ts                  # Playwright configuration (testDir points to acceptance/)
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
      acceptance/                         # Acceptance test suites organized by feature
        settings/
        app/
        playground/
        prompt-registry/
        testsset/
        observability/
        deployment/
        smoke.spec.ts                     # Smoke test
      integration/                        # .gitkeep placeholder
      unit/                               # .gitkeep placeholder
      utils/                              # .gitkeep placeholder
  ee/tests/
    manual/                               # .gitkeep placeholder
    legacy/                               # .gitkeep placeholder
    playwright/
      acceptance/                         # EE acceptance test suites
        settings/
        app/
        playground/
        prompt-registry/
        testsset/
        auto-evaluation/
        observability/
        deployment/
        human-annotation/
      integration/                        # .gitkeep placeholder
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
      acceptance/                         # .gitkeep placeholder (ready for acceptance tests)
      integration/                        # .gitkeep placeholder (ready for integration tests)
      unit/                               # .gitkeep placeholder (ready for unit tests)
      utils/                              # .gitkeep placeholder (ready for fixtures)
  ee/tests/
    manual/                               # .gitkeep placeholder
    legacy/                               # .gitkeep placeholder
    pytest/
      acceptance/                         # .gitkeep placeholder
      integration/                        # .gitkeep placeholder
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

### acceptance/ -- Black box, full system running

Acceptance tests test the **full system through a public interface**. All dependencies are real. The full system is running. Tests only interact with public surfaces using credentials:
- API acceptance: HTTP requests to API endpoints (`AGENTA_API_URL`, `AGENTA_AUTH_KEY`)
- SDK acceptance: SDK client calls against live API (`AGENTA_HOST`, `AGENTA_API_KEY`)
- Web acceptance: Playwright browser tests against running web app (`AGENTA_WEB_URL`)

**No access to internals.** Tests validate behavior from the outside. This includes contract, functional, performance, security, usability, reliability, and compatibility testing.

### integration/ -- Gray box, real dependency

Integration tests test an **adapter implementation against a real dependency**. Relevant dependencies are real; the full system may not be running.

Examples:
- Backend: test DAO against Postgres, test utils against Redis, test runner against Daytona, test gateway against Composio
- Frontend: test hooks against Agenta, test analytics against PostHog

Integration tests are new and currently have `.gitkeep` placeholder files in each component.

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

The `utils/` folder may also contain **shared test fixtures** (conftest helpers, account management, API clients) used by `acceptance/`, `integration/`, and `unit/` tests.
