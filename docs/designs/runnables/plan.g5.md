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

The problem: **callers have no explicit control.** Whether they receive JSON or a stream is determined by the SDK handler's internal return type and decorator flags — neither of which callers can observe or override. The `WorkflowServiceRequest` model has no response-mode field. Callers that always want JSON (e.g. the frontend) get it accidentally because most handlers return plain values, not because they asked for it.

`aggregate` on `@workflow` is a **response-format command baked into the handler definition** — exactly the kind of authored flag that G5 targets for removal.

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
    result = self.aggregate(_result)          # custom reducer
elif all(isinstance(r, str) for r in _result):
    result = "".join(_result)                  # join strings
elif all(isinstance(r, bytes) for r in _result):
    result = b"".join(_result)                 # join bytes
else:
    result = _result                            # list fallback
```

The `aggregate` callable is just an override for the join/list logic. The defaults already handle the common cases correctly. Tracing should record what the workflow actually returned — if it streamed strings, join them; if it streamed objects, keep the list. No custom reducer is needed.

Removing the `aggregate` branch leaves the default join/list logic in place — same observable behavior for all existing handlers.

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

### What's Missing

- `WorkflowServiceRequest` has no field for the caller to declare a desired response media type.
- `Accept` header is consulted only after the batch/stream decision is already made.
- The frontend never sets an `Accept` header — it gets JSON because handlers happen to return plain values.
- The SDK programmatic invoke path has no response-mode parameter.
- `aggregate` on `@workflow` is a decorator-level response-format command that should belong to the caller.

---

## 4. Target State

### G5 Target

All response-mode negotiation moves to **HTTP `Accept` header semantics**, evaluated at the routing boundary:

| `Accept` header value | Response |
|-----------------------|----------|
| `application/json` (or absent) | `WorkflowServiceBatchResponse` as JSON |
| `text/event-stream` | `WorkflowServiceStreamResponse` as SSE |
| `application/x-ndjson` | `WorkflowServiceStreamResponse` as NDJSON |
| `application/jsonl` | `WorkflowServiceStreamResponse` as JSONL (alias for NDJSON) |

Rules:
- Caller requests a streaming type but handler returns a plain value → `406 Not Acceptable`.
- Caller requests `application/json` but handler yields a generator → routing layer collects the stream transparently.
- No `Accept` header → `application/json` (existing behavior, no breaking change).

`NormalizerMiddleware` always passes generators through as `WorkflowServiceStreamResponse`. It no longer reads `RunningContext.aggregate` to decide batch vs stream.

### G5a Target

The SDK programmatic `invoke()` exposes a `response_mode` parameter that mirrors HTTP `Accept` semantics:

```python
response = await workflow.invoke(
    request=request,
    response_mode="application/json",  # or "text/event-stream", "application/x-ndjson"
)
```

---

## 5. Implementation Plan

### Step 1 — Replace `_pick_stream_format` with full media-type negotiation

**File:** `sdk/agenta/sdk/decorators/routing.py`

Replace `_pick_stream_format()` with `_negotiate_response_media_type(request)` that returns one of the four supported media types:

```python
SUPPORTED_MEDIA_TYPES = [
    "application/json",
    "text/event-stream",
    "application/x-ndjson",
    "application/jsonl",
]

def _negotiate_response_media_type(request: Request) -> str:
    accept = request.headers.get("accept", "")
    for media_type in SUPPORTED_MEDIA_TYPES:
        if media_type in accept:
            return media_type
    # */* or absent → default to JSON
    return "application/json"
```

**Outcome:** The negotiated media type is a first-class value evaluated once at the boundary, not an implicit side-effect of reading `Accept` deep in `_make_stream_response`.

---

### Step 2 — Make `handle_invoke_success` enforce the negotiated media type

**File:** `sdk/agenta/sdk/decorators/routing.py`

```python
async def handle_invoke_success(req: Request, response: Any) -> Response:
    media_type = _negotiate_response_media_type(req)

    if isinstance(response, WorkflowServiceBatchResponse):
        if media_type in ("text/event-stream", "application/x-ndjson", "application/jsonl"):
            return _make_not_acceptable_response(media_type)
        return _make_json_response(response)

    if isinstance(response, WorkflowServiceStreamResponse):
        if media_type == "application/json":
            # caller asked for JSON — collect stream transparently at the boundary
            batch = await _collect_stream(response)
            return _make_json_response(batch)
        return _make_stream_response(req, response, media_type)

    # raw value — wrap as batch
    batch = WorkflowServiceBatchResponse(data=response)
    return _make_json_response(batch)
