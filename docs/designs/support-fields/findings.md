# Findings — support-fields cleanup

## Sources

- Branch: `fix/clean-up-support-attributes` (base `release/v0.99.10`)
- PR: [#4325](https://github.com/Agenta-AI/agenta/pull/4325) (sync pulled 4 Copilot review comments from review `4316541442` submitted 2026-05-19)
- Design docs in this folder: `research.md`, `gap.md`, `proposal.md`, `tasks.md`
- Implementation diff vs. `main`: 23 files (~927 / -208)
- Touched code reviewed:
  - `api/oss/src/utils/context.py`
  - `api/oss/src/utils/exceptions.py`
  - `api/entrypoints/routers.py`
  - `api/oss/src/apis/fastapi/shared/utils.py` (`SupportHeadersMiddleware`)
  - 15 `api/oss/src/apis/fastapi/*/models.py`
  - `api/oss/tests/pytest/unit/utils/test_exceptions.py`
- Adjacent verification:
  - Grep for `support_id` / `support_ts` in `api/ee/`, `web/oss/src`, `web/ee/src`
  - Grep for `Support` inheritance / imports across `api/oss/src/apis/fastapi/` and `api/ee/`

## Summary

The proposal and tasks are implemented end-to-end. All ten findings are resolved on this branch — six from the original scan, four from the PR #4325 sync pass.

Original scan findings (closed):

- F-001 — fixed a real production bug: support middleware was outside `BaseHTTPMiddleware`s, so ContextVar mutations from the handler never reached it. Headers were silently dropped on every real request.
- F-002 — added a schema assert on `Support.model_fields`.
- F-003 — stripped `support_id` / `support_ts` from `ConflictException` (409) and intercepted-5xx `detail`; headers only.
- F-004 — user is regenerating API docs separately.
- F-005 — proposal doc clarified.
- F-006 — `expose_headers=["x-ag-support-id", "x-ag-support-ts"]` added to CORS so browser JS can read them.

Sync-derived findings (closed):

- F-007 — rewrote `tasks.md` §3 `intercept_exceptions` bullet to describe headers-only behavior.
- F-008 — renumbered duplicate `## 4` in `tasks.md`; cascaded §5..§8 → §6..§9.
- F-009 — rewrote `gap.md` exceptions.py row and "Files that do not change" bullet to reflect headers-only behavior.
- F-010 — deleted the local `_SupportHeadersMiddleware` mirror in `test_exceptions.py`; tests now import the real `SupportHeadersMiddleware` from `oss.src.apis.fastapi.shared.utils`. All 7 tests pass.

## Rules

- Severity scheme: `P0` / `P1` / `P2` / `P3` (per [findings.schema.md](../../../agents/skills/shared/references/findings.schema.md)).

## Notes

- `web/packages/agenta-api-client/src/generated/api/types/*Response.ts` still list `support_id?` / `support_ts?`. These regenerate when the OpenAPI snapshot refreshes and the Fern client is rebuilt — no action required here.

## Open Findings

None — all ten findings (six from the original scan, four from the PR #4325 sync) are resolved on this branch. See Closed Findings below.

## Closed Findings

### [CLOSED] F-001 — Production middleware order silently dropped the support headers

- **ID**: F-001
- **Origin**: scan
- **Lens**: verification
- **Severity**: P1 (upgraded from P2 once reproduced)
- **Confidence**: high
- **Status**: fixed
- **Category**: Correctness / Testing
- **Activation Condition**: any suppressed or intercepted failure on a real route where `authentication_middleware`, `analytics_middleware`, or the EE `throttling_middleware` is in the chain (every route in production).
- **Summary**: `SupportHeadersMiddleware` was pure-ASGI (good), but originally registered *outside* `authentication_middleware` and `analytics_middleware` (both `BaseHTTPMiddleware`-style via `app.middleware("http")`). `BaseHTTPMiddleware` runs the downstream app in a child anyio task and decouples `send` via memory streams, so the response is drained back in the outer task. The handler's `support_ctx.set(...)` happens in the child task; the support middleware's `send_with_support` runs in the outer task where `support_ctx` was never mutated. Headers were silently dropped on every real request. Empirically reproduced via a new integration test (`test_support_headers_survive_base_http_middleware`).
- **Evidence**:
  - Pre-fix test failure: `AssertionError: assert 'x-ag-support-id' in Headers({'content-length': '11', 'content-type': 'application/json'})`
  - Starlette `BaseHTTPMiddleware` uses `anyio.create_task_group` + memory streams for `send`, breaking ContextVar back-propagation.
- **Files**:
  - `api/entrypoints/routers.py`
  - `api/oss/tests/pytest/unit/utils/test_exceptions.py`
- **Cause**: ContextVar mutations in a child anyio task do not propagate back to the parent task; the original middleware order placed `SupportHeadersMiddleware` in the parent.
- **Fix Applied**: moved `app.add_middleware(SupportHeadersMiddleware)` to be registered FIRST in [api/entrypoints/routers.py](../../../api/entrypoints/routers.py) (innermost wrapping, beneath all `BaseHTTPMiddleware`s), with an inline comment explaining the constraint. Added `test_support_headers_survive_base_http_middleware` that mirrors production stacking — passes after the fix.
- **Alternatives**: migrate `authentication_middleware` / `analytics_middleware` to pure-ASGI (larger surface, out of scope).

### [CLOSED] F-002 — Schema-level guard on `Support` fields

- **ID**: F-002
- **Origin**: scan
- **Lens**: verification
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Testing
- **Summary**: The header middleware reads `support.support_id` / `support.support_ts` behind truthy guards. If `Support` ever renames or drops a field, the middleware silently emits no header. No structural assertion pinned the contract.
- **Evidence**:
  - Field-guarded header emission: [api/oss/src/apis/fastapi/shared/utils.py](../../../api/oss/src/apis/fastapi/shared/utils.py)
  - `Support` definition: [api/oss/src/utils/context.py](../../../api/oss/src/utils/context.py)
- **Files**:
  - `api/oss/tests/pytest/unit/utils/test_exceptions.py`
- **Cause**: optional fields + silent skip + no schema assertion.
- **Fix Applied**: added `test_support_model_has_expected_fields` asserting `set(Support.model_fields) >= {"support_id", "support_ts"}` in [api/oss/tests/pytest/unit/utils/test_exceptions.py](../../../api/oss/tests/pytest/unit/utils/test_exceptions.py).

### [CLOSED] F-003 — Support metadata leaked into intercepted error bodies (409 and 500)

- **ID**: F-003
- **Origin**: scan
- **Lens**: verification
- **Severity**: P2
- **Confidence**: high
- **Status**: fixed
- **Category**: Consistency
- **Summary**: `intercept_exceptions` raised `ConflictException(..., support_id=..., support_ts=...)` and built the 5xx `detail` with `support_id` / `support_ts`. `BaseHTTPException.__init__` folds `**kwargs` into `detail`, so both 409 and 500 bodies carried support fields — inconsistent with the proposal's "headers only" intent.
- **Evidence**:
  - Pre-fix raise sites in `api/oss/src/utils/exceptions.py` (conflict branch + generic-5xx branch)
- **Files**:
  - `api/oss/src/utils/exceptions.py`
  - `docs/designs/support-fields/proposal.md`
  - `api/oss/tests/pytest/unit/utils/test_exceptions.py`
- **Cause**: original design kept body fields for back-compat; user decided headers-only.
- **Fix Applied**:
  - Removed `support_id` / `support_ts` from the `ConflictException(...)` call site.
  - Removed `support_id` / `support_ts` from the generic-5xx `detail` dict; only `message` and `operation_id` remain.
  - Updated `proposal.md` §4 + the "What changes for clients" table to reflect headers-only behavior across 5xx and 409.
  - Rewrote `test_intercept_exceptions_includes_support_metadata` → `test_intercept_exceptions_attaches_support_to_context`, asserting absence of `support_id` / `support_ts` in `detail` and presence on `support_ctx`.

### [CLOSED] F-004 — `tasks.md` checklist + post-merge regen

- **ID**: F-004
- **Origin**: scan
- **Severity**: P3
- **Confidence**: high
- **Status**: wontfix (handled outside this scan)
- **Category**: Process
- **Summary**: `tasks.md` boxes still unchecked; OpenAPI regeneration (task §8, formerly §7 before [[F-008]] renumber) hadn't run, so the Fern-generated client types still list the fields.
- **Resolution**: user is regenerating API docs separately. No action from this scan.

### [CLOSED] F-005 — Proposal overstated the "no more `request:`" claim

- **ID**: F-005
- **Origin**: scan
- **Severity**: P3
- **Confidence**: medium
- **Status**: fixed
- **Category**: Documentation
- **Summary**: `proposal.md` §3 said "the handler no longer needs to take `request: Request` for support headers to work." True for `suppress_exceptions`, false for `intercept_exceptions` (which still pops `request` from kwargs for log enrichment).
- **Files**:
  - `docs/designs/support-fields/proposal.md`
- **Fix Applied**: tightened the "Key differences vs. today" bullets in `proposal.md` §3 to scope the claim to `suppress_exceptions` and explicitly note that `intercept_exceptions` retains the `kwargs.pop("request", None)` block for logging only.

### [CLOSED] F-006 — `x-ag-support-*` headers were not CORS-exposed

- **ID**: F-006
- **Origin**: scan
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Compatibility
- **Activation Condition**: any cross-origin browser client (web app at `localhost:3000`, `agenta.ai`, Vercel preview, etc.) attempting `response.headers.get("x-ag-support-id")` after a fetch hits `suppress_exceptions`.
- **Summary**: `CORSMiddleware` had no `expose_headers`. Per CORS spec, browser JS can only read response headers listed in `Access-Control-Expose-Headers` (custom `x-ag-*` headers are not in the safelist). Headers were emitted on the wire but invisible to web clients.
- **Files**:
  - `api/entrypoints/routers.py`
- **Fix Applied**: added `expose_headers=["x-ag-support-id", "x-ag-support-ts"]` to `CORSMiddleware` in [api/entrypoints/routers.py](../../../api/entrypoints/routers.py).

### [CLOSED] F-007 — `tasks.md` §3 still said "leave detail unchanged for back-compat"

- **ID**: F-007
- **Origin**: sync
- **Lens**: validation
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Documentation
- **Summary**: `tasks.md` task §3 instructed: "call `attach_support(support)` for the side-effect, leave the `detail` payload unchanged for back-compat." The shipped implementation ([[F-003]]) had already removed `support_id` / `support_ts` from both the conflict and generic-5xx `detail` — headers-only. The stale checklist could have misled future contributors into reintroducing the body fields.
- **Evidence**:
  - PR thread [#discussion_r3264315906](https://github.com/Agenta-AI/agenta/pull/4325#discussion_r3264315906) (Copilot, 2026-05-19)
- **Files**:
  - `docs/designs/support-fields/tasks.md`
- **Cause**: doc authored before the headers-only decision, not updated when [[F-003]] landed.
- **Fix Applied**: rewrote task §3's `intercept_exceptions` bullet to describe headers-only behavior: strip `support_id` / `support_ts` from `detail` in both the `EntityCreationConflict` and generic-exception branches (drop the `support_id=` / `support_ts=` kwargs from the `ConflictException` call site since `BaseHTTPException.__init__` folds `**kwargs` into `detail`). Kept the unrelated `kwargs.pop("request", None)` logging block. See [tasks.md](./tasks.md).
- **Sources**: PR #4325 review `4316541442`.

### [CLOSED] F-008 — `tasks.md` had duplicate `## 4` section numbering

- **ID**: F-008
- **Origin**: sync
- **Lens**: validation
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Documentation
- **Summary**: `tasks.md` declared two `## 4` headings — "Middleware" and "Strip `Support` inheritance from response models". Section references were ambiguous.
- **Evidence**:
  - PR thread [#discussion_r3264315970](https://github.com/Agenta-AI/agenta/pull/4325#discussion_r3264315970) (Copilot, 2026-05-19)
- **Files**:
  - `docs/designs/support-fields/tasks.md`
  - `docs/designs/support-fields/findings.md` (updated `[[F-004]]` cross-reference from "task §7" to "task §8")
- **Cause**: numbering not renumbered when "Strip inheritance" was added/split.
- **Fix Applied**: renumbered "Strip `Support` inheritance from response models" to `## 5`, cascading `## 5 → ## 6` (Tests), `## 6 → ## 7` (Smoke test), `## 7 → ## 8` (Regenerate API docs), `## 8 → ## 9` (PR). Updated the one cross-reference in [[F-004]] that named the old "task §7" to read "task §8".
- **Sources**: PR #4325 review `4316541442`.

### [CLOSED] F-009 — `gap.md` "Files to change" row still said "Keep detail payload for back-compat"

- **ID**: F-009
- **Origin**: sync
- **Lens**: validation
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Documentation
- **Summary**: Two stale claims in `gap.md` contradicted the headers-only behavior shipped in [[F-003]]:
  1. The `api/oss/src/utils/exceptions.py` row in the target-state "Files to change" table said "Keep `detail` payload in `intercept_exceptions` for back-compat."
  2. The "Files that do not change" bullet listed `intercept_exceptions`'s `detail` body shape as unchanged.
- **Evidence**:
  - PR thread [#discussion_r3264315985](https://github.com/Agenta-AI/agenta/pull/4325#discussion_r3264315985) (Copilot, 2026-05-19)
- **Files**:
  - `docs/designs/support-fields/gap.md`
- **Cause**: doc not updated when [[F-003]] landed.
- **Fix Applied**: rewrote the exceptions.py row to: "Strip `support_id` / `support_ts` from `intercept_exceptions` `detail` (headers-only); both decorators rely on `support_ctx` + `SupportHeadersMiddleware` for client visibility." Also softened the "Files that do not change" bullet to clarify that `message` and `operation_id` remain in the body but support fields move to headers. Closely related to [[F-007]] — fixed in the same pass.
- **Sources**: PR #4325 review `4316541442`.

### [CLOSED] F-010 — Unit test mirrored `SupportHeadersMiddleware` with a stale docstring

- **ID**: F-010
- **Origin**: sync
- **Lens**: validation
- **Severity**: P3
- **Confidence**: high
- **Status**: fixed
- **Category**: Testing
- **Summary**: `test_exceptions.py` defined a local `_SupportHeadersMiddleware` class that mirrored production behavior, with a docstring claiming it had to be a local mirror because importing the real one would pull the full app composition root. Two problems:
  1. The production class actually lives in [api/oss/src/apis/fastapi/shared/utils.py](../../../api/oss/src/apis/fastapi/shared/utils.py), not `entrypoints.routers` (the entrypoint just registers it). The docstring's import-path rationale was stale.
  2. `SupportHeadersMiddleware` is lightweight (pure-ASGI; transitively pulls only `oss.src.core.shared.dtos` and `oss.src.utils.context`, no DAOs or services), so the "too heavy for a unit test" claim was false. The local mirror could drift from production silently.
- **Evidence**:
  - PR thread [#discussion_r3264316015](https://github.com/Agenta-AI/agenta/pull/4325#discussion_r3264316015) (Copilot, 2026-05-19)
- **Files**:
  - `api/oss/tests/pytest/unit/utils/test_exceptions.py`
- **Cause**: original test written before middleware was extracted into `shared/utils.py`; not refactored when the extraction happened.
- **Fix Applied**: deleted the local `_SupportHeadersMiddleware` class (and its stale docstring), imported `SupportHeadersMiddleware` from `oss.src.apis.fastapi.shared.utils`, and replaced both `app.add_middleware(_SupportHeadersMiddleware)` call sites (in `_build_test_app` and `_build_test_app_with_base_http_middleware`) with the real class. Verified all 7 tests in the file pass against the real middleware via `python run-tests.py --env-file ../hosting/docker-compose/ee/.env.ee.dev -- oss/tests/pytest/unit/utils/test_exceptions.py`. `ruff format` + `ruff check` clean.
- **Sources**: PR #4325 review `4316541442`.
