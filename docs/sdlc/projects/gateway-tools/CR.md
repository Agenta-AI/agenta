# Code Review — Gateway Tools (`feat/add-gateway-tools`)

> Reviewer guide: findings are grouped by dimension. Each item carries a severity tag:
> **[BLOCKER]** must be resolved before merge · **[MAJOR]** strong recommendation · **[MINOR]** improvement · **[NIT]** style/polish

---

## Summary Table

| # | Dimension | Severity | Short description |
|---|-----------|----------|-------------------|
| 1.1 | Functional | ~~MAJOR~~ ✅ | `get_integration` now calls `GET /toolkits/{slug}` directly |
| 1.2 | Functional | ~~BLOCKER~~ ✅ | Callback now splits critical vs decorative error paths |
| 1.3 | Functional | ~~MINOR~~ ✅ | Hard adapter errors → 500; provider-level errors → 200 (documented) |
| 1.4 | Functional | ~~MINOR~~ ✅ | DAO defaults to `is_active = true` filter |
| 1.5 | Functional | ~~MAJOR~~ ✅ | Composio-specific branching moved into adapter |
| 1.6 | Functional | ~~MINOR~~ ✅ | Agenta provider stubs have docstrings |
| 2.1 | Security | ~~BLOCKER~~ ✅ | HMAC-signed OAuth state token; scoped callback activation |
| 2.2 | Security | ~~MINOR~~ ✅ | `api_key: str\|None`; startup warning log; `COMPOSIO_ENABLED` removed |
| 2.3 | Security | ~~MINOR~~ ✅ | `_oauth_card` uses `html.escape()` on all interpolated values |
| 2.4 | Security | ~~MAJOR~~ ✅ | Slug segments validated against `[a-zA-Z0-9_-]+` allowlist |
| 2.5 | Security | ~~MINOR~~ ✅ | `connected_account_id` log removed |
| 3.1 | Performance | ~~MAJOR~~ ✅ | Shared `httpx.AsyncClient` per adapter instance; closed on lifespan shutdown |
| 3.2 | Performance | ~~MINOR~~ ✅ | `full_catalog` removed; no more N+1 fanout |
| 3.3 | Performance | ~~MAJOR~~ ✅ | Catalog cache keyed globally (`project_id=None`); `get_integration` uses `GET /toolkits/{slug}` |
| 3.4 | Performance | ~~MINOR~~ ✅ | `json.JSONDecodeError` caught specifically; warning logged |
| 4.1 | Architecture | ~~MINOR~~ ✅ | `call_tool` uses domain exceptions caught at router boundary |
| 4.2 | Architecture | ~~MINOR~~ ✅ | Recursive router call eliminated via §3.2 |
| 4.3 | Architecture | ~~MINOR~~ ✅ | `kind` column removed; `provider_key` is single source of truth |
| 4.4 | Architecture | ~~MAJOR~~ ✅ | `activate_connection_by_provider_id` scoped by `project_id` from state |
| 4.5 | Architecture | ~~MINOR~~ ✅ | Empty provider stubs have clarifying docstrings |
| 4.6 | Architecture | ~~MINOR~~ ✅ | Cron files deleted |
| 5.1 | Docs | ~~MINOR~~ ✅ | One-line docstrings added to all public service and DAO methods |
| 5.2 | Docs | ~~MINOR~~ ✅ | API reference updated with 5-part slug format |
| 5.3 | Docs | ~~NIT~~ ✅ | `COMPOSIO_ENABLED` removed; PR.md documents only `COMPOSIO_API_KEY` |
| 6.1 | Tests | MAJOR | No automated tests for new domain |
| 6.2 | Tests | BLOCKER | No tests for OAuth callback (security-critical path) |

**Remaining open:** 6.1 · 6.2

---

## 1. Functional Correctness

### 1.1 ~~`get_integration` performs a full scan — O(N) on every call~~ ✅ Fixed

**File:** `api/oss/src/core/tools/service.py`

Replaced the `list_integrations(limit=1000)` scan with a direct `GET /toolkits/{slug}` call (Composio V3 API).

