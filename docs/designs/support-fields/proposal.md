# Proposal — move support metadata to response headers

## Headers

When `suppress_exceptions` or `intercept_exceptions` activates, the
response carries:

- `x-ag-support-id` — UUID4 string
- `x-ag-support-ts` — ISO-8601 UTC timestamp

On the happy path: no headers, no body fields, no schema entries.

## Code shape

### 1. `Support` model stays; `attach_support` is rewritten

[api/oss/src/utils/exceptions.py](../../../api/oss/src/utils/exceptions.py)

```python
class Support(BaseModel):
    support_id: Optional[str] = None
    support_ts: Optional[datetime] = None


def build_support() -> Support:
    return Support(
        support_id=str(uuid4()),
        support_ts=datetime.now(timezone.utc),
    )


def attach_support(request: Optional[Request], support: Support) -> None:
    """Stash support metadata on request.state; a middleware emits the headers."""
    if request is not None:
        request.state.support = support
```

The function no longer returns the payload — it mutates `request.state`.
Callers just `return default` after invoking it.

### 2. `suppress_exceptions` no longer needs the response model to carry fields

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
                request = kwargs.get("request")
                request = request if isinstance(request, Request) else None

                if verbose:
                    log.warn(
                        f"[SUPPRESSED] {message}\n{format_exc()}",
                        support_id=support.support_id,
                        support_ts=support.support_ts,
                        operation_id=operation_id,
                    )

                attach_support(request, support)
                return default

        return wrapper
    return decorator
```

Key differences vs. today:

- `kwargs.get("request")` (not `pop`) — handler still needs it.
- `attach_support` is called for side effects only.
- `return default` returns the bare payload — no `model_copy`, no field
  patching.

### 3. `intercept_exceptions` also stashes support on `request.state`

```python
# inside intercept_exceptions wrapper, on the unexpected-exception branch:
support = build_support()
attach_support(request, support)
# ... existing logging ...
raise HTTPException(
    status_code=500,
    detail=jsonable_encoder({
        "message": message,
        "support_id": support.support_id,   # kept in detail for clients
        "support_ts": support.support_ts,   # who parse the error body
        "operation_id": operation_id,
    }),
) from e
```

We keep `support_id` / `support_ts` inside `detail` for the 5xx case —
that's where they live today, no schema pollution (errors aren't typed
response models), and a client parsing the error body gets them
immediately. The header is added on top, redundantly, so both
header-aware and body-aware clients work.

The `EntityCreationConflict` branch gets the same treatment.

### 4. Middleware emits the headers

[api/entrypoints/routers.py](../../../api/entrypoints/routers.py) — alongside the existing `authentication_middleware`, `analytics_middleware`:

```python
async def support_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    support = getattr(request.state, "support", None)
    if support is not None:
        if support.support_id:
            response.headers["x-ag-support-id"] = support.support_id
        if support.support_ts:
            response.headers["x-ag-support-ts"] = support.support_ts.isoformat()
    return response

app.middleware("http")(support_headers_middleware)
```

Registered early enough that it sees state set by the route handler.
Starlette runs middlewares in reverse-registration order on the way out,
so the registration position relative to auth/analytics doesn't change
behavior here — it just needs to wrap the route.

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
  assert that after the decorated function runs, `request.state.support`
  is set and has UTC timestamp + non-empty id.
- `test_intercept_exceptions_includes_support_metadata` — keep, still
  asserts `detail["support_id"]` and `detail["support_ts"]`.
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
|---|---|---|
| Success | Body: `{count, folder}` (nulls dropped). Schema: `{count, folder, support_id?, support_ts?}` | Body: `{count, folder}`. Schema: `{count, folder}`. No headers. |
| Suppressed failure | Body: `{count: 0, folder: null, support_id, support_ts}` | Body: `{count: 0, folder: null}`. Headers: `x-ag-support-id`, `x-ag-support-ts`. |
| Intercepted 5xx | Body: `{detail: {message, support_id, support_ts, operation_id}}` | Body: same. Headers: `x-ag-support-id`, `x-ag-support-ts` added. |

The schema for success responses becomes clean. Customers reading
[fetch-folder](https://agenta.ai/docs/reference/api/fetch-folder) no
longer see two mystery fields.

The suppressed-failure body is the only breaking change on the wire — any
client reading `response.support_id` on a fetch/query that gracefully
failed will need to read the header instead. We assess this as
low-impact: the field shipped 3 weeks ago, is only populated on the
failure branch, and there's no documented client guidance to read it.
