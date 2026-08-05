# Plan: G5 — Invoke Negotiation Model (Explicit HTTP Content Negotiation)

> Status: draft
> Date: 2026-03-17
> Gaps addressed: G5, G5a
> Companion: [gap-analysis.md](./gap-analysis.md), [plan.md](./plan.md) (checkpoint 1b)

---

## 1. Problem Statement

### G5 — Invoke Negotiation Model Needs To Be Explicit

The invoke contract currently uses two different mechanisms to decide response format:

1. **Handler return type** — generator/async generator → `WorkflowServiceStreamResponse`; plain value → `WorkflowServiceBatchResponse`.
2. **`@workflow(aggregate=True)` decorator flag** — tells `NormalizerMiddleware` to eagerly collect a generator into `WorkflowServiceBatchResponse` before returning.
3. **`Accept` header** — governs only the wire format for streams (SSE vs NDJSON), not whether streaming happens at all.

The problem: **callers have no explicit control.** Whether they receive JSON or a stream is determined by the SDK handler's internal return type and decorator flags — neither of which callers can observe or override. `aggregate` on `@workflow` is a response-format command baked into the handler definition — exactly the kind of authored flag that G5 targets for removal.

### G5a — SDK Programmatic Invoke Must Mirror HTTP

The SDK's programmatic invoke path has no response-mode API, so it will drift from the HTTP surface unless a unified model is established now.

---

## 2. Two `aggregate` Params — Both To Be Removed

There are two params with the same name in different decorators:

| Decorator | Param | Purpose | Decision |
|-----------|-------|---------|----------|
| `@workflow(aggregate=...)` | `bool \| Callable` | Tells `NormalizerMiddleware` to collect the generator into a batch before returning | **Remove** — response format belongs to the caller via `Accept` |
| `@instrument(aggregate=...)` | `Callable` | Optional custom reducer applied to collected chunks before writing span output | **Remove** — default behavior is sufficient |

### Why `@instrument(aggregate=...)` can also be removed

The tracing decorator already collects all chunks as it yields them (`_result.append(chunk); yield chunk`). After the generator is exhausted, it records the output in the span using a default fallback:

```python
# current default in tracing.py (lines 121-126, 189-194):
if self.aggregate and callable(self.aggregate):
    result = self.aggregate(_result)           # custom reducer — REMOVING THIS
elif all(isinstance(r, str) for r in _result):
    result = "".join(_result)                  # join strings
elif all(isinstance(r, bytes) for r in _result):
    result = b"".join(_result)                 # join bytes
else:
    result = _result                            # list fallback
```

The `aggregate` callable is just an override for the join/list logic. The defaults already handle the common cases correctly. Tracing should record what the workflow actually returned — strings joined, bytes joined, objects as a list. No custom reducer is needed.

---

## 3. Current State

### Key Files

| File | Role |
|------|------|
| `sdk/agenta/sdk/decorators/routing.py` | `_pick_stream_format()`, `handle_invoke_success()`, response helpers |
| `sdk/agenta/sdk/middlewares/running/normalizer.py` | `_normalize_response()` — decides Batch vs Stream from return type + `RunningContext.aggregate` |
| `sdk/agenta/sdk/contexts/running.py` | `RunningContext.aggregate`, `RunningContext.annotate` |
| `sdk/agenta/sdk/contexts/tracing.py` | `TracingContext.aggregate` |
| `sdk/agenta/sdk/decorators/running.py` | `@workflow(aggregate=..., annotate=...)` — sets context flags |
| `sdk/agenta/sdk/decorators/tracing.py` | `@instrument(aggregate=...)` — optional custom reducer for span output |
| `sdk/agenta/sdk/models/workflows.py` | `WorkflowServiceRequest`, `WorkflowFlags`, response models |
| `web/oss/src/services/workflows/invoke.ts` | `invokeApplication()`, `invokeEvaluator()` — always JSON, no Accept header set |
| `api/oss/src/apis/fastapi/workflows/router.py` | API invoke route handler |

### Current Negotiation Flow

