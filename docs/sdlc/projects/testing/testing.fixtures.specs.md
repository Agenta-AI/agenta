# Testing Fixtures --- Shared Test Infrastructure

This document describes the reusable test utilities, fixtures, and support infrastructure across the monorepo. It covers per-interface fixtures, shared support utilities, account management, and fixture scoping rules.

For per-interface specifics, see [testing.interface.api.specs.md](testing.interface.api.specs.md), [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md), [testing.interface.web.specs.md](testing.interface.web.specs.md).
For folder layout of test support files, see [testing.structure.specs.md](testing.structure.specs.md).

---

## API fixtures

Defined in `api/oss/tests/pytest/utils/` and imported via `api/oss/tests/pytest/conftest.py`.

### Environment (`utils/env.py`)

| Fixture | Scope | Source | Returns |
|---------|-------|--------|---------|
| `ag_env` | session | `AGENTA_API_URL`, `AGENTA_AUTH_KEY` env vars | `{"api_url": str, "auth_key": str}` |

Asserts both variables are set. Fails fast if missing.

### API clients (`utils/api.py`)

| Fixture | Scope | Depends on | Returns |
|---------|-------|-----------|---------|
| `unauthed_api` | session | `ag_env` | Callable `(method, endpoint, **kwargs) -> Response` |
| `authed_api` | class | `cls_account` | Callable `(method, endpoint, **kwargs) -> Response` with `Authorization` header |

- `unauthed_api` uses a shared `requests.Session`. Session is closed after all tests.
- `authed_api` injects `Authorization: <credentials>` header from the account fixture. Does not use a shared session.
- Both use `BASE_TIMEOUT = 10` seconds (from `utils/constants.py`).

### Account fixtures (`utils/accounts.py`)

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `cls_account` | class | Creates a test account, shared within a test class |
| `mod_account` | module | Creates a test account, shared across classes in a module |
| `foo_account` | function | Creates a test account per test function (full isolation) |

All three call `create_account(ag_env)` which:
1. POSTs to `/admin/account` with `Authorization: Access <auth_key>` header
2. Extracts `credentials` from the first scope in the response
3. Returns `{"api_url": str, "credentials": str}`

---

## SDK fixtures

Defined in `sdk/tests/integration/conftest.py`.

### Credential management

| Fixture/Helper | Type | Purpose |
|----------------|------|---------|
| `get_api_credentials()` | Function | Returns `(host, api_key)` from `AGENTA_HOST` (default: `https://cloud.agenta.ai`) and `AGENTA_API_KEY` |
| `credentials_available()` | Function | Returns `bool` --- whether `AGENTA_API_KEY` is set |
| `_skip_integration_if_missing_credentials` | autouse fixture | Skips tests marked `@pytest.mark.integration` when credentials are missing |
| `requires_credentials` | Skip marker | `@pytest.mark.skipif` decorator for non-marker-based skipping |
| `api_credentials` | session fixture | Returns `(host, api_key)`. Skips test if credentials are missing. |

### SDK initialization

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `agenta_init` | function | Calls `ag.init(host, api_key)` then `_force_reinit_sdk()` to rebind httpx clients to the current event loop |

`_force_reinit_sdk()` resets the `AgentaSingleton`'s `api` and `async_api` clients by creating new `AgentaApi` and `AsyncAgentaApi` instances. This is necessary because `pytest-asyncio` creates a new event loop for async tests, making previously-bound httpx clients stale.

### Resource management

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `test_app` | function | Creates app via `AppManager.create()`, yields `{app_id, app_slug, response}`, deletes on teardown |
| `test_variant` | function | Creates variant via `SharedManager.add()`, yields `{variant_slug, variant_id, app_id, app_slug, response}`, deletes on teardown |
| `unique_app_slug` | function | Returns `f"test-app-{uuid4().hex[:8]}"` |
| `unique_variant_slug` | function | Returns `f"test-variant-{uuid4().hex[:8]}"` |
| `deterministic_testset_name` | session | Returns `"sdk-it-testset-v1"` --- deterministic to avoid proliferation |
| `deterministic_evaluator_slug` | session | Returns `"sdk-it-evaluator-v1"` |
| `deterministic_legacy_application_slug` | session | Returns `"sdk-it-legacy-app-v1"` |