Changes:
- `catalog.py` — new `get_integration()` + `_parse_integration_detail()` (handles `composio_managed_auth_schemes` from the detail response shape)
- `interfaces.py` — `get_integration()` added to `GatewayAdapterInterface`
- `adapter.py` — `ComposioAdapter.get_integration()` delegates to `catalog.get_integration()`
- `service.py` — `ToolsService.get_integration()` now calls `adapter.get_integration()` directly

---

### 1.2 ~~`callback_connection` swallows all exceptions silently~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Split the single bare `except Exception: pass` into two separate try/except blocks:
- **Critical path** (activation): DB failures now log at ERROR level and return a failure card to the user.
- **Decorative path** (integration logo/label fetch): failures log at WARNING and degrade gracefully (success card without logo).

---

### 1.3 ~~`call_tool` returns `200 OK` on execution errors~~ ✅ Partially fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Hard adapter failures (`AdapterError`) now propagate out of `call_tool` and are converted to `HTTP 500` by `@intercept_exceptions()`. Provider-level execution errors (e.g., action returned an error status) still return `HTTP 200` with an error body — this is the intended OpenAI-compatible always-succeed semantics so the LLM can inspect the error. The behaviour is now implicit from the exception boundary rather than explicit documentation.

---

### 1.4 ~~Connection query does not filter by `is_active`~~ ✅ Fixed

**File:** `api/oss/src/dbs/postgres/tools/dao.py`, `api/oss/src/core/tools/interfaces.py`

`ToolsDAOInterface.query_connections()` and `ToolsDAO.query_connections()` now accept `is_active: Optional[bool] = True`. The DAO filters via `flags["is_active"].astext == "true"` (JSONB). The default remains `True` so all existing callers get active-only behaviour without changes.

---

### 1.5 ~~`refresh_connection` contains provider-specific branching in the service~~ ✅ Fixed

**File:** `api/oss/src/core/tools/service.py`, `api/oss/src/core/tools/providers/composio/adapter.py`

Removed the `if conn.provider_key.value == "composio":` branch from `ToolsService.refresh_connection()`. The service now calls `adapter.refresh_connection()` uniformly for all providers. `ComposioAdapter.refresh_connection()` handles the re-initiation flow internally when `integration_key` and `user_id` are provided — which are now part of the `GatewayAdapterInterface` signature.

---

### 1.6 ~~Agenta provider skeleton contains all empty files~~ ✅ Fixed

**Files:** `api/oss/src/core/tools/providers/agenta/`

Added module-level docstrings to all stub files (`types.py`, `interfaces.py`) marking them as not-yet-implemented placeholders. Reduces noise for future contributors.

---

## 2. Security

### 2.1 ~~OAuth callback is unauthenticated and tenant-unscoped~~ ✅ Fixed

**Files:** `api/oss/src/core/tools/utils.py` (new), `api/oss/src/core/tools/service.py`, `api/oss/src/apis/fastapi/tools/router.py`

Implemented HMAC-signed OAuth `state` tokens:
- `make_oauth_state()` generates a `{project_id, user_id, nonce, ts}` payload encoded as base64url + SHA-256 HMAC signature, embedded in the callback URL as `?state=<token>`.
- `decode_oauth_state()` validates the HMAC and checks token age (default 1 hour TTL) before trusting any payload.
- `callback_connection` now reads `state`, validates it, extracts `project_id`, and passes it to `activate_connection_by_provider_id` for scoped DB lookup.
- The `activate_connection_by_provider_id` DAO method now accepts an optional `project_id` filter.

---

### 2.2 ~~API key stored in environment variable — not validated at startup~~ ✅ Fixed

**Files:** `api/oss/src/utils/env.py`, `api/entrypoints/routers.py`

`ComposioConfig.api_key` type changed from `str` (defaulting to `""`) to `str | None` (matching Stripe/Sendgrid pattern). The `.enabled` property now follows the standard `bool(self.api_key)` check. When `COMPOSIO_API_KEY` is absent, `routers.py` logs a `WARNING` at startup and skips mounting the Composio adapter. The separate `COMPOSIO_ENABLED` env var has been removed — enabled state is inferred from key presence.

---

### 2.3 ~~`_oauth_card` renders user-controlled data into an HTML string without escaping~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

