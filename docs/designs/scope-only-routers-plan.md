# Scope-Only Routers + Access Router Migration — Plan

Status: PROPOSED (no edits applied). For review before execution.

## Goal (per user)

Make `oss/src/routers/` and `ee/src/routers/` (and the matching `services/`)
**scope-only**: organizations, workspaces, projects, users, api_keys. Everything
else moves out or is removed.

Non-scope things currently in `routers/`:
1. **health** (`oss/src/routers/health_router.py`) — inline into entrypoints.
2. **permissions** (`oss/src/routers/permissions_router.py`) — move to the new
   `oss/src/apis/fastapi/access/` structure, mirroring EE's `access` router, and
   change the path `/permissions/verify` → `/access/permissions/check`.

Decisions locked:
- **Path: new only, no alias.** Update all in-repo callers in the same change.
- **Fern client + API reference regeneration: handled by the user**, not here.
  So we do NOT touch `web/packages/agenta-api-client` generated files.

## Scope of THIS change (API side)

### 1. Health → inline into entrypoints
- Add `@app.get("/health/", ...)` (or `/health`) directly in
  `entrypoints/routers.py` returning `{"status": "ok"}` (status 200,
  operation_id `health_check`, tag `Status`).
- Remove the `health_router` import + its `include_router` mount
  (entrypoints/routers.py:1139).
- Delete `oss/src/routers/health_router.py`.
- (9-line file, zero deps — trivial.)

### 2. Permissions → OSS `apis/fastapi/access/` + new path
- Create `oss/src/apis/fastapi/access/router.py` with an `AccessRouter` class
  (mirror EE's `AccessRouter`: `self.router = APIRouter()`,
  `add_api_route(...)`, `@intercept_exceptions()`).
  - Route: `GET /permissions/check` (operation_id `check_permissions`), so
    mounted under the `/access` prefix it becomes **`/access/permissions/check`**.
  - Move the `Allow`/`Deny` classes + the `verify_permissions` handler body
    (rename handler → `check_permissions`) verbatim; keep the `is_oss()` →
    Allow / `is_ee()` → real-check behavior unchanged.
  - Keep the conditional EE imports (`check_action_access`, `check_entitlements`,
    `Permission`, `Counter`) exactly as today — handler works OSS-standalone.
  - Add `__init__.py` to `oss/src/apis/fastapi/access/`.
- Mount in `entrypoints/routers.py`: instantiate `AccessRouter()` and
  `app.include_router(access_router.router, prefix="/access", tags=["Access"])`.
  - **Coexistence:** EE's `extend_main` also mounts its `access_router` at
    `/access` (`/access/plans`, `/access/roles`). FastAPI merges routers on the
    same prefix, so OSS `/access/permissions/check` + EE `/access/plans|roles`
    all coexist when EE runs; OSS-only has just `/access/permissions/check`.
    (No collision: distinct subpaths.)
- Remove the old `permissions_router` import + mount
  (entrypoints/routers.py:1145, prefix `/permissions`).
- Delete `oss/src/routers/permissions_router.py`.

### 3. In-repo callers of the old path (update to new path)
- **Throttle map** `ee/src/core/access/entitlements/types.py:174`:
  `(Method.ANY, "/permissions/verify")` → `(Method.ANY, "/access/permissions/check")`
  (keep it in the SERVICES_FAST category, same as today).
- **Python SDK** (in-repo):
  - `sdks/python/agenta/sdk/middlewares/running/vault.py:130,173` — the
    `{host}/api/permissions/verify` call + its docstring →
    `{host}/api/access/permissions/check`.
  - `sdks/python/agenta/sdk/middlewares/routing/auth.py:141` — same path update.
  - NOTE: confirm the SDK sends the same query params (`action`,
    `resource_type`, …) and reads `effect`/`credentials` from the response — the
    handler contract is unchanged, only the path moves.
- **Do NOT touch** `web/packages/agenta-api-client/*` (Fern-generated) or
  `web/_reference/*` — user regenerates these.

### 4. Verify
- ruff on touched api files.
- Runtime: OSS app import (`/access/permissions/check` route present); EE
  extend mounts both. Confirm OSS-only path returns Allow.
- SDK: `sdks/python` — ruff format + check on the two middleware files; run any
  SDK unit tests that touch these middlewares.
- Throttle: the ENDPOINTS entry resolves (no test asserts the old literal? check
  `test_*throttl*`).

## Deferred (NOT in this change — flagged for later)

- **Services `admin_manager.py` + `commoners.py`** are non-scope (platform/
  onboarding helpers) but are genuinely service-layer; moving them to a `core/`
  home is a separate, lower-priority cleanup. Leave for now.
- **EE routers** (`ee/src/routers/organization_router.py`,
  `workspace_router.py`) are already scope-only — no change.
- The 6 pre-existing eval-loop test failures (UEL-017/021/022/023) are unrelated.

## Open questions for sign-off

- **Q1 — route path/op:** `GET /access/permissions/check`, operation_id
  `check_permissions`? (EE uses `fetch_access_plans`/`fetch_access_roles`; this
  would be `check_permissions` under the same `/access` group.) OK?
- **Q2 — health path:** keep trailing slash `/health/` (current) or `/health`?
  Inline vs a tiny `entrypoints/health.py`? Recommend: inline `@app.get("/health/")`
  in routers.py (matches current path exactly, no new file).
- **Q3 — SDK path:** the SDK calls `{host}/api/permissions/verify` (note the
  `/api` prefix). New path `{host}/api/access/permissions/check`. Confirm the
  `/api` mount prefix is unchanged (only the sub-path moves).

## Blast radius
- Delete 2 router files; edit `entrypoints/routers.py` (imports + mounts + inline
  health); new `apis/fastapi/access/` package (2 files).
- Update throttle map (1 line) + 2 SDK middleware files (2-3 lines).
- No EE router changes; EE `access` router untouched (keeps adding plans/roles).
- Generated client + API ref: user-handled.
