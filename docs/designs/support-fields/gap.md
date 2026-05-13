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
|---|---|
| `api/oss/src/utils/exceptions.py` | Rewrite `attach_support` (now mutates `request.state`), update both decorators to grab `request` from `kwargs` and stash support there. Keep `detail` payload in `intercept_exceptions` for back-compat. |
| `api/entrypoints/routers.py` | Add `support_headers_middleware`, register it. |
| `api/oss/src/apis/fastapi/{annotations,applications,environments,evaluations,evaluators,folders,invocations,otlp,queries,testcases,testsets,traces,tracing,workflows}/models.py` | Remove `Support` inheritance and the `Support` import. (15 files) |
| `api/oss/tests/pytest/unit/utils/test_exceptions.py` | Drop the schema-presence test, rewrite the suppress test, add two header tests. |

### Files that do **not** change

- Any router file. Handlers already take `request: Request`. The
  decorator change is invisible to them.
- Any service / DAO / core layer file. Support is an API-layer concern.
- `intercept_exceptions`'s `detail` body shape — kept for back-compat.
- EE-side code. PR #4212 only touched OSS.

### Assumptions to verify before edit

1. **Every `suppress_exceptions`-decorated handler takes `request: Request`.**
   Spot-checked folders, workflows, tracing. Need to confirm across all
   21 router files. Quick check:

   ```
   ag -A 5 '@suppress_exceptions' api/oss/src/apis/fastapi/ | rg -B5 'request: Request'
   ```

   If any handler is missing it, that handler's suppressed path will
   silently lose support headers (the decorator won't have a request to
   stash state on). The fallback is harmless (no header) but worth
   knowing — we should either add `request: Request` to those handlers
   or accept the gap.

2. **Middleware ordering doesn't interfere.** GZip is registered after
   the auth/analytics middlewares; our header middleware should be fine
   wherever it lands, but worth verifying in dev that the header
   actually shows up on a suppressed response after gzip compression.

3. **No EE code reads `response.support_id` from a suppressed default
   response.** Grep:

   ```
   ag 'support_id' web/ ee/
   ```

   If any frontend code reads it, it needs to switch to reading the
   header.

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
- This doesn't change the `detail` shape on 5xx errors. If we ever want
  to also clean those up (e.g. emit support only as headers and remove
  from body), that's a follow-up — but it would be a real wire break
  and probably isn't worth it.