```
Caller  ──POST /invoke──►  API router  ──►  SDK workflow.invoke()
                                                   │
                                          NormalizerMiddleware
                                                   │
                                  handler returns generator?
                                         │              │
                                        yes             no
                                         │              │
                               aggregate=True?    WorkflowServiceBatchResponse
                                    │    │
                                   yes   no
                                    │    │
                            BatchResponse  StreamResponse
                                              │
                                    routing.py: _pick_stream_format()
                                    Accept: text/event-stream → SSE
                                    default → NDJSON
```

---

## 4. Target State

### Negotiation Semantics

The `Accept` header drives whether the response is JSON or a stream. The routing layer is the sole decision point, evaluated after the handler runs.

**Negotiation table:**

| Accept header | Handler produces | Result |
|---------------|-----------------|--------|
| absent or `*/*` | batch | `200 application/json` — server picks |
| absent or `*/*` | stream | `200 application/x-ndjson` — server picks |
| `application/json` | batch | `200 application/json` |
| `application/json` | stream | `406 Not Acceptable` |
| `text/event-stream` | stream | `200 text/event-stream` (SSE) |
| `text/event-stream` | batch | `406 Not Acceptable` |
| `application/x-ndjson` | stream | `200 application/x-ndjson` |
| `application/x-ndjson` | batch | `406 Not Acceptable` |
| `application/jsonl` | stream | `200 application/jsonl` (alias for NDJSON) |
| `application/jsonl` | batch | `406 Not Acceptable` |

**Rules:**
- No transparent aggregation at the routing boundary. If `Accept` and handler output don't match → `406`.
- `*/*` or absent Accept → server picks the most natural format for what the handler returned.
- The `406` response is a client error. The handler has already run by the time 406 is returned, so the trace exists.

### G5a Target

The SDK programmatic `invoke()` exposes a `response_mode` parameter that mirrors HTTP `Accept` semantics. Default is `None` (server picks, equivalent to `*/*`).

```python
response = await workflow.invoke(
    request=request,
    response_mode="application/json",  # or "text/event-stream", "*/*", None
)
```

### Tracing

Tracing is unaffected. The `@instrument` decorator always collects chunks as it yields them (inside the OTel span), regardless of what the routing layer does with the response afterward. Span output is recorded as: joined string if all chunks are strings, joined bytes if all bytes, list otherwise.

---

## 5. Implementation Plan

### Step 1 — Replace `_pick_stream_format` with strict content negotiation

**File:** `sdk/agenta/sdk/decorators/routing.py`

Replace `_pick_stream_format()` with two functions:

```python
BATCH_MEDIA_TYPES = {"application/json"}
STREAM_MEDIA_TYPES = {"text/event-stream", "application/x-ndjson", "application/jsonl"}
SUPPORTED_MEDIA_TYPES = BATCH_MEDIA_TYPES | STREAM_MEDIA_TYPES

def _parse_accept(request: Request) -> Optional[str]:
    """Return the first matching supported media type, or None for */* / absent."""
    accept = request.headers.get("accept", "")
    for media_type in SUPPORTED_MEDIA_TYPES:
        if media_type in accept:
            return media_type
    return None  # */* or absent — server picks

def _stream_wire_format(media_type: str) -> str:
    """Map a streaming media type to its wire format name."""
    if media_type == "text/event-stream":
        return "sse"
    return "ndjson"  # application/x-ndjson, application/jsonl
```

**Outcome:** `_parse_accept` returns a specific type when the caller has a preference, or `None` when the server should pick freely.

---

### Step 2 — Rewrite `handle_invoke_success` with strict matching

**File:** `sdk/agenta/sdk/decorators/routing.py`

```python
async def handle_invoke_success(req: Request, response: Any) -> Response:
    requested = _parse_accept(req)  # specific type or None

    # Normalize raw values
    if not isinstance(response, (WorkflowServiceBatchResponse, WorkflowServiceStreamResponse)):
        response = WorkflowServiceBatchResponse(data=response)

    is_batch = isinstance(response, WorkflowServiceBatchResponse)
    is_stream = isinstance(response, WorkflowServiceStreamResponse)

    # Caller has no preference — server picks
    if requested is None:
        if is_batch:
            return _make_json_response(response)
        return _make_stream_response(response, "ndjson")  # default stream format

    # Caller wants JSON — only works if handler returned batch
    if requested == "application/json":
        if is_batch:
            return _make_json_response(response)
        return _make_not_acceptable_response(requested, response)

    # Caller wants a stream format — only works if handler returned stream
    if requested in STREAM_MEDIA_TYPES:
        if is_stream:
            return _make_stream_response(response, _stream_wire_format(requested))
        return _make_not_acceptable_response(requested, response)
```

