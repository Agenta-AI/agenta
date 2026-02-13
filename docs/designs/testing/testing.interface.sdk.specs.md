# SDK Testing — Interface Specification

The SDK interface is the Python package (`agenta`) consumed by end users to interact with Agenta programmatically. This document describes the current test state, target state, and conventions specific to the SDK.

For architectural layer definitions, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For dimension/marker taxonomy, see [testing.dimensions.specs.md](testing.dimensions.specs.md).
For folder layout, see [testing.structure.specs.md](testing.structure.specs.md).
For fixtures and utilities, see [testing.fixtures.specs.md](testing.fixtures.specs.md).

---

## Current state

### Unit tests (`sdk/tests/unit/`)

**Coverage:**
- `test_tracing_decorators.py` — Comprehensive tests for SDK tracing decorators
  - Sync functions, async functions, generators, async generators
  - Mock-based: mocks `ag.tracer` and `ag.tracing` to isolate decorator logic
  - Test classes: `TestExistingFunctionality`, `TestGeneratorTracing`, `TestAsyncGeneratorTracing`

**Supporting docs (in-tree):**
- `sdk/tests/unit/README.md` — Quick start, running tests, adding new tests
- `sdk/tests/unit/TESTING_PATTERNS.md` — Testing approaches and patterns

### Integration tests (`sdk/tests/integration/`)

Tests exercise SDK manager methods against a running Agenta API. These are SDK-level E2E tests that validate the SDK's HTTP client layer, serialization, and API contract.

**Domains covered:**
- `applications/` — `test_apps_shared_manager.py` (913+ lines): comprehensive sync/async CRUD, response serialization, error handling, concurrent operations
- `evaluations/` — `test_evaluations_flow.py`: evaluation flow tests
- `evaluators/` — Evaluator CRUD tests
- `prompts/` — Prompt management tests
- `testsets/` — Testset CRUD tests
- `tracing/` — `test_observability_traces.py`: trace integration tests
- `vault/` — Vault/secrets tests

**Fixture infrastructure (`sdk/tests/integration/conftest.py`):**

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `api_credentials` | session | Reads `AGENTA_HOST` (default: `https://cloud.agenta.ai`) and `AGENTA_API_KEY`. Skips test if missing. |
| `agenta_init` | function | Initializes SDK with `ag.init()` and forces httpx client rebinding for async test compatibility |
| `test_app` | function | Creates app via `AppManager.create()`, yields `{app_id, app_slug}`, cleans up on teardown |
| `test_variant` | function | Creates variant via `SharedManager.add()`, yields `{variant_slug, variant_id, app_id}`, cleans up |
| `otlp_flat_span_factory` | session | Factory for `OTelFlatSpanInput` objects |
| `deterministic_testset_name` | session | Returns `"sdk-it-testset-v1"` to avoid test resource proliferation |
| `deterministic_evaluator_slug` | session | Returns `"sdk-it-evaluator-v1"` |

**Credential management:**
- `_skip_integration_if_missing_credentials` (autouse) — Skips tests marked `@pytest.mark.integration` when `AGENTA_API_KEY` is not set
- `requires_credentials` — Skip decorator for non-marker-based conditional skipping

### Smoke/healthcheck tests (`sdk/tests/pytest/`)

- `healthchecks/test_healthchecks.py` — Basic API connectivity and auth validation
- Uses the same fixture/marker system as the API tests (`ag_env`, `authed_api`, `unauthed_api`, account fixtures)

### Legacy tests (`sdk/tests/legacy/`)

Multiple legacy test suites covering annotations, baggage, custom workflows, debugging, management, observability, redact, routing. Not operational.

### Configuration

- **Config file:** `sdk/pytest.ini`
- **Test paths:** `tests/pytest`
- **Async mode:** `auto`
- **Markers:** Identical to API markers (see [testing.dimensions.specs.md](testing.dimensions.specs.md))
- **Dev dependencies:** `pytest ^9`, `pytest-asyncio ^1`, `pytest-xdist ^3`

---

## Unit / E2E split

The SDK follows the same universal structure as all interfaces: `utils/`, `unit/`, `e2e/`. The dividing line is whether a test needs the backend running.

### E2E (requires backend)

E2E tests validate the SDK against the real system. They exercise the HTTP client layer, serialization, and API contract end-to-end.

**Domains:**

