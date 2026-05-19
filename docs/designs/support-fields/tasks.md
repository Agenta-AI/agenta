# Tasks

Ordered for minimal-friction execution. Each task is independently testable.

## 1. Pre-flight verification

- [ ] Grep `support_id` and `support_ts` across `web/` and EE code to
      confirm no client reads them from a response body today.
- [ ] Grep `: Support` and `(Support)` across `api/ee/` to confirm no EE
      response models inherit from `Support`.
- [ ] Decide on import direction for the new ContextVar (see
      [gap.md](./gap.md) assumption #1): either type as
      `ContextVar[Optional[Any]]`, move `Support` into `context.py`, or
      introduce `utils/support.py`. Pick the option that compiles
      without a cycle.

## 2. ContextVar wiring

- [ ] In `api/oss/src/utils/context.py`, add:

      ```python
      support_ctx: ContextVar[Optional[Support]] = ContextVar(
          "support", default=None
      )
      ```

      Resolve the `Support` import per task 1.

## 3. Core util changes

- [ ] In `api/oss/src/utils/exceptions.py`:
  - [ ] Rewrite `attach_support(support)` to call
        `support_ctx.set(support)`. Returns `None`. No FastAPI types in
        the signature.
  - [ ] In `suppress_exceptions`: drop the `request` lookup, call
        `attach_support(support)`, return bare `default`.
  - [ ] In `intercept_exceptions`: same — call `attach_support(support)`
        for the side-effect, and strip `support_id` / `support_ts` from
        the `detail` payload (headers-only; client visibility comes from
        the response headers emitted by the middleware, not the body).
        Apply to both the `EntityCreationConflict` branch (drop the
        `support_id=` / `support_ts=` kwargs from the `ConflictException`
        call site, since `BaseHTTPException.__init__` folds `**kwargs`
        into `detail`) and the generic-exception branch (only `message`
        and `operation_id` remain in `detail`). Keep the existing
        `kwargs.pop("request", None)` block that extracts `user_id`,
        `project_id`, etc. for logging — it's unrelated.

## 4. Middleware

- [ ] In `api/entrypoints/routers.py`, define
      `support_headers_middleware(request, call_next)` that:
  - [ ] Calls `token = support_ctx.set(None)` on entry.
  - [ ] Wraps `call_next(request)` in a try/finally; in the finally,
        reads `support_ctx.get()` and calls `support_ctx.reset(token)`.
  - [ ] If support is present, sets `x-ag-support-id` and
        `x-ag-support-ts` on the response.
- [ ] Register it via `app.middleware("http")(support_headers_middleware)`
      next to the existing `authentication_middleware` /
      `analytics_middleware` registrations.

## 5. Strip `Support` inheritance from response models

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

## 6. Tests

- [ ] In `api/oss/tests/pytest/unit/utils/test_exceptions.py`:
  - [ ] Delete `test_support_fields_exist_on_api_response_model`.
  - [ ] Rewrite `test_suppress_exceptions_attaches_support_to_response`
        to assert `support_ctx.get()` is populated after the decorated
        call and that the returned payload is the bare default (no
        support fields on it).
  - [ ] Rewrite `test_intercept_exceptions_includes_support_metadata`
        to assert `support_id` / `support_ts` are absent from
        `HTTPException.detail` and present via `support_ctx.get()` (the
        response headers carry them; the body does not).
- [ ] Add `test_support_headers_middleware_emits_headers` —
      integration-style with a `TestClient`, hit a suppress-decorated
      route that raises, assert `x-ag-support-id` / `x-ag-support-ts`
      present on the response.
- [ ] Add `test_support_headers_absent_on_success` — same route,
      success path, assert headers absent.

## 7. Smoke test in dev

- [ ] Start API via the EE dev compose env (`hosting/docker-compose/ee/
      .env.ee.dev`). Hit a fetch endpoint with a contrived failure (e.g.
      via a temporary `raise RuntimeError("test")` in the service). Confirm:
  - [ ] Response body has no support fields.
  - [ ] Response headers contain `x-ag-support-id` and `x-ag-support-ts`.
  - [ ] Server log line has matching IDs.
- [ ] Hit the same endpoint on the happy path. Confirm: no headers,
      clean body.

## 8. Regenerate API docs

- [ ] Run the `update-api-docs` skill once the change is on `main`.
      Confirm the regenerated reference (e.g. fetch-folder) no longer
      shows `support_id` / `support_ts`.

## 9. PR

- [ ] PR title format per AGENTS.md: `fix(api): remove support fields
      from response schemas; emit as headers`.
- [ ] Body: link this design doc, summarize the wire-shape change for
      suppressed responses, call out the `x-ag-support-*` header
      contract.
