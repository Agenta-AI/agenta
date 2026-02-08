# Testing Structure -- Folder Layout and File Types

This document describes the physical organization of test files across the monorepo. It covers test categories by type, current directory layouts, target layouts, file naming conventions, and handling of legacy and manual tests.

For what to test at each architectural layer, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For per-interface specifics, see [testing.interface.api.specs.md](testing.interface.api.specs.md), [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md), [testing.interface.web.specs.md](testing.interface.web.specs.md).

---

## Test categories by type

| Type | Extension/Format | Runner | Description |
|------|-----------------|--------|-------------|
| Automated (Python) | `test_*.py` | Pytest | Unit and E2E tests for API and SDK |
| Automated (TypeScript E2E) | `*.spec.ts` | Playwright | Browser-based E2E tests for Web |
| Automated (TypeScript unit) | `*.test.ts` | Jest/Vitest | Component unit tests for Web |
| Automated (TypeScript integration) | `test-*.ts` | tsx | Data layer integration tests for Web |
| Manual | `*.http` | HTTP client (VS Code REST Client, IntelliJ) | Manual API testing for auth and billing flows |
| Scripts | `*.sh`, `*.ts` | Bash, tsx | Test runner scripts, setup/teardown scripts |
| Legacy | Various | Not run | Historical tests preserved for reference |

---

## Current directory layout

### API

```
api/
  pytest.ini                              # Test config (testpaths: oss/tests/pytest, ee/tests/pytest)
  oss/tests/
    pytest/                               # Active E2E test suite
      conftest.py                         # Root conftest (imports from utils/)
      utils/
        api.py                            # authed_api, unauthed_api fixtures
        accounts.py                       # cls_account, mod_account, foo_account fixtures
        env.py                            # ag_env fixture (AGENTA_API_URL, AGENTA_AUTH_KEY)
        constants.py                      # BASE_TIMEOUT = 10
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
    legacy/                               # Legacy tests (NOT run, ~60 files)
      conftest.py
      ...
  ee/tests/
    pytest/
      test_billing_period.py
    manual/
      billing.http
      auth/
        *.http                            # Manual HTTP tests (setup, discovery, policy)
      evaluations/sdk/
        test_*.py                         # Manual SDK evaluation scripts
```

### SDK

```
sdk/
  pytest.ini                              # Test config (testpaths: tests/pytest)
  tests/
    pytest/                               # Primary pytest suite
      conftest.py
      utils/
        env.py
        sdk.py
        accounts.py
        constants.py
      healthchecks/
        test_healthchecks.py
    unit/                                 # Unit tests (no external deps)
      conftest.py
      test_tracing_decorators.py
    integration/                          # Integration tests (live API)
      conftest.py
      applications/
        test_apps_shared_manager.py
        test_legacy_applications_manager.py
      evaluations/
        test_evaluations_flow.py
      evaluators/
        test_evaluators_manager.py
      prompts/
        test_prompt_template_storage.py
      testsets/
        test_testsets_manager.py
      tracing/
        test_observability_traces.py
      vault/
        test_vault_secrets.py
    legacy/                               # Legacy tests (NOT run)
      ...
```

### Web

```
web/
  package.json                            # Data layer test scripts (test:datalayer, test:apps, etc.)
  tests/
    package.json                          # E2E scripts (test:e2e, test:e2e:ui, test:e2e:debug)
    playwright.config.ts                  # Playwright configuration
    playwright/
      config/
        testTags.ts                       # Tag definitions and syntax
        types.d.ts                        # Tag type definitions
      global-setup.ts                     # Auth setup before all tests
      global-teardown.ts                  # Cleanup after all tests
      scripts/
        run-tests.ts                      # Test runner script
    tests/
      fixtures/
        base.fixture/                     # apiHelpers, uiHelpers, llmKeysSettingsHelpers
        user.fixture/                     # authHelpers (email/password flows)
        session.fixture/                  # Browser session management
    guides/
      E2E_TEST_GENERATION_GUIDE.md
      E2E_TEST_ORGANIZATION_GUIDE.md
      UTILITIES_AND_FIXTURES_GUIDE.md
      RECORDING_GUIDE.md
  oss/tests/
    1-settings/                           # Numbered E2E test suites
    2-app/
    3-playground/
    4-prompt-registry/
    5-testsset/
    7-observability/
    8-deployment/
    datalayer/
      test-apps.ts                        # Data layer integration tests
      test-observability.ts
  ee/tests/
    1-settings/
    2-app/
    3-playground/
    4-prompt-registry/
    5-testsset/
    6-auto-evaluation/
    7-observability/
    8-deployment/
    9-human-annotation/
  oss/src/components/Playground/state/atoms/__tests__/
    core.test.ts                          # Component unit test (colocated)
```

---

## Target directory layout

### API (adding unit tests)

```
api/oss/tests/
  pytest/                                 # Existing E2E suite (unchanged)
    ...
  unit/                                   # NEW
    utils/
      test_*.py                           # Utils/helpers unit tests
    core/
      test_*.py                           # Core service unit tests
    adapters/
      db/
        test_*.py                         # DAO unit tests
      http/
        test_*.py                         # Router unit tests
  _support/                               # NEW
    fakes.py                              # In-memory port implementations
    builders.py                           # Domain object/DTO factories
    assertions.py                         # Common assertion helpers
```

### SDK (expanding unit tests)

```
sdk/tests/
  unit/                                   # Existing + expanded
    conftest.py
    test_tracing_decorators.py            # Existing
    test_managers.py                      # NEW: Manager method logic
    test_init.py                          # NEW: Configuration/initialization
    test_errors.py                        # NEW: Error handling
  integration/                            # Existing (unchanged)
    ...
  _support/                               # NEW
    fakes.py
    builders.py
```

### Web (expanding component unit tests)

```
web/oss/src/
  components/
    <Module>/
      state/atoms/__tests__/
        *.test.ts                         # Colocated atom tests (expand per module)
  lib/helpers/__tests__/
    *.test.ts                             # NEW: Pure utility function tests
```

---

## File naming conventions

| Context | Pattern | Example |
|---------|---------|---------|
| Python unit/E2E test | `test_<domain>_<scope>.py` | `test_workflows_basics.py` |
| Python test class | `TestXxxBasics`, `TestXxxQueries` | `TestWorkflowsBasics` |
| Playwright E2E test | `<feature>.spec.ts` | `create.spec.ts` |
| TypeScript unit test | `<module>.test.ts` | `core.test.ts` |
| TypeScript integration test | `test-<domain>.ts` | `test-apps.ts` |
| Python conftest | `conftest.py` | Always this name |
| Support module | `fakes.py`, `builders.py`, `assertions.py` | In `_support/` |

---

## Legacy handling

Legacy test directories (`api/oss/tests/legacy/`, `sdk/tests/legacy/`) are:
- Excluded from test runner configurations (`pytest.ini` testpaths point only to `*/tests/pytest`).
- Not deleted -- preserved for reference during migration.
- Not maintained -- no expectation of passing.

When a legacy test is migrated to the new structure, the legacy file may be deleted.

---

## Manual tests

`.http` files in `api/ee/tests/manual/` are used for ad-hoc manual testing of:
- Billing flows
- Auth flows (setup, discovery, domain verification, policy enforcement)
- Evaluation SDK interactions

Python scripts in `api/ee/tests/manual/evaluations/sdk/` serve the same purpose for manual SDK evaluation testing. These files are not automated and not tracked by CI. They serve as developer reference for manually exercising endpoints.
