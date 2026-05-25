# Proposal — move support metadata to response headers

## Headers

When `suppress_exceptions` or `intercept_exceptions` activates, the
response carries:

- `x-ag-support-id` — UUID4 string
- `x-ag-support-ts` — ISO-8601 UTC timestamp

On the happy path: no headers, no body fields, no schema entries.

## Code shape

### 1. `Support` model + `support_ctx` ContextVar

[api/oss/src/utils/context.py](../../../api/oss/src/utils/context.py) gets
a new ContextVar alongside the existing `request_id_ctx`:

```python
from contextvars import ContextVar
from typing import Optional

from oss.src.utils.exceptions import Support  # or move Support here if a cycle appears

request_id_ctx: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
support_ctx: ContextVar[Optional[Support]] = ContextVar("support", default=None)
```

If importing `Support` from `exceptions.py` creates a cycle (very likely,
since `exceptions.py` will import `support_ctx`), the cleanest fix is to
move `Support` into `context.py` itself, or into a tiny new
`utils/support.py` that both `context.py` and `exceptions.py` import.
This is a trivial implementation detail to settle at code time.

### 2. `attach_support` becomes a thin ContextVar setter

[api/oss/src/utils/exceptions.py](../../../api/oss/src/utils/exceptions.py)

```python
from oss.src.utils.context import support_ctx


class Support(BaseModel):
    support_id: Optional[str] = None
    support_ts: Optional[datetime] = None


def build_support() -> Support:
    return Support(
        support_id=str(uuid4()),
        support_ts=datetime.now(timezone.utc),
    )


def attach_support(support: Support) -> None:
    """Stash support metadata in the request-scoped ContextVar.
    A middleware reads it on the way out and emits the headers."""
    support_ctx.set(support)
```

Returns nothing. No FastAPI types in the signature. Callable from
anywhere in the async call stack — routes, services, future workers —
because `ContextVar` propagates with `asyncio` automatically.

### 3. `suppress_exceptions` — no more `request` fishing

```python
def suppress_exceptions(default=None, message="", verbose=True, exclude=None):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as exc:
                if any(isinstance(exc, e) for e in exclude or []):
                    raise

                support = build_support()
                operation_id = getattr(func, "__name__", None)

                if verbose:
                    log.warn(
                        f"[SUPPRESSED] {message}\n{format_exc()}",
                        support_id=support.support_id,
                        support_ts=support.support_ts,
                        operation_id=operation_id,
                    )

                attach_support(support)
                return default

        return wrapper
    return decorator
```

Key differences vs. today:

- In `suppress_exceptions`, no `kwargs.pop("request")` or
  `isinstance(..., Request)` check. Handlers under this decorator no
  longer need `request: Request` for support headers to work (they may
  still take one for other reasons — auth, project scoping — but the
  dependency from *this* decorator is gone).
- `intercept_exceptions` still pops `request` from kwargs, but only to
  enrich the `[INTERCEPTED]` log line with `user_id` / `project_id` /
  `request_path`. That block is unrelated to support metadata and is
  intentionally left alone (see also `tasks.md §3`).
- `return default` returns the bare payload — no `model_copy`, no field
  patching.

### 4. `intercept_exceptions` also calls `attach_support`

```python
# inside intercept_exceptions wrapper, on the unexpected-exception branch:
support = build_support()
attach_support(support)
# ... existing logging ...
raise HTTPException(
    status_code=500,
    detail=jsonable_encoder({
        "message": message,
        "operation_id": operation_id,
    }),
) from e
```

The existing `kwargs.pop("request", None)` block in
`intercept_exceptions` (used to extract `user_id`, `project_id`, etc.
for logging) stays as-is — it's serving a different purpose and isn't
about support metadata.

Support metadata is **headers-only** for both intercepted branches —
the generic 5xx path and the `EntityCreationConflict` (409) path. Neither
the response body nor the `detail` dict carries `support_id` /
`support_ts` anymore. Clients that need the correlation id read it from
`x-ag-support-id` / `x-ag-support-ts`. This is a wire-shape change for
intercepted error bodies; the field shipped 3 weeks ago and there's no
documented client guidance to read it.

### 5. Middleware reads the ContextVar, emits the headers

[api/entrypoints/routers.py](../../../api/entrypoints/routers.py) — alongside the existing `authentication_middleware`, `analytics_middleware`:

