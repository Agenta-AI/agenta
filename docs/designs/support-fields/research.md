# Research — support fields leaking into API schemas

## Origin

PR #4212 ("Chore/add support info on suppressed exceptions", merged 2026-04-22) added two pieces of metadata — `support_id` and `support_ts` — to every API response envelope in the OSS FastAPI layer. The intent: when an unexpected internal error gets caught and converted into either a graceful default (`suppress_exceptions`) or an HTTP 5xx (`intercept_exceptions`), the response carries a correlation ID and timestamp that customers can quote to support, and that we log on the server side.

## How it's wired today

Three pieces in [api/oss/src/utils/exceptions.py](../../../api/oss/src/utils/exceptions.py):

1. A `Support` Pydantic model with two optional fields:

   ```python
   class Support(BaseModel):
       support_id: Optional[str] = None
       support_ts: Optional[datetime] = None
   ```

2. `build_support()` mints a fresh `(uuid4, utcnow)` pair on each failure.

3. `attach_support(payload, support)` does a `model_copy(update=...)` of the payload — but **only if** the payload class has `support_id` in its `model_fields`. That guard is why every response envelope needs to inherit from `Support`.

The decorators:

- `suppress_exceptions(default=..., exclude=...)` — wraps a route handler. On any non-excluded exception, builds support, logs `[SUPPRESSED]`, and returns `attach_support(default, support)`. The return value is what FastAPI serializes.
- `intercept_exceptions()` — wraps a route handler. On any non-`HTTPException`, builds support, logs `[INTERCEPTED]`, and raises `HTTPException(status_code=500, detail={message, support_id, support_ts, operation_id})`. The IDs live inside `detail`, not on a response model.

## Which response models inherit `Support`

15 model files under `api/oss/src/apis/fastapi/*/models.py`:

```
annotations, applications, environments, evaluations, evaluators,
folders, invocations, otlp, queries, testcases, testsets,
traces, tracing, workflows
```

Each file contains multiple `*Response` classes, all of the shape:

```python
class FolderResponse(Support):       # ← inherits support_id, support_ts
    count: int = 0
    folder: Optional[Folder] = None
```

## What the rendered docs show

Mahmoud flagged this Monday (2026-05-11) by pointing at
[https://agenta.ai/docs/reference/api/fetch-folder](https://agenta.ai/docs/reference/api/fetch-folder).
Every success-response schema in our public API reference now lists
`support_id` and `support_ts` as optional nullable fields. They are always
`null` on success (the only code path that populates them is the
exception-recovery path). Customers reading the docs see two unexplained
fields on every endpoint.

## Routes that actually use `suppress_exceptions`

`grep` across `api/oss/src/apis/fastapi/` shows 21 routers calling
`suppress_exceptions(...)`. Every handler decorated with it also takes
`request: Request` in its signature (verified by spot-checking folders,
workflows, tracing — they all need `request.state.project_id` for tenant
scoping anyway). This matters for the proposed fix: a decorator can reach
the `Request` via `kwargs` without changing handler signatures.

## What's serialized today

- **Success:** `response_model_exclude_none=True` is set on every suppressed
  route. So on success, `support_id: None` and `support_ts: None` are
  dropped from the JSON body. **Only the schema is polluted, not the wire
  payload.** This is what jp asked Mahmoud to confirm on Monday and it
  matches what's in the code.
- **Suppressed failure:** `attach_support` populates both fields; they
  serialize as a string and an ISO timestamp at the top of the body
  alongside `count: 0` and the empty payload field.
- **Intercepted failure:** body is `{"detail": {"message", "support_id",
  "support_ts", "operation_id"}}` — fields are nested inside `detail`, not
  on a response model. No schema pollution from this path.

## Constraints on any fix

1. Graceful-failure responses (`suppress_exceptions`) must still carry the
   support metadata in some form — that's the contract for customers
   contacting support after a fetch/query returned an empty result due to
   an internal issue.
2. Intercepted-error responses (`intercept_exceptions`) already work
   correctly and shouldn't be touched.
3. Any change must not require modifying handler signatures one-by-one.
4. The OpenAPI schema for success responses should not mention support
   fields at all.

## Slack thread (2026-05-11, condensed)

- Mahmoud: every response envelope inherits `Support`; `support_id` /
  `support_ts` show as optional fields on every success schema (linked
  fetch-folder). Should live on the error detail and on the
  suppressed-default response only.
- jp: confirms it's a schema-only leak (success bodies still omit nulls via
  `response_model_exclude_none=True`).
- Constraint added by jp: even graceful failures from `suppress_exceptions`
  on fetch/query/retrieve — returning `count: 0` + empty entity — need to
  carry the support metadata. So we can't simply drop the fields.

## Decided direction

After exploring "nest under `support: Optional[Support]`" (rejected by jp
as no real benefit over two flat fields), the agreed direction is to move
support metadata off the JSON body entirely and emit it as response
headers:

- `x-ag-support-id`
- `x-ag-support-ts`

This matches the precedent of `X-Request-Id`, `Server-Timing`, etc. —
support metadata is operational/correlation data, not part of the resource
representation.