```

New helpers needed:
- `_make_not_acceptable_response(requested_media_type)` → `JSONResponse` with `status=406`
- `_collect_stream(response: WorkflowServiceStreamResponse)` → `WorkflowServiceBatchResponse` (iterates `response.iterator()`, collects outputs)

**Tracing note:** `_collect_stream` iterates the generator. The `@instrument` decorator wraps the generator's execution inside `start_as_current_span`, so the OTel span stays open during iteration regardless of where the iterator is consumed. No tracing impact.

**Outcome:** Explicit `406` when streaming is requested from a non-streaming handler. Transparent batching when JSON is requested from a streaming handler.

---

### Step 3 — Remove `aggregate` from everywhere

**3a. Response layer (`@workflow`, `RunningContext`, `NormalizerMiddleware`):**
- `sdk/agenta/sdk/decorators/running.py` — remove `aggregate` param from `workflow.__init__`, `invoke()`, `inspect()`
- `sdk/agenta/sdk/contexts/running.py` — remove `aggregate` field from `RunningContext`
- `sdk/agenta/sdk/middlewares/running/normalizer.py` — remove the `RunningContext.aggregate` branch; always pass generators through as `WorkflowServiceStreamResponse`

**Before (normalizer):**
```python
if isasyncgen(result):
    if RunningContext.get().aggregate:
        collected = [item async for item in result]
        return WorkflowServiceBatchResponse(data=..., outputs=collected, ...)
    return WorkflowServiceStreamResponse(generator=iterator, ...)
```

**After (normalizer):**
```python
if isasyncgen(result):
    return WorkflowServiceStreamResponse(generator=iterator, ...)
```

**3b. Tracing layer (`@instrument`, `TracingContext`):**
- `sdk/agenta/sdk/decorators/tracing.py` — remove `aggregate` param from `instrument.__init__`; remove the `if self.aggregate and callable(self.aggregate)` branch in both generator wrappers; keep the default join/list fallback
- `sdk/agenta/sdk/contexts/tracing.py` — remove `aggregate` field from `TracingContext`

**Before (tracing generator `finally` block):**
```python
if self.aggregate and callable(self.aggregate):
    result = self.aggregate(_result)
elif all(isinstance(r, str) for r in _result):
    result = "".join(_result)
elif all(isinstance(r, bytes) for r in _result):
    result = b"".join(_result)
else:
    result = _result
self._post_instrument(span, result)
```

**After (tracing generator `finally` block):**
```python
if all(isinstance(r, str) for r in _result):
    result = "".join(_result)
elif all(isinstance(r, bytes) for r in _result):
    result = b"".join(_result)
else:
    result = _result
self._post_instrument(span, result)
```

Tracing records what the workflow actually returned: joined strings, joined bytes, or a list of items. No custom reducer, no flag — just the natural output.

**Outcome:** `aggregate` is removed from both the response contract and the tracing contract. The normalizer has one job (normalize types). The tracing decorator has one job (record what ran). The caller controls response format via `Accept`.

---

### Step 4 — Add `response_mode` to SDK programmatic invoke (G5a)

**File:** `sdk/agenta/sdk/decorators/running.py`

```python
async def invoke(
    self,
    *,
    request: WorkflowServiceRequest,
    response_mode: str = "application/json",
    secrets: Optional[list] = None,
    credentials: Optional[str] = None,
    **kwargs,
) -> Union[WorkflowServiceBatchResponse, WorkflowServiceStreamResponse]:
    ...
    # after running middlewares, apply same negotiation as HTTP boundary:
    return _apply_response_mode(response, response_mode)