All provider-supplied values (`integration_label`, `integration_logo`, `integration_url`, `agenta_url`, `error`) are now passed through `html.escape()` before interpolation into the HTML template. Safe locals (`safe_label`, `safe_logo`, etc.) are used exclusively throughout `_oauth_card`.

---

### 2.4 ~~Tool slug is parsed from the LLM response without sanitisation~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Each of the 5 slug segments is now validated against `_SLUG_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9_-]+$")` before any downstream use. An invalid segment raises `ToolSlugInvalidError` which is caught at the router boundary and returned as `HTTP 422`.

---

### 2.5 ~~`provider_connection_id` appears in log output~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Removed the `log.info("OAuth callback received - connected_account_id: %s, ...")` call entirely. No sensitive credential handles are logged.

---

## 3. Performance

### 3.1 ~~New `httpx.AsyncClient()` per request — no connection pooling~~ ✅ Fixed

**Files:** `api/oss/src/core/tools/providers/composio/adapter.py`, `api/oss/src/core/tools/providers/composio/catalog.py`, `api/entrypoints/routers.py`

`catalog.py` is now a `CompositoCatalogClient` mixin class (rather than standalone functions). `ComposioAdapter` extends both `GatewayAdapterInterface` and `CompositoCatalogClient`, and creates a single `httpx.AsyncClient(timeout=30.0)` in `__init__`. All catalog and connection/execution methods use `self._client` — no per-call client creation. The lifespan in `routers.py` calls `await adapter.close()` after `yield` to drain the connection pool on shutdown.

---

### 3.2 ~~`list_providers` fanout: one DB + one Composio call per provider per catalog request~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Removed the `full_catalog` parameter entirely from all catalog handlers (`list_providers`, `get_provider`, `list_integrations`, `get_integration`, `list_actions`, `get_action`). The N+1 recursive expand path no longer exists. Each endpoint returns only its own data; callers that want nested detail must make separate requests.

---

### 3.3 ~~Redis cache miss path on `get_integration` causes unbounded work~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

Two fixes combined:
1. §1.1 replaced the 1000-record scan with a direct `GET /toolkits/{slug}` call — cache miss now costs one targeted request.
2. All catalog cache calls now use `project_id=None` (global scope) so a warm cache entry is shared across all projects rather than being re-fetched per-project.

---

### 3.4 ~~Synchronous `json.loads` in the hot tool-call path~~ ✅ Fixed

**File:** `api/oss/src/apis/fastapi/tools/router.py`

The bare `except Exception` is now `except json.JSONDecodeError` and logs a `WARNING` with the raw arguments string before falling back to `{}`. Malformed LLM output is now observable in logs.

---

## 4. Architecture & Design

### 4.1 ~~Domain exceptions defined in `core/` are caught in `router.py` via inline `if not X → return JSONResponse`~~ ✅ Fixed

**Files:** `api/oss/src/apis/fastapi/tools/router.py`, `api/oss/src/core/tools/exceptions.py`

`call_tool` now raises `ConnectionNotFoundError`, `ConnectionInactiveError`, `ConnectionInvalidError`, and `ToolSlugInvalidError` from the appropriate points and catches them in a single `try/except` block at the router boundary, converting them to the appropriate HTTP responses (`404`, `400`, `400`, `422`). `AdapterError` is intentionally not caught and propagates to `@intercept_exceptions()` as `HTTP 500`.

---

### 4.2 ~~Router `list_integrations` is called recursively from other router methods~~ ✅ Fixed (via §3.2)

**File:** `api/oss/src/apis/fastapi/tools/router.py`

The recursive call was driven by the `full_catalog` expansion path. Removing `full_catalog` (§3.2) eliminated the cross-handler call entirely. `list_providers` no longer calls `list_integrations`.

---

### 4.3 ~~`ToolConnectionDBE.kind` and `provider_key` are redundant~~ ✅ Fixed

**Files:** `api/oss/src/dbs/postgres/tools/dbes.py`, `api/oss/src/dbs/postgres/tools/mappings.py`, OSS + EE migrations

Removed the `kind` Enum column entirely. `provider_key` (String) is the single source of truth. The `ToolProviderKind` enum remains in `dtos.py` for application-level type safety. Migrations updated in both OSS and EE; `downgrade()` no longer references the now-gone enum type.