### Cleanup helpers

| Helper | Purpose |
|--------|---------|
| `cleanup_app_safe(app_id)` | Deletes app, catches and logs errors |
| `cleanup_variant_safe(variant_id, variant_slug, app_id)` | Deletes variant, catches and logs errors |

### OTLP support

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `otlp_flat_span_factory` | session | Returns `make_otlp_flat_span()` factory for creating `OTelFlatSpanInput` objects |

---

## Web fixtures

Defined in `web/tests/tests/fixtures/`.

### Base fixture (`base.fixture/`)

| Helper | Purpose |
|--------|---------|
| `apiHelpers/` | API request utilities for test setup/teardown |
| `uiHelpers/` | DOM interaction helpers (click, fill, wait) |
| `llmKeysSettingsHelpers/` | LLM provider key configuration |

### User fixture (`user.fixture/`)

| Helper | Purpose |
|--------|---------|
| `authHelpers/` | Authentication flows --- email/password account creation and login |

### Session fixture (`session.fixture/`)

Manages browser session persistence via `state.json` storage state. Used by Playwright for authenticated test sessions.

### Global setup/teardown

- `web/tests/playwright/global-setup/` --- Runs before all tests: creates accounts, sets up auth state
- `web/tests/playwright/global-teardown/` --- Runs after all tests: cleanup

---

## Support utilities (target)

The `_support/` directory pattern provides shared test helpers. Target structure for API and SDK:

```
tests/_support/
  fakes.py          # In-memory fake implementations of ports/interfaces
  builders.py       # Factory functions for domain objects and DTOs
  assertions.py     # Common assertion helpers (e.g., assert_has_attr)
```

### Fakes

In-memory implementations of DAO interfaces (ports) are provided for Core unit tests. They store data in dicts/lists, support create/read/update/delete operations, and return realistic domain objects. They do not depend on SQLAlchemy, asyncpg, or any DB infrastructure.

### Builders

Factory functions create domain objects with sensible defaults:
```python
def build_workflow(*, slug="test", name="Test Workflow", **overrides):
    return Workflow(slug=slug, name=name, **overrides)
```

### Assertions

Reusable assertion helpers are provided for common patterns:
```python
def assert_has_attr(obj, attr_name):
    assert hasattr(obj, attr_name), f"{type(obj).__name__} missing attribute '{attr_name}'"
```

---

## Account management

Both API and SDK tests create test accounts programmatically:

- **API tests:** POST to `/admin/account` with `Authorization: Access <AGENTA_AUTH_KEY>`. Returns scoped credentials. Different fixture scopes (class/module/function) control account reuse.
- **SDK integration tests:** Use `AGENTA_API_KEY` directly. No account creation --- the key is pre-provisioned.

---

## Fixture scoping rules

| Scope | Pytest | When to use |
|-------|--------|-------------|
| `session` | Once per test run | Environment variables, shared HTTP sessions, read-only configuration |
| `module` | Once per `.py` file | Account/resource setup shared across multiple test classes |
| `class` | Once per test class | Account/resource setup shared within a class (`TestXxxBasics`) |
| `function` | Once per test | Full isolation --- tests that mutate state or need unique resources |

**Guidelines:**
- The broadest scope that does not cause test interference is preferred.
- Account fixtures should match the scope of the test class using them (typically `class`).
- Resources that tests mutate should be `function`-scoped.
- `yield`-based fixtures are preferred for cleanup over `try/finally` (unless cleanup needs the fixture value after yield).
