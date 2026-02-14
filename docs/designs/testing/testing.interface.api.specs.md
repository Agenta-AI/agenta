# API Testing — Interface Specification

The API interface is the FastAPI HTTP layer consumed by the SDK, Web frontend, and third-party integrations. This document describes the current test state, target state, and conventions specific to the API.

For architectural layer definitions, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For dimension/marker taxonomy, see [testing.dimensions.specs.md](testing.dimensions.specs.md).
For folder layout, see [testing.structure.specs.md](testing.structure.specs.md).
For fixtures and utilities, see [testing.fixtures.specs.md](testing.fixtures.specs.md).

---

## Current state

### E2E test suite (`api/oss/tests/pytest/`)

The existing test suite is E2E/system-level: tests make HTTP requests to a running API backed by a real database.

**Test domains covered (155 tests):**

| Domain | Test files | Scope |
|--------|-----------|-------|
| Workflows | `test_workflows_basics.py`, `test_workflows_queries.py`, `test_workflows_retrieve.py`, `test_workflow_variants_basics.py`, `test_workflow_variants_queries.py`, `test_workflow_revisions_basics.py`, `test_workflow_revisions_queries.py`, `test_workflow_lineage.py` | CRUD, variants, revisions, lineage, retrieve |
| Evaluations | `test_evaluation_runs_basics.py`, `test_evaluation_runs_queries.py`, `test_evaluation_scenarios_basics.py`, `test_evaluation_scenarios_queries.py`, `test_evaluation_steps_basics.py`, `test_evaluation_steps_queries.py`, `test_evaluation_metrics_basics.py`, `test_evaluation_metrics_queries.py` | Runs, scenarios, steps, metrics |
| Testsets | `test_testsets_basics.py`, `test_testsets_queries.py`, `test_testsets_files.py`, `test_testcases_basics.py` | Testsets, testcases, file uploads |
| Evaluators | `test_evaluators_basics.py`, `test_evaluators_queries.py` | CRUD, queries |
| Annotations | `test_annotations_basics.py`, `test_annotations_queries.py` | CRUD, queries |
| Tracing | `test_traces_basics.py`, `test_spans_basics.py`, `test_spans_queries.py` | Traces, spans |
| Healthchecks | `test_healthchecks.py` | Connectivity |

### EE test suite (`api/ee/tests/pytest/`)

- `test_billing_period.py` — Multivariate tests for `compute_billing_period()` (12 months x 7 days x various anchors, including leap year edge cases).

### Legacy tests (`api/oss/tests/legacy/`)

54 Python test files. Not operational — excluded from `api/pytest.ini` test paths. Kept for reference.

### Manual tests (`api/ee/tests/manual/`)

`.http` files for manual testing of billing and auth flows. Not automated.

### Configuration

- **Config file:** `api/pytest.ini`
- **Test paths:** `oss/tests/pytest`, `ee/tests/pytest`
- **Async mode:** `auto` (via `pytest-asyncio`)
- **Markers:** See [testing.dimensions.specs.md](testing.dimensions.specs.md) for the full marker list.

### Fixtures

See [testing.fixtures.specs.md](testing.fixtures.specs.md) for full details. Key fixtures:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `ag_env` | session | Reads `AGENTA_API_URL` and `AGENTA_AUTH_KEY` from environment |
| `unauthed_api` | session | Pre-configured `requests.Session` for unauthenticated endpoints |
| `authed_api` | class | Pre-configured request function with `Authorization` header |
| `cls_account` | class | Creates a test account via `POST /admin/account` |
| `mod_account` | module | Module-scoped test account |
| `foo_account` | function | Function-scoped test account |

---

## Target state

Apply the full [test pyramid](testing.principles.specs.md) to the API:

### Layer 1: Utils/helpers unit tests

**Location:** `api/oss/tests/pytest/unit/utils/`

**Targets:**
- Parsing/formatting utilities in `api/oss/src/apis/fastapi/shared/utils.py`
- Pagination helpers in `api/oss/src/dbs/postgres/shared/utils.py`
- Normalization helpers in domain-specific `utils.py` files
- Error mapping utilities

**Pattern:** `pytest.mark.parametrize` with input/output pairs.

### Layer 2: Core service unit tests

**Location:** `api/oss/tests/pytest/unit/core/`

**Targets:**
- Services in `api/oss/src/core/<domain>/service.py`
- Test with fake DAO port implementations (in-memory dicts)
- Verify invariants, orchestration, domain error mapping

**Pattern:** Inject fakes for all ports. Use `pytest/_support/fakes.py` for shared fake implementations.

### Layer 3: DAO unit tests

**Location:** `api/oss/tests/pytest/unit/adapters/db/`

**Targets:**
- DAOs in `api/oss/src/dbs/postgres/<domain>/dao.py`
- Mock `AsyncSession`
- Verify statement construction, bound parameters, row mapping, exception mapping

**Pattern:** Two assertion styles per [testing.boundaries.specs.md](testing.boundaries.specs.md): fake session or Postgres dialect compilation.

### Layer 4: Router unit tests

**Location:** `api/oss/tests/pytest/unit/adapters/http/`

**Targets:**
- Routers in `api/oss/src/apis/fastapi/<domain>/router.py`
- Override FastAPI dependencies with mocked Core services
- Test in-process via `httpx.AsyncClient`

**Pattern:** Build minimal FastAPI app, mount route under test, override dependencies.

### Layer 5: E2E tests (existing)

The current E2E suite in `api/oss/tests/pytest/` moves to `api/oss/tests/pytest/e2e/` for consistency with the runner → type → domain hierarchy. See [testing.structure.specs.md](testing.structure.specs.md) for the full target layout.

---

## Mocking guidance (API-specific)

| Layer | Mock target | What to assert |
|-------|------------|----------------|
| Core | DAO interface (port) | Return values, side effects, domain errors |
| DAO | `AsyncSession` | Statement shape, bound params, call sequence, row mapping |
| Router | Core service | Status codes, response shapes, error mapping |
| E2E | Nothing | Full stack behavior |

---

## Conventions

### Test class naming

Follow the established pattern:
- `TestXxxBasics` — CRUD operations (create, read, update, delete, list)
- `TestXxxQueries` — Filtering, pagination, search
- `TestXxxLineage` — Revision/variant lineage (for git-pattern resources)

### Test method structure

Use ARRANGE/ACT/ASSERT comment sections:
```python
def test_create_workflow(self, authed_api):
    # ARRANGE
    payload = {"slug": "test-workflow", "name": "Test Workflow"}

    # ACT
    response = authed_api("POST", "/api/workflows", json=payload)

    # ASSERT
    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "test-workflow"
```

### Fixture scoping

- `session` — Environment setup, shared across all tests
- `class` — Account/resource setup shared within a test class
- `module` — Account/resource setup shared across classes in a module
- `function` — Per-test isolation (use for tests that mutate state)

---

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `AGENTA_API_URL` | Yes | Base URL of the running API |
| `AGENTA_AUTH_KEY` | Yes | Admin key for creating test accounts |

---
