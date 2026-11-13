# Gap analysis — current vs. proposed

## Current state (post-PR #4212)

### Files

- `api/oss/src/utils/exceptions.py`
  - `Support` model with two optional fields.
  - `build_support()` factory.
  - `attach_support(payload, support)` → returns a patched copy of the
    payload, IF the payload class declares `support_id` as a field.
  - `suppress_exceptions` decorator → calls `attach_support(default, ...)`
    and returns the patched default.
  - `intercept_exceptions` decorator → raises HTTPException with
    support fields in `detail`.

- 15 response-model files inherit from `Support`:
  - `annotations`, `applications`, `environments`, `evaluations`,
    `evaluators`, `folders`, `invocations`, `otlp`, `queries`,
    `testcases`, `testsets`, `traces`, `tracing`, `workflows`.

- `api/oss/tests/pytest/unit/utils/test_exceptions.py` — 4 tests,
  two of which assert the schema-level presence of support fields.

- `api/entrypoints/routers.py` — registers
  `authentication_middleware` and `analytics_middleware`. No support
  middleware exists.

### Behavior

- Success bodies: clean (nulls dropped). Schemas: polluted.
- Suppressed bodies: support fields at top level. Schema: same as success.
- Intercepted bodies: support fields nested in `detail`. No response model.

## Target state

### Files to change

| File | Change |
| --- | --- |
| `api/oss/src/utils/context.py` | Add `support_ctx: ContextVar[Optional[Support]]` next to the existing `request_id_ctx`. If a circular import appears, move `Support` here or into a small `utils/support.py`. |
| `api/oss/src/utils/exceptions.py` | Rewrite `attach_support(support)` to call `support_ctx.set(support)`. Both decorators call `attach_support` instead of fishing `request` from kwargs. Strip `support_id` / `support_ts` from `intercept_exceptions` `detail` (headers-only); both decorators rely on `support_ctx` + `SupportHeadersMiddleware` for client visibility. |
| `api/entrypoints/routers.py` | Add `support_headers_middleware` that reads `support_ctx` and emits headers; register it. |
| `api/oss/src/apis/fastapi/{annotations,applications,environments,evaluations,evaluators,folders,invocations,otlp,queries,testcases,testsets,traces,tracing,workflows}/models.py` | Remove `Support` inheritance and the `Support` import. (15 files) |
| `api/oss/tests/pytest/unit/utils/test_exceptions.py` | Drop the schema-presence test, rewrite the suppress test to assert `support_ctx.get()`, add two header tests. |

### Files that do **not** change

- Any router file. The decorator no longer requires `request: Request`;
  handlers that already take one keep it for other reasons (auth /
  project scoping).
- Any service / DAO / core layer file. Support is still set in the API
  layer; the ContextVar just means it could be set from elsewhere too
  in the future.
- `intercept_exceptions`'s `detail` body shape, **other than removing `support_id` / `support_ts`**. `message` and `operation_id` are still emitted in the body; the support fields move to headers only.
- EE-side code. PR #4212 only touched OSS.

### Assumptions to verify before edit

1. **Import direction.** `exceptions.py` will need to import
   `support_ctx` from `context.py`, and `context.py` will reference the
   `Support` type. If `context.py` imports `Support` from
   `exceptions.py`, that's a cycle. Resolution options, in order of
   preference:
   - Type the ContextVar as `ContextVar[Optional[Any]]` and skip the
     import in `context.py` (loses type info, simplest).
   - Move `Support` (and only that class) into `context.py`.
   - Move `Support` into a new `utils/support.py` and have both
     `context.py` and `exceptions.py` import from there.

   Pick at code time based on what actually trips.

2. **Middleware ordering doesn't interfere.** GZip is registered after
   the auth/analytics middlewares; our header middleware should be fine
   wherever it lands, but worth verifying in dev that the header
   actually shows up on a suppressed response after gzip compression.

3. **No EE code reads `response.support_id` from a suppressed default
   response.** Grep:

   ```sh
   ag 'support_id' web/ ee/
   ```

   If any frontend code reads it, it needs to switch to reading the
   header.

4. **ContextVar isolation across requests.** The middleware does
   `set(None)` on entry and `reset(token)` on exit. Quick mental check
   in code review: confirm no other code path could leave `support_ctx`
   populated such that a later request without a failure would still
   emit headers. The middleware-driven reset should prevent this.

## Migration cost

- **Mechanical edits:** 15 model files (one diff each), 1 utils file, 1
  entrypoints file, 1 test file. ~20 files total.
- **Tests touched:** 4 existing assertions, 2 new tests.
- **Runtime risk:** low. The wire-shape change for suppressed responses
  is the only client-observable break, and the field was only added 3
  weeks ago.
- **Docs regeneration:** API reference will need to be regenerated post-
  merge (see `update-api-docs` skill); customer-facing schemas will then
  no longer show the two leaked fields.

## What this does NOT solve

- This is OSS-only. If EE response models also inherit `Support`
  somewhere (none found in this codebase, but worth a final grep
  before merging), they need the same treatment.
- This doesn't add a request-id header. That's a separate, related
  improvement and could land in the same middleware later.