New helpers needed:
- `_make_not_acceptable_response(requested, response)` → `JSONResponse` with `status=406`, includes `requested`, `supported` (what the handler can produce), and `trace_id`/`span_id` from the response.
- `_make_stream_response` takes the wire format name directly instead of reading the `Accept` header again.

**Key design decision: no transparent aggregation.** If `Accept: application/json` is sent but the handler streams, the caller gets `406`. The caller should either not set `Accept` (let the server pick) or set a streaming type.

---

### Step 3 — Remove `aggregate` from the response layer

**Files:**
- `sdk/agenta/sdk/decorators/running.py` — remove `aggregate` param from `workflow.__init__`, `invoke()`, `inspect()`; remove `running_ctx.aggregate = self.aggregate` and `tracing_ctx.aggregate = self.aggregate`
- `sdk/agenta/sdk/contexts/running.py` — remove `aggregate` field from `RunningContext`
- `sdk/agenta/sdk/middlewares/running/normalizer.py` — remove the `RunningContext.aggregate` branch in both `isasyncgen` and `isgenerator` paths; always return `WorkflowServiceStreamResponse` for generators

**Before (normalizer):**
```python
if isasyncgen(result):
    if RunningContext.get().aggregate:
        collected = [item async for item in result]
        return WorkflowServiceBatchResponse(...)
    return WorkflowServiceStreamResponse(generator=iterator, ...)
```

**After (normalizer):**
```python
if isasyncgen(result):
    return WorkflowServiceStreamResponse(generator=iterator, ...)
```

The normalizer has one job: normalize return types into typed response objects. The batch/stream decision belongs to the caller.

---

### Step 4 — Remove `aggregate` from the tracing layer

**Files:**
- `sdk/agenta/sdk/decorators/tracing.py` — remove `aggregate` param from `instrument.__init__`; remove the `if self.aggregate and callable(self.aggregate)` branch in both `astream_wrapper` and `stream_wrapper`; keep the default join/list logic
- `sdk/agenta/sdk/contexts/tracing.py` — remove `aggregate` field from `TracingContext`

**Before (tracing generator `finally` block):**
```python
if self.aggregate and callable(self.aggregate):
    result = self.aggregate(_result)
elif all(isinstance(r, str) for r in _result):
    result = "".join(_result)
...
```

**After:**
```python
if all(isinstance(r, str) for r in _result):
    result = "".join(_result)
elif all(isinstance(r, bytes) for r in _result):
    result = b"".join(_result)
else:
    result = _result
self._post_instrument(span, result)
```

Tracing records what the workflow returned: joined strings, joined bytes, or a list.

---

### Step 5 — Add `response_mode` to SDK programmatic invoke (G5a)

**File:** `sdk/agenta/sdk/decorators/running.py`

```python
async def invoke(
    self,
    *,
    request: WorkflowServiceRequest,
    response_mode: Optional[str] = None,  # None = server picks, like */*
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    ...
    response = await call_next(request)
    return _apply_response_mode(response, response_mode)
```

`_apply_response_mode` shares the same logic as `handle_invoke_success` (Step 2), minus the HTTP response objects — it raises a typed exception on mismatch instead of returning a `JSONResponse`.

---

### Step 6 — Update OpenAPI response documentation

**File:** `sdk/agenta/sdk/decorators/routing.py`

```python
invoke_responses: dict = {
    200: {
        "description": "Negotiated response — format determined by Accept header",
        "content": {
            "application/json": {"schema": WorkflowServiceBatchResponse.model_json_schema()},
            "application/x-ndjson": {"schema": {"type": "string", "description": "NDJSON stream"}},
            "application/jsonl": {"schema": {"type": "string", "description": "JSONL stream"}},
            "text/event-stream": {"schema": {"type": "string", "description": "SSE stream"}},
        },
    },
    406: {
        "description": "Accept header requests a format the runnable cannot produce",
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "detail": {"type": "string"},
                        "requested": {"type": "string"},
                        "supported": {"type": "array", "items": {"type": "string"}},
                    },
                }
            }
        },
    },
}
```