```python
from oss.src.utils.context import support_ctx


async def support_headers_middleware(request: Request, call_next):
    token = support_ctx.set(None)
    try:
        response = await call_next(request)
    finally:
        support = support_ctx.get()
        support_ctx.reset(token)

    if support is not None:
        if support.support_id:
            response.headers["x-ag-support-id"] = support.support_id
        if support.support_ts:
            response.headers["x-ag-support-ts"] = support.support_ts.isoformat()
    return response


app.middleware("http")(support_headers_middleware)
```

Why the `set(None)` + `reset(token)` dance:

- `ContextVar` defaults propagate across `asyncio` tasks, but the same
  variable is shared by all middleware/handler code running in a given
  request task.
- Setting `None` at request entry ensures we don't inherit stale state
  from a previous request that ran on the same worker.
- `reset(token)` is good hygiene — guarantees the variable is restored
  even if something downstream sets it without resetting.

Registration position relative to auth/analytics doesn't change behavior
— Starlette runs middlewares in reverse-registration order on the way
out, and this middleware doesn't depend on auth state. Register it
adjacent to the other `app.middleware("http")(...)` calls.

### 5. Response models drop `Support` inheritance

For each of the 15 `*/models.py` files:

```diff
-from oss.src.utils.exceptions import Support
 ...

-class FolderResponse(Support):
+class FolderResponse(BaseModel):
     count: int = 0
     folder: Optional[Folder] = None
```

Same diff repeated across `annotations`, `applications`, `environments`,
`evaluations`, `evaluators`, `folders`, `invocations`, `otlp`, `queries`,
`testcases`, `testsets`, `traces`, `tracing`, `workflows`.

After this, `Support` is only imported by `exceptions.py` itself
(internal) and by the test module.

### 6. Tests

[api/oss/tests/pytest/unit/utils/test_exceptions.py](../../../api/oss/tests/pytest/unit/utils/test_exceptions.py)

- `test_support_fields_exist_on_api_response_model` — **delete** (the
  whole point is they don't exist there anymore).
- `test_suppress_exceptions_attaches_support_to_response` — rewrite to
  assert that after the decorated function runs, `support_ctx.get()` is
  populated with a UTC timestamp + non-empty id, and the returned
  payload is the bare default (no support fields on it).
- `test_intercept_exceptions_includes_support_metadata` — rewrite to
  assert `support_id` / `support_ts` are absent from
  `HTTPException.detail` and present via `support_ctx.get()` (response
  headers carry them; the body does not).
- New: `test_support_headers_middleware_emits_headers` — integration-style
  test that hits a suppress-decorated route, asserts both headers
  present.
- New: `test_support_headers_absent_on_success` — same route, success
  path, asserts no headers.

## Why headers (and not nested `support` field)

- **Zero schema noise.** This is the only option that gets us all the way
  to "the public docs show no support fields on success."
- **Precedent.** `X-Request-Id`, `Server-Timing`, `X-RateLimit-*` —
  operational/correlation metadata belongs in headers.
- **Decoupling.** The response model represents the resource. Whether the
  server fell back to an empty default is server-side context, not part
  of the resource.
- **Forward-compatible.** If we later want to also emit `x-ag-trace-id` or
  `x-ag-request-id`, the middleware is the right place — same pattern.

## What changes for clients

| Path | Today | After |
| --- | --- | --- |
| Success | Body: `{count, folder}` (nulls dropped). Schema: `{count, folder, support_id?, support_ts?}` | Body: `{count, folder}`. Schema: `{count, folder}`. No headers. |
| Suppressed failure | Body: `{count: 0, folder: null, support_id, support_ts}` | Body: `{count: 0, folder: null}`. Headers: `x-ag-support-id`, `x-ag-support-ts`. |
| Intercepted 5xx | Body: `{detail: {message, support_id, support_ts, operation_id}}` | Body: `{detail: {message, operation_id}}`. Headers: `x-ag-support-id`, `x-ag-support-ts`. |
| Intercepted 409 (conflict) | Body: `{detail: {message, conflict, support_id, support_ts}}` | Body: `{detail: {message, conflict}}`. Headers: `x-ag-support-id`, `x-ag-support-ts`. |

The schema for success responses becomes clean. Customers reading
[fetch-folder](https://agenta.ai/docs/reference/api/fetch-folder) no
longer see two mystery fields.

Three response shapes change on the wire (see table above): suppressed
failures, intercepted 5xx errors, and intercepted 409 conflicts all stop
carrying `support_id` / `support_ts` in the body and emit them only as
response headers. Clients reading `response.support_id` on a
gracefully-failed fetch/query, or reading `detail.support_id` on a 5xx
or 409, will need to read the headers instead. We assess this as
low-impact: the body fields shipped 3 weeks ago, were only populated on
non-success branches, and there's no documented client guidance to read
them.
