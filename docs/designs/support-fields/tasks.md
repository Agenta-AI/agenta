# Tasks

Ordered for minimal-friction execution. Each task is independently testable.

## 1. Pre-flight verification

- [ ] Grep every `@suppress_exceptions(...)` handler under
      `api/oss/src/apis/fastapi/` and confirm each takes `request: Request`
      as a parameter. List any that don't.
- [ ] Grep `support_id` and `support_ts` across `web/` and EE code to
      confirm no client reads them from a response body today.
- [ ] Grep `: Support` and `(Support)` across `api/ee/` to confirm no EE
      response models inherit from `Support`.

## 2. Core util changes

- [ ] In `api/oss/src/utils/exceptions.py`:
  - [ ] Rewrite `attach_support` to take `(request, support)` and mutate
        `request.state.support`. Returns `None`.
  - [ ] In `suppress_exceptions`: `kwargs.get("request")` (not pop),
        call `attach_support(request, support)`, return bare `default`.
  - [ ] In `intercept_exceptions`: same — grab request, call
        `attach_support` for the side-effect, leave the `detail` payload
        unchanged for back-compat. Apply to both the
        `EntityCreationConflict` branch and the generic-exception branch.

## 3. Middleware

- [ ] In `api/entrypoints/routers.py`, define
      `support_headers_middleware(request, call_next)` that reads
      `request.state.support` and sets `x-ag-support-id` /
      `x-ag-support-ts` on the response when present.
- [ ] Register it via `app.middleware("http")(support_headers_middleware)`
      next to the existing `authentication_middleware` /
      `analytics_middleware` registrations.

## 4. Strip `Support` inheritance from response models

For each file below, replace `class XResponse(Support):` with
`class XResponse(BaseModel):` and remove the
`from oss.src.utils.exceptions import Support` import:

- [ ] `api/oss/src/apis/fastapi/annotations/models.py`
- [ ] `api/oss/src/apis/fastapi/applications/models.py`
- [ ] `api/oss/src/apis/fastapi/environments/models.py`
- [ ] `api/oss/src/apis/fastapi/evaluations/models.py`
- [ ] `api/oss/src/apis/fastapi/evaluators/models.py`
- [ ] `api/oss/src/apis/fastapi/folders/models.py`
- [ ] `api/oss/src/apis/fastapi/invocations/models.py`
- [ ] `api/oss/src/apis/fastapi/otlp/models.py`
- [ ] `api/oss/src/apis/fastapi/queries/models.py`
- [ ] `api/oss/src/apis/fastapi/testcases/models.py`
- [ ] `api/oss/src/apis/fastapi/testsets/models.py`
- [ ] `api/oss/src/apis/fastapi/traces/models.py`
- [ ] `api/oss/src/apis/fastapi/tracing/models.py`
- [ ] `api/oss/src/apis/fastapi/workflows/models.py`

After this batch, `Support` should only be imported by
`exceptions.py` itself, `test_exceptions.py`, and the middleware.

## 5. Tests

- [ ] In `api/oss/tests/pytest/unit/utils/test_exceptions.py`:
  - [ ] Delete `test_support_fields_exist_on_api_response_model`.
  - [ ] Rewrite `test_suppress_exceptions_attaches_support_to_response`
        to assert `request.state.support` is populated and the returned
        payload is the bare default (no support fields on it).
  - [ ] Keep `test_intercept_exceptions_includes_support_metadata` as-is
        (the `detail` payload is unchanged).
- [ ] Add `test_support_headers_middleware_emits_headers` —
      integration-style with a `TestClient`, hit a suppress-decorated
      route that raises, assert `x-ag-support-id` / `x-ag-support-ts`
      present on the response.
- [ ] Add `test_support_headers_absent_on_success` — same route,
      success path, assert headers absent.

## 6. Smoke test in dev

- [ ] Start API via the EE dev compose env (`hosting/docker-compose/ee/
      .env.ee.dev`). Hit a fetch endpoint with a contrived failure (e.g.
      via a temporary `raise RuntimeError("test")` in the service). Confirm:
  - [ ] Response body has no support fields.
  - [ ] Response headers contain `x-ag-support-id` and `x-ag-support-ts`.
  - [ ] Server log line has matching IDs.
- [ ] Hit the same endpoint on the happy path. Confirm: no headers,
      clean body.

## 7. Regenerate API docs

- [ ] Run the `update-api-docs` skill once the change is on `main`.
      Confirm the regenerated reference (e.g. fetch-folder) no longer
      shows `support_id` / `support_ts`.

## 8. PR

- [ ] PR title format per AGENTS.md: `fix(api): remove support fields
      from response schemas; emit as headers`.
- [ ] Body: link this design doc, summarize the wire-shape change for
      suppressed responses, call out the `x-ag-support-*` header
      contract.