```

Where `_apply_response_mode` mirrors the logic in `handle_invoke_success` (Step 2), minus the HTTP-specific parts.

**Outcome:** SDK programmatic invoke and HTTP invoke have identical response-mode semantics.

---

### Step 5 — Update OpenAPI response documentation

**File:** `sdk/agenta/sdk/decorators/routing.py`

```python
invoke_responses: dict = {
    200: {
        "description": "Negotiated response: JSON batch or NDJSON/SSE/JSONL stream",
        "content": {
            "application/json": {"schema": WorkflowServiceBatchResponse.model_json_schema()},
            "application/x-ndjson": {"schema": {"type": "string", "description": "NDJSON stream"}},
            "application/jsonl": {"schema": {"type": "string", "description": "JSONL stream"}},
            "text/event-stream": {"schema": {"type": "string", "description": "SSE stream"}},
        },
    },
    406: {
        "description": "Runnable cannot satisfy the requested Accept media type",
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

### Step 6 — Make frontend invoke explicit

**File:** `web/oss/src/services/workflows/invoke.ts`

Add `Accept: "application/json"` to `invokeApplication()` and `invokeEvaluator()`. Currently works by accident (server defaults to JSON); make it explicit so the contract is declared, not implied.

```typescript
headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...authHeaders,
},
```

For future streaming use cases (playground), callers set `Accept: text/event-stream` or `Accept: application/x-ndjson` and handle the stream response.

---

## 6. Affected Files Summary

| File | Change | Phase |
|------|--------|-------|
| `sdk/agenta/sdk/decorators/routing.py` | Replace `_pick_stream_format` with `_negotiate_response_media_type`; rewrite `handle_invoke_success`; add `_make_not_acceptable_response`, `_collect_stream`; update `invoke_responses` | Checkpoint 1 |
| `sdk/agenta/sdk/decorators/running.py` | Remove `aggregate` from `workflow.__init__`, `invoke()`, `inspect()`; add `response_mode` param to `invoke()` | Checkpoint 1 |
| `sdk/agenta/sdk/contexts/running.py` | Remove `aggregate` field from `RunningContext` | Checkpoint 1 |
| `sdk/agenta/sdk/middlewares/running/normalizer.py` | Remove `RunningContext.aggregate` branch; always pass generators through as `WorkflowServiceStreamResponse` | Checkpoint 1 |
| `sdk/agenta/sdk/decorators/tracing.py` | Remove `aggregate` param from `instrument`; remove custom reducer branch; keep default join/list logic | Checkpoint 1 |
| `sdk/agenta/sdk/contexts/tracing.py` | Remove `aggregate` field from `TracingContext` | Checkpoint 1 |
| `web/oss/src/services/workflows/invoke.ts` | Add explicit `Accept: application/json` to invoke calls | Checkpoint 1 |
| `api/oss/src/apis/fastapi/workflows/router.py` | No change — already passes `Request` to `handle_invoke_success` | — |

---

## 7. Non-Goals (Out of Scope for G5/G5a)

- Removing `stream`, `evaluate`, `chat`, `verbose` from legacy serving — covered by G1 deprecation plan.
- Trace context propagation — covered by G6.
- Schema-derived chat semantics — covered by checkpoint 1c.
- URI-derived classification — covered by checkpoint 1a.
- `annotate` removal — deferred; covered by G4/1d (URI family classification).
- `application/jsonl` wire encoding — same bytes as NDJSON; register the alias, reuse the formatter.

---

## 8. Migration and Compatibility

- **No breaking changes for callers.** Callers that send no `Accept` header continue to get `application/json`.
- The `406` path is new behavior but only triggers for callers that explicitly request a streaming media type — no existing caller does this.
- **`@workflow(aggregate=True)` callers:** the param is removed. Handlers that yield generators will now return `WorkflowServiceStreamResponse`. With no `Accept` header, the routing boundary transparently collects the stream into JSON — same end result, decision point moves to the boundary.
- **`@instrument(aggregate=some_callable)` callers:** the param is removed. The default join/list logic in tracing already handles strings, bytes, and mixed outputs correctly. If a caller relied on a custom reducer, they should move that transformation into their handler's return value instead.
