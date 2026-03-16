# Tracing Query Event - Plan

## Goal

Add a new internal event that records tracing read activity for spans, stores it in the existing events pipeline, and keeps it out of webhook subscriptions.

## Recommended Scope Decision

Before implementation, lock the semantics to avoid duplicated or misleading events.

Recommended interpretation of the prompt:

- emit for all user-facing tracing read operations that return spans or traces:
  - `GET /preview/spans/`
  - `GET /preview/spans/{trace_id}/{span_id}`
  - `POST /preview/spans/query`
  - `GET /preview/traces/`
  - `GET /preview/traces/{trace_id}`
  - `POST /preview/traces/query`
- emit for equivalent deprecated `/tracing/*` read/query/fetch operations while they remain mounted
- do not emit for internal service-only reads

Reason:

- this matches the prompt language most closely
- it makes the event about API retrieval, not internal helper activity
- it still avoids double counting because emission happens once at the endpoint boundary

## Proposed Event Contract

### Event type

Add a new enum member to `api/oss/src/core/events/types.py`.

Recommended value:

- `spans.retrieved`

Why this name:

- it cleanly covers both direct fetches and filtered queries as read operations
- it avoids the narrower implication of `fetched`

Do not add it to `WebhookEventType`.

### Event envelope

Use the existing generic `Event` DTO:

- `request_id`
- `event_id`
- `request_type`
- `event_type`
- `timestamp`
- `attributes`

No event-model refactor is required for the first version.

### Attributes contract

Use a bounded attributes payload like:

```json
{
  "user_id": "<uuid>",
  "count": 12,
  "links": [
    {"trace_id": "...", "span_id": "..."},
    {"trace_id": "..."}
  ]
}
```

Recommended rules:

- always include `user_id`
- always include `count`
- include returned links, allowing partial links for trace-only results
- cap the number of returned links stored in the event
- do not store full raw filtering expressions in the first version

Recommended bound:

- cap `links` at at most 1000 items while keeping `count` as the uncapped total

If there is a stronger audit requirement later, expand the payload in a follow-up after measuring size impact.

## Implementation Plan

### 1. Add the event type

Update:

- `api/oss/src/core/events/types.py`

Change:

- add `SPANS_RETRIEVED = "spans.retrieved"`

Do not update:

- `api/oss/src/core/webhooks/types.py`

### 2. Add a core tracing event helper

Preferred location:

- under the tracing core layer
- for example a small helper module near `api/oss/src/core/tracing/`

Approach:

- add a small helper that:
  - inspects the final response object
  - computes how many spans were returned
  - extracts a bounded sample of returned span IDs
  - builds and publishes the event
- call it in routers just before returning the response

Suggested helper responsibilities:

- accept the request scope:
  - `organization_id`
  - `project_id`
  - `user_id`
- generate `request_id` and `event_id`
- set `RequestType.UNKNOWN` for parity with current producers
- set `timestamp`
- build bounded `attributes`
- call `publish_event(...)` directly, following the same pattern already used in environment and webhook producers

This keeps the counting and publishing logic centralized in the core layer while matching the desired router-level emission model.

### 3. Emit at router boundaries after the full response is known

Recommended emission points:

- `SpansRouter.fetch_spans`
- `SpansRouter.fetch_span`
- `SpansRouter.query_spans`
- `TracesRouter.fetch_traces`
- `TracesRouter.fetch_trace`
- `TracesRouter.query_traces`
- equivalent deprecated tracing read/query/fetch routes that should preserve parity

Reason:

- this matches the requested behavior directly
- routers can compute the event from the final returned object instead of from intermediate DTOs
- internal service-only reads stay event-free

Recommended flow per handler:

1. Execute the existing read logic.
2. Materialize the final response object.
3. Run the core helper against that response object.
4. If `count == 0`, do not publish an event.
5. If `count > 0`, publish `spans.retrieved`.
6. If publishing fails, log the error and still return the response object normally.
7. Return the response object.

For deprecated `/tracing/spans/query`:

instrument it explicitly, along with any other deprecated tracing read/query/fetch routes, while they remain mounted

For trace endpoints:

- the same helper should convert returned traces into link-like items with `trace_id` only

### 4. Add helper logic for counting spans from final responses

The helper should support at least these shapes:

- `SpanResponse`
- `SpansResponse`
- `TraceResponse`
- `TracesResponse`
- deprecated `OTelTracingResponse`

The helper should return:

- total returned count
- capped returned links

This avoids duplicating counting and publishing logic in every route.

### 5. Pass scope consistently

When publishing, include:

- `project_id`
- `organization_id` when available from `request.state`

Store in attributes:

- `user_id`
- `count`
- `links`

Use workspace scope only if these tracing routes actually expose a stable workspace identifier in request context. Do not invent a workspace field if the router does not have one.

For request metadata:

- generate `request_id` the same way current environment/webhook producers do
- set `request_type = RequestType.UNKNOWN`

### 6. Add tests

Add or update tests in:

- `api/oss/tests/pytest/unit/events/`
- `api/oss/tests/pytest/acceptance/events/`
- `api/oss/tests/pytest/acceptance/tracing/`

Minimum test matrix:

1. Querying spans emits a `spans.retrieved` event.
2. Fetching spans emits a `spans.retrieved` event.
3. Fetching a single span emits exactly one event.
4. Querying traces emits a `spans.retrieved` event.
5. Fetching traces emits a `spans.retrieved` event.
4. Core helper correctly counts spans from:
   - span
   - spans
   - trace
   - traces
   - deprecated tracing response shapes
6. The event appears in `POST /events/query`.
7. The event is accepted by `EventType` validation.
8. The event is not present in `WebhookEventType`.
9. Returned links are capped at `1000` while `count` remains accurate.
10. Zero-count responses do not emit this event.
11. Internal service-only reads do not emit this event.
12. Event publishing failures are logged but do not fail the API response.

### 7. Update docs after behavior is settled

Only update external/reference docs once implementation semantics are final.

Likely targets:

- event query API reference
- observability query API docs if this event is part of the audit story

Not required by default:

- webhook subscription docs or frontend automation event types

## Non-Goals

Do not combine this work with:

- a full event payload typing refactor
- a request-context propagation overhaul
- changes to webhook subscription behavior
- changes to event table schema

Those are separate efforts.

## Risks and Mitigations

### Duplicate events

Risk:

- helper layering can cause more than one event per user action
- multiple routers can drift if some are instrumented and others are not

Mitigation:

- emit only once per handler, just before return
- centralize counting/publishing in one helper
- add acceptance tests for exact event counts

### Oversized payloads

Risk:

- large query results produce very large event attributes

Mitigation:

- store `count` plus capped `links` only

### Publish failures

Risk:

- event infrastructure issues could break read endpoints if handled incorrectly

Mitigation:

- fail open
- log publish errors
- still return the tracing response

### Ambiguous semantics

Risk:

- the event name may be interpreted differently across fetch and query endpoints

Mitigation:

- define `read_mode` explicitly in attributes

## Execution Checklist

- [ ] Add new `EventType`
- [ ] Implement bounded attributes contract
- [ ] Add core helper for counting spans from final responses and publishing via `publish_event(...)`
- [ ] Emit from all tracing read/query/fetch router handlers, including deprecated ones, just before return
- [ ] Pass `organization_id` where available
- [ ] Add unit and acceptance coverage
- [ ] Update docs after implementation behavior is verified