| Domain | What it tests | Examples |
|--------|--------------|---------|
| **Observability** | OTLP trace sending, span capture, trace querying | Send traces via SDK, confirm they appear in the system |
| **Evaluations** | Evaluation SDK flows end-to-end | Run evaluations, write metrics, fetch results, confirm correctness |
| **Integrations** | Pull: fetching secrets, entities, configs. Push: webhooks, notifications, events | Vault secrets CRUD, entity fetching, event delivery |
| **Collaboration** | Messages, threads, annotations (future) | Thread creation, message posting |
| **Workflows** | Custom workflow deployment and invocation requiring platform access | Workflows that need secrets, tracing hooks, or evaluation hooks |
| **Healthchecks** | Connectivity and auth validation | Basic API reachability |

### Unit (no backend)

Unit tests run without the system. Anything that can be tested in isolation belongs here.

**What goes in unit:**
- Workflow decorator behavior (`@ag.workflow`, `@ag.route`, `@ag.instrument`) — stateless, no authorization needed
- Route registration and parameter parsing
- Manager method logic (request construction, response parsing) — mock `httpx` transport or Fern client
- Configuration/initialization (`ag.init()`) — parameter combinations, env var handling, singleton behavior
- Error handling — SDK error mapping from HTTP status codes to SDK exceptions
- Retry/timeout logic — mocked transport returning errors
- In some cases, workflows can run in a subprocess without the full system

**What to mock:**
- Mock `httpx` transport or the Fern-generated client (`AgentaApi`, `AsyncAgentaApi`), not the SDK's public API surface.
- For workflow decorators: mock `ag.tracer` and `ag.tracing` to isolate decorator logic.
- Test both sync and async code paths.

---

## Target state

### E2E

Organize by domain:

```
sdk/tests/pytest/e2e/
  observability/              # OTLP, trace sending, span capture
  evaluations/                # Evaluation flows, metrics
  integrations/               # Secrets, entities, webhooks, events
  collaboration/              # Messages, threads (future)
  workflows/                  # Custom workflow deployment + invocation
  healthchecks/               # Connectivity
```

### Unit

Expand beyond tracing decorators:

```
sdk/tests/pytest/unit/
  test_tracing_decorators.py  # Existing: workflow decorators
  test_workflow_decorators.py  # Route creation, parameter parsing
  test_managers.py             # Manager method logic (mock HTTP)
  test_init.py                 # Configuration/initialization
  test_errors.py               # Error handling
```

---

## Conventions

### Test class naming

Follow the established pattern in `test_tracing_decorators.py`:
- `TestExistingFunctionality` — Tests for known working behavior
- `TestGeneratorTracing` — Tests for specific feature area
- `TestAsyncGeneratorTracing` — Tests for async variant of feature

### Mock setup

```python
@pytest.fixture
def mock_tracer(mocker):
    return mocker.patch("agenta.sdk.decorators.tracing.ag.tracer")
```

### Integration test naming

- Use `sdk-it-` prefix for deterministic test resource names to avoid proliferation
- Examples: `sdk-it-testset-v1`, `sdk-it-evaluator-v1`

### SDK reinitialization

Integration tests must force-reinitialize the SDK per test function to avoid stale httpx client references across event loops. The `agenta_init` fixture handles this via `_force_reinit_sdk()`.

---

## Environment

| Variable | Required for | Default | Purpose |
|----------|-------------|---------|---------|
| `AGENTA_API_KEY` | Integration tests | None (test skips if missing) | API authentication |
| `AGENTA_HOST` | Integration tests | `https://cloud.agenta.ai` | API base URL |

---

## Running tests

```bash
# All SDK tests (unit + E2E, E2E skips if no credentials)
cd sdk && pytest tests/pytest/ -v

# Unit tests only
cd sdk && pytest tests/pytest/unit/ -v

# E2E tests only (requires credentials)
AGENTA_API_KEY=... AGENTA_HOST=... cd sdk && pytest tests/pytest/e2e/ -v

# Specific E2E domain
AGENTA_API_KEY=... cd sdk && pytest tests/pytest/e2e/observability/ -v

# Specific test class
cd sdk && pytest tests/pytest/unit/test_tracing_decorators.py::TestGeneratorTracing -v

# With coverage
cd sdk && pytest tests/pytest/unit/ --cov=agenta.sdk --cov-report=html
```

---

## References

- `sdk/tests/unit/README.md` — Quick start for SDK unit tests
- `sdk/tests/unit/TESTING_PATTERNS.md` — Detailed testing patterns and module-specific guidance