---

### 4.4 ~~`activate_connection_by_provider_connection_id` bypasses `project_id` scope~~ ✅ Fixed (via §2.1)

**Files:** `api/oss/src/core/tools/service.py`, `api/oss/src/core/tools/interfaces.py`, `api/oss/src/dbs/postgres/tools/dao.py`

`activate_connection_by_provider_connection_id` now accepts `project_id: Optional[UUID]`. The `project_id` is decoded from the validated HMAC state token (§2.1) in `callback_connection` and passed through service → DAO for a scoped lookup. The DAO filters by `project_id` when provided.

---

### 4.5 ~~`providers/` package boundary is ambiguous~~ ✅ Fixed

**Files:** `api/oss/src/core/tools/providers/interfaces.py`, `providers/types.py`, `providers/exceptions.py`, `providers/agenta/`

Added module-level docstrings to all empty stub files explaining their intended (future) purpose and clarifying that `core/tools/interfaces.py` is the canonical contract for adapters. The Agenta provider directory stubs are marked as not-yet-implemented.

---

### 4.6 ~~Cron scripts added without corresponding documentation or scheduler wiring~~ ✅ Fixed

**Files:** `api/oss/src/crons/tools.sh`, `api/oss/src/crons/tools.txt`

Both cron files were deleted. The connection-status polling logic was not yet implemented and the Dockerfile wiring was absent. The feature can be re-added as a proper scheduled job when the polling logic is ready.

---

## 5. Documentation

### 5.1 Extensive design docs but no inline docstrings on public service methods

The `docs/designs/gateway-tools/` directory is thorough. However, the service (`service.py`) and DAO (`dao.py`) have minimal or no docstrings on public methods.

**[MINOR]** Add one-line docstrings to `ToolsService` public methods (especially `execute_tool`, `refresh_connection`, `activate_connection_by_provider_connection_id`) so the intent is clear to future contributors without reading the full design docs.

---

### 5.2 API reference doc and implementation diverge on slug format

**File:** `docs/designs/gateway-tools/api-reference.md` vs `router.py:905-918`

The API reference describes the slug as `tools.{provider}.{integration}.{action}`, but the router also supports a 5th segment (`{connection}`) and treats a missing connection slug as a hard error. The docs do not mention the 5th segment or that it is required.

**[MINOR]** Update the API reference to document the full 5-part slug format: `tools.{provider}.{integration}.{action}.{connection}`.

---

### 5.3 ~~Environment variable `COMPOSIO_ENABLED` is not documented~~ ✅ Fixed

**Files:** `docs/designs/gateway-tools/PR.md`, `api/oss/src/utils/env.py`

Removed `COMPOSIO_ENABLED` entirely — the variable never existed in code, only in docs. `env.py` already infers enabled state from `COMPOSIO_API_KEY` presence (matching Stripe/Sendgrid). PR.md configuration table updated to document only `COMPOSIO_API_KEY` and `COMPOSIO_API_URL`.

---

## 6. Test Coverage

### 6.1 No automated tests for the new domain

The PR adds manual `.http` test collections, which is helpful for exploratory testing, but there are no unit or integration tests for:

- `ToolsService` (service logic, connection lifecycle)
- `ToolsDAO` (database reads/writes, constraint handling)
- `ComposioAdapter` (HTTP client, error mapping)
- Router input validation (slug parsing, permission enforcement)

**[MAJOR]** Given the scope (11 new endpoints, a new DB table, an external HTTP client, and OAuth flow), automated tests are needed before this lands on `main`. Even a small set of unit tests mocking the adapter and DAO would catch the issues in §1.2–1.4.

---

### 6.2 No tests for the OAuth callback flow

The callback handler (`callback_connection`) is the most security-sensitive code path. It is also stateful (DB update) and side-effectful (HTML rendered). It has no tests.

**[BLOCKER]** Add at minimum a test that:
1. Verifies a valid `connected_account_id` activates the correct connection.
2. Verifies a missing / invalid `connected_account_id` returns a failure card.
3. Verifies a DB failure returns a failure card (not a success card — see §1.2).