---

### Step 7 — Frontend: keep no explicit Accept (do not add `Accept: application/json`)

**File:** `web/oss/src/services/workflows/invoke.ts`

The frontend does not set an explicit `Accept` header. With no `Accept`, the server picks the format based on what the handler returns:
- Batch handler → JSON (current behavior preserved)
- Streaming handler → NDJSON (frontend currently doesn't handle streams — this is a new capability to add later)

Do **not** add `Accept: application/json` to `invokeApplication()` / `invokeEvaluator()`. Adding it would cause 406 for any streaming handler the frontend calls. The frontend should remain format-agnostic at the invoke layer until it has explicit streaming support.

---

## 6. Affected Files Summary

| File | Change | Phase |
|------|--------|-------|
| `sdk/agenta/sdk/decorators/routing.py` | Replace `_pick_stream_format` with `_parse_accept`; rewrite `handle_invoke_success`; add `_make_not_acceptable_response`; update `invoke_responses` | Checkpoint 1 |
| `sdk/agenta/sdk/decorators/running.py` | Remove `aggregate` from `workflow.__init__`, `invoke()`, `inspect()`; add `response_mode` param to `invoke()` | Checkpoint 1 |
| `sdk/agenta/sdk/contexts/running.py` | Remove `aggregate` field | Checkpoint 1 |
| `sdk/agenta/sdk/middlewares/running/normalizer.py` | Remove `RunningContext.aggregate` branch; always pass generators through | Checkpoint 1 |
| `sdk/agenta/sdk/decorators/tracing.py` | Remove `aggregate` param and custom-reducer branch; keep default join/list | Checkpoint 1 |
| `sdk/agenta/sdk/contexts/tracing.py` | Remove `aggregate` field | Checkpoint 1 |
| `web/oss/src/services/workflows/invoke.ts` | No change — no explicit Accept added | — |
| `api/oss/src/apis/fastapi/workflows/router.py` | No change — already passes `Request` to routing helpers | — |

---

## 7. Tests

### Unit tests — routing (`sdk/agenta/sdk/decorators/routing.py`)

**`_parse_accept`:**
- No `Accept` header → `None`
- `Accept: */*` → `None`
- `Accept: application/json` → `"application/json"`
- `Accept: text/event-stream` → `"text/event-stream"`
- `Accept: application/x-ndjson` → `"application/x-ndjson"`
- `Accept: application/jsonl` → `"application/jsonl"`
- Unknown type only → `None` (falls through to server-picks)

**`handle_invoke_success` — batch response:**
- No Accept → `200 application/json`
- `Accept: */*` → `200 application/json`
- `Accept: application/json` → `200 application/json`
- `Accept: text/event-stream` → `406`
- `Accept: application/x-ndjson` → `406`

**`handle_invoke_success` — stream response:**
- No Accept → `200 application/x-ndjson` (server default for streams)
- `Accept: */*` → `200 application/x-ndjson`
- `Accept: text/event-stream` → `200 text/event-stream` (SSE)
- `Accept: application/x-ndjson` → `200 application/x-ndjson`
- `Accept: application/jsonl` → `200 application/jsonl`
- `Accept: application/json` → `406`

**`_make_not_acceptable_response`:**
- Returns `status=406`
- Body contains `requested` and `supported` fields
- `trace_id` / `span_id` included when present

### Unit tests — normalizer (`sdk/agenta/sdk/middlewares/running/normalizer.py`)

- Async generator → `WorkflowServiceStreamResponse` (no aggregation, no batch)
- Sync generator → `WorkflowServiceStreamResponse`
- Plain value → `WorkflowServiceBatchResponse`
- Awaitable returning plain value → `WorkflowServiceBatchResponse`
- Already `WorkflowServiceBatchResponse` → pass through unchanged
- Already `WorkflowServiceStreamResponse` → pass through unchanged
- `RunningContext` has no `aggregate` field (attribute error test)

### Unit tests — tracing (`sdk/agenta/sdk/decorators/tracing.py`)

- Async generator with all-string chunks → span output is `"".join(chunks)` (one string)
- Async generator with all-bytes chunks → span output is `b"".join(chunks)`
- Async generator with mixed/dict chunks → span output is the list
- Chunks are still yielded to the caller while the span is open (passthrough behavior preserved)
- `@instrument` accepts no `aggregate` parameter (signature test)
- `TracingContext` has no `aggregate` field

### SDK integration tests

Spin up a minimal FastAPI app with `@workflow`-decorated handlers:

- Batch handler (returns plain value) + no Accept → `200 application/json`
- Batch handler + `Accept: application/json` → `200 application/json`
- Batch handler + `Accept: text/event-stream` → `406`
- Streaming handler (async generator) + no Accept → `200 application/x-ndjson`
- Streaming handler + `Accept: application/x-ndjson` → `200 application/x-ndjson`, body is valid NDJSON
- Streaming handler + `Accept: text/event-stream` → `200 text/event-stream`, body is valid SSE
- Streaming handler + `Accept: application/json` → `406`
- `workflow.invoke(response_mode=None)` + batch handler → `WorkflowServiceBatchResponse`
- `workflow.invoke(response_mode=None)` + streaming handler → `WorkflowServiceStreamResponse`
- `workflow.invoke(response_mode="application/json")` + batch handler → `WorkflowServiceBatchResponse`
- `workflow.invoke(response_mode="application/json")` + streaming handler → raises / returns error
- `workflow.invoke(response_mode="text/event-stream")` + streaming handler → `WorkflowServiceStreamResponse`

### Service / API tests

Against a running API + SDK service:

- `POST /invoke` (no Accept, batch handler) → `200`, `Content-Type: application/json`, valid `WorkflowServiceBatchResponse`
- `POST /invoke` (`Accept: application/json`, batch handler) → `200`, body matches schema
- `POST /invoke` (`Accept: text/event-stream`, streaming handler) → `200`, SSE stream, `x-ag-trace-id` header present
- `POST /invoke` (`Accept: application/json`, streaming handler) → `406`, body has `detail` + `requested`
- `POST /invoke` (`Accept: text/event-stream`, batch handler) → `406`
- Trace is created and visible after a `406` response (handler ran, trace should exist)

### Tracing-specific tests

- Streaming handler invoked: trace span output = joined string (when string chunks)
- Streaming handler invoked: trace span output = list (when dict/object chunks)
- Batch handler invoked: trace span output = the returned value
- `406` response: trace exists and is marked with appropriate status (not an error on the handler side — handler succeeded; client sent wrong Accept)

---

## 8. Non-Goals (Out of Scope for G5/G5a)

- Removing `stream`, `evaluate`, `chat`, `verbose` from legacy serving — G1.
- Trace context propagation — G6.
- Schema-derived chat semantics — checkpoint 1c.
- URI-derived classification — checkpoint 1a.
- `annotate` removal — G4/1d.
- `application/jsonl` wire encoding — same bytes as NDJSON; register alias, reuse formatter.
- Frontend streaming support — separate feature; frontend stays format-agnostic until then.

---

## 9. Migration and Compatibility

- **No breaking changes for HTTP callers** that send no `Accept` header. Batch handlers → JSON, streaming handlers → NDJSON. Same as current behavior.
- **Callers sending `Accept: application/json`** that talk to streaming handlers will now get `406` instead of silently waiting for the stream to be collected. This is intentional — they should either remove the `Accept` header or use a streaming type.
- **`@workflow(aggregate=True)` usages:** param removed. Handlers that yield generators now return `WorkflowServiceStreamResponse`. With no Accept header, the caller gets NDJSON (for streaming handlers) or JSON (for batch handlers) — server picks. Net behavior: streaming handlers are now actually streamed instead of silently batched. If a handler was using `aggregate=True` to force-batch a generator for a caller that wanted JSON, that caller needs to either stop setting `Accept: application/json` or refactor the handler to return a plain value.
- **`@instrument(aggregate=some_callable)` usages:** param removed. If the custom reducer was important, move the transformation into the handler's return value.
