# Testing Structure -- Folder Layout and File Types

This document describes the physical organization of test files across the monorepo. It covers the organizing principle, test categories, current and target directory layouts, file naming, and handling of legacy and manual tests.

For what to test at each architectural layer, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For the five system interfaces, see [testing.interfaces.specs.md](testing.interfaces.specs.md) and the per-interface specs ([API](testing.interface.api.specs.md), [SDK](testing.interface.sdk.specs.md), [Web](testing.interface.web.specs.md)).

---

## Organizing principle

Test files are organized by **test runner first, then by test type, then by domain**:

```
<component>/tests/
  legacy/                   # Old tests, not run, preserved for reference
  manual/                   # Not automated, developer reference
    http/                   # .http files (VS Code REST Client, IntelliJ)
    curl/                   # curl command files (.sh with curl invocations)
    scripts/                # Python/shell/TS scripts (multi-step scenarios)
  <runner>/                 # pytest/ or playwright/
    conftest.py             # Runner-level config and shared fixtures
    utils/                  # Shared fixture modules
    unit/                   # Unit tests (by boundary layer)
    e2e/                    # E2E tests (by domain)
    _support/               # Shared fakes, builders, assertions
```

**Why runner at top level, not domain?**

- CI pipelines invoke by runner (`pytest`, `playwright`), not by domain. A single `pytest` invocation sweeps all domains.
- Runner config files (`conftest.py`, `playwright.config.ts`) naturally scope to the runner directory.
- Putting runner inside domain (e.g., `annotations/{pytest/,manual/}`) would force N separate runner invocations and N separate configs.

**License split (OSS/EE) stays at the component level.** Each component has `oss/tests/` and `ee/tests/` because:
- It matches source code organization (`oss/src/` vs `ee/src/`).
- EE tests can depend on EE code.
- OSS distribution can exclude `ee/` entirely.

Within each license directory, the runner/type/domain hierarchy applies identically.

---

## Test categories by type

| Type | Extension/Format | Runner | Description |
|------|-----------------|--------|-------------|
| Automated (Python) | `test_*.py` | Pytest | Unit and E2E tests for API and SDK |
| Automated (TypeScript E2E) | `*.spec.ts` | Playwright | Browser-based E2E tests for Web |
| Automated (TypeScript unit) | `*.test.ts` | Jest/Vitest | Component unit tests for Web |
| Automated (TypeScript integration) | `test-*.ts` | tsx | Data layer integration tests for Web |
| Manual (HTTP) | `*.http` | HTTP client (VS Code REST Client, IntelliJ) | Declarative request/response files |
| Manual (curl) | `*.sh` | Bash | Shell scripts with curl commands |
| Manual (scripts) | `*.py`, `*.sh`, `*.ts` | Python, Bash, tsx | Multi-step manual scenarios |
| Legacy | Various | Not run | Historical tests preserved for reference |

---

## Current directory layout

### API

```
api/
  pytest.ini                              # Test config (testpaths: oss/tests/pytest, ee/tests/pytest)
  oss/tests/
    pytest/                               # Active E2E test suite (155 tests)
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

The target layout applies the organizing principle (runner → type → domain) to every interface. Where an interface has both OSS and EE tests, the same hierarchy is applied under each.

### API

The existing E2E suite moves from `pytest/` root into `pytest/e2e/`. Unit tests are added under `pytest/unit/` organized by the four [boundary layers](testing.boundaries.specs.md). Manual tests are consolidated under `manual/` by format.

```
api/
  pytest.ini                              # testpaths: oss/tests/pytest, ee/tests/pytest
  oss/tests/
    legacy/                               # Old tests, preserved for reference
    manual/
      http/                               # .http files for HTTP client tools
      curl/                               # curl command scripts
      scripts/                            # Python scripts for manual evaluation/SDK testing
    pytest/
      conftest.py
      utils/                              # Shared fixtures (authed_api, accounts, env)
      e2e/                                # E2E tests (existing suite, reorganized from root)
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
      unit/                               # Unit tests by boundary layer
        utils/                            # Layer 1: utils/helpers (pure functions)
          test_*.py
        core/                             # Layer 2: core services (mock ports)
          test_*.py
        adapters/
          db/                             # Layer 3: DAO (mock session)
            test_*.py
          http/                           # Layer 4: routers (in-process)
            test_*.py
      _support/                           # Shared test infrastructure
        fakes.py                          # In-memory port implementations
        builders.py                       # Domain object/DTO factories
        assertions.py                     # Common assertion helpers
  ee/tests/
    manual/
      http/
        billing.http
        auth/*.http
      scripts/
        evaluations/sdk/test_*.py
    pytest/
      unit/
        test_billing_period.py
      e2e/
        (EE-specific E2E tests)
```

**Migration note:** Moving existing E2E tests from `pytest/<domain>/` to `pytest/e2e/<domain>/` requires updating `pytest.ini` testpaths. A simple `mv` + config change; no test code changes.

### SDK

The existing `unit/` and `integration/` directories consolidate under `pytest/`. Integration tests are renamed to `e2e/` for consistency (they test the SDK against a live API -- that is E2E).

```
sdk/
  pytest.ini                              # testpaths: tests/pytest
  tests/
    legacy/                               # Old tests, preserved for reference
    manual/
      http/                               # .http files for SDK endpoint testing
      scripts/                            # Python scripts for manual SDK scenarios
    pytest/
      conftest.py
      utils/                              # Shared fixtures (env, sdk, accounts)
      e2e/                                # SDK E2E (by domain)
        observability/                    # OTLP, trace sending, span capture
          test_observability_traces.py
        evaluations/                      # Evaluation flows, metrics
          test_evaluations_flow.py
        integrations/                     # Secrets, entities, webhooks, events
          test_vault_secrets.py
          test_testsets_manager.py
          test_evaluators_manager.py
          test_prompt_template_storage.py
        collaboration/                    # Messages, threads (future)
        workflows/                        # Custom workflow deployment + invocation
          test_apps_shared_manager.py
          test_legacy_applications_manager.py
        healthchecks/
          test_healthchecks.py
      unit/                               # Unit tests (expanded)
        conftest.py
        test_tracing_decorators.py        # Existing: workflow decorators
        test_managers.py                  # NEW: Manager method logic
        test_init.py                      # NEW: Configuration/initialization
        test_errors.py                    # NEW: Error handling
        test_workflow_decorators.py       # NEW: Route creation, parameter parsing
      _support/                           # Shared test infrastructure
        fakes.py
        builders.py
```

**Migration note:** Moving `tests/unit/` → `tests/pytest/unit/` and `tests/integration/` → `tests/pytest/e2e/` requires updating `pytest.ini` and import paths in conftest files.

### Web

The Web interface uses Playwright as its runner. E2E suites stay split by license (OSS/EE) with numbered feature folders. Component unit tests remain colocated with source code.

```
web/
  tests/                                  # Playwright runner infrastructure
    playwright.config.ts
    playwright/
      config/
      global-setup.ts
      global-teardown.ts
      fixtures/
      scripts/
    guides/
  oss/tests/
    playwright/                           # OSS E2E suites
      1-settings/
      2-app/
      3-playground/
      4-prompt-registry/
      5-testset/
      7-observability/
      8-deployment/
    datalayer/                            # Data layer integration tests
      test-apps.ts
      test-observability.ts
  ee/tests/
    playwright/                           # EE E2E suites
      1-settings/
      2-app/
      3-playground/
      4-prompt-registry/
      5-testset/
      6-auto-evaluation/
      7-observability/
      8-deployment/
      9-human-annotation/
  oss/src/                                # Colocated component unit tests
    components/<Module>/state/atoms/__tests__/*.test.ts
    lib/helpers/__tests__/*.test.ts       # NEW: Pure utility function tests
```

**Migration note:** Numbered suites move from `{oss,ee}/tests/<N>-<feature>/` into `{oss,ee}/tests/playwright/<N>-<feature>/`. Playwright config's `testDir` needs updating accordingly.

### Services

Services already has its own component directory (`services/`) with the same OSS/EE + src/tests pattern. Currently only a manual smoke test exists. The target layout follows the universal structure.

**Current:**
```
services/
  oss/
    src/
      chat.py
      completion.py
    tests/
      manual/
        smoke.http                        # Existing manual smoke test
  ee/
```

**Target:**
```
services/
  oss/tests/
    legacy/                               # (if needed)
    manual/
      http/
        smoke.http                        # Existing
      scripts/
    pytest/
      conftest.py
      utils/                              # Shared fixtures
      e2e/                                # Services E2E (hits /services)
        builtins/                         # Built-in service tests (chat, completion)
        workflows/                        # Custom workflow service tests
      unit/                               # Unit tests (if applicable)
      _support/
  ee/tests/
    pytest/
      e2e/
```

### Docs (future)

Docusaurus documentation site. Testing covers link checking, build validation, and content correctness.

```
docs/tests/
  scripts/
    link-check.sh
    build-verify.sh
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
| Manual HTTP | `<flow>.http` | `billing.http` |
| Manual curl | `<flow>.sh` | `create-workspace.sh` |
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

Manual tests live under `<component>/tests/manual/` (or `<component>/ee/tests/manual/` for EE-specific) and are organized by format:

- **`http/`** -- `.http` files for HTTP client tools (VS Code REST Client, IntelliJ HTTP Client). Declarative request/response format with variables and environments. Used for ad-hoc endpoint testing of auth flows, billing flows, and evaluation interactions.
- **`curl/`** -- Shell scripts containing curl commands. Used when you need shell-level control (piping, variables, loops) or want to share exact curl invocations.
- **`scripts/`** -- Python, shell, or TypeScript scripts for more complex manual scenarios that require programmatic setup, multi-step flows, or data generation.

Manual tests are not automated and not tracked by CI. They serve as developer reference for manually exercising endpoints.
