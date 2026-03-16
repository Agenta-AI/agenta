# Tracing Query Event - Research

## Scope Restatement

The requested event is a new internal event for tracing reads. It should be emitted when spans are fetched or queried, recorded in the existing events pipeline, and explicitly remain non-subscribable by webhooks.

This document captures the current codebase state only. It does not assume implementation details that do not already exist.

## Current Events Architecture

### Event type system

- Event types live in `api/oss/src/core/events/types.py`.
- The current enum contains:
  - `unknown`
  - `environments.revisions.committed`
  - `webhooks.subscriptions.tested`
- Events are represented by the generic `Event` DTO in `api/oss/src/core/events/dtos.py`.
- `Event.attributes` is currently an untyped `Dict[str, Any] | None`.
- There is no per-event payload model registry today.

### Event publishing and ingestion

- New events are published to Redis Streams through `publish_event(...)` in `api/oss/src/core/events/streaming.py`.
- The stream message carries:
  - `organization_id`
  - `project_id`
  - optional root-level `user_id`
  - nested `event`
- The persisted `Event` itself does not have a first-class `user_id` field. User identity is currently stored inside `event.attributes` by producers that need it.
- `EventsWorker` in `api/oss/src/tasks/asyncio/events/worker.py` consumes `streams:events` and persists grouped batches through `EventsService` and `EventsDAO`.
- Events are stored in the tracing database via `api/oss/src/dbs/postgres/events/dao.py`.

### Event query API

- The event log query API is `POST /events/query`.
- The router is `api/oss/src/apis/fastapi/events/router.py`.
- The request model is `EventQueryRequest` in `api/oss/src/apis/fastapi/events/models.py`.
- The response shape is:
  - `count`
  - `events`
- Query filtering supports:
  - `request_id`
  - `request_type`
  - `event_type`
- Acceptance tests already exist in `api/oss/tests/pytest/acceptance/events/test_events_basics.py`.

## Current Webhooks Relationship

### Webhooks subscribe to only a subset of events

- `WebhookEventType` is defined in `api/oss/src/core/webhooks/types.py`.
- It is a strict subset of `EventType`, not the full list.
- Today the subscribable subset is:
  - `environments.revisions.committed`
  - `webhooks.subscriptions.tested`

### Important implication for the new tracing read event

- A new event can exist in `EventType` without being added to `WebhookEventType`.
- That is the correct mechanism for "logged in events, but not subscribable by webhooks".

## Current Event Producers

Only two real producers currently emit events:

### Environment revision commit

- Implemented in `api/oss/src/core/environments/service.py`.
- Builds an `Event` inline and publishes it with `publish_event(...)`.
- Stores `user_id` inside `attributes`.
- Uses:
  - generated `request_id`
  - generated `event_id`
  - `RequestType.UNKNOWN`
  - `EventType.ENVIRONMENTS_REVISIONS_COMMITTED`

### Webhook subscription test

- Implemented in `api/oss/src/core/webhooks/service.py`.
- Also builds an `Event` inline and publishes it with `publish_event(...)`.
- Uses:
  - generated `request_id`
  - generated `event_id`
  - `RequestType.UNKNOWN`
  - `EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED`

### Producer pattern observations

- There is no shared event-factory helper yet.
- There is no request-context propagation for `request_id` or `request_type`.
- Existing producers generate IDs ad hoc and use `RequestType.UNKNOWN`.
- Existing event payloads are small and stored in `attributes`.
- Existing producers publish through the shared `publish_event(...)` utility rather than through `EventsService`.

## Current Tracing Read Paths

The prompt refers to "whenever a span is fetched, it's read, or spans like a query with spans". In the current codebase, span reads happen through multiple routes and helper paths.

### Preview spans API

Primary current read endpoints:

- `GET /preview/spans/` -> `SpansRouter.fetch_spans`
- `GET /preview/spans/{trace_id}/{span_id}` -> `SpansRouter.fetch_span`
- `POST /preview/spans/query` -> `SpansRouter.query_spans`

These are implemented in `api/oss/src/apis/fastapi/tracing/router.py`.

### Preview traces API

Trace reads can also result in span fetch/query work:

- `GET /preview/traces/`
- `GET /preview/traces/{trace_id}`
- `POST /preview/traces/query`

These call `TracingService.fetch_traces`, `fetch_trace`, or `query_traces`, which internally operate on spans before formatting trace responses.

### Deprecated tracing API

There is also an older router still mounted at:

- `POST /tracing/spans/query`
- `GET /tracing/traces/{trace_id}`

This router lives in the same file and still performs tracing reads. If the goal is "emit whenever spans are fetched/read", the deprecated router is in scope unless the design explicitly excludes it.

### Service methods involved

The main service methods are in `api/oss/src/core/tracing/service.py`:

- `query(...)`
- `query_span_dtos(...)`
- `query_spans_or_traces(...)`
- `query_spans(...)`
- `query_traces(...)`
- `fetch(...)`
- `fetch_spans(...)`
- `fetch_span(...)`
- `fetch_traces(...)`
- `fetch_trace(...)`

Important detail:

- `query_spans(...)` and `query_traces(...)` both ultimately flow through `query_spans_or_traces(...)`.
- `fetch_span(...)` flows through `fetch_spans(...)`.
- `fetch_traces(...)` and `fetch_trace(...)` flow through `fetch(...)`.
- Some query paths short-circuit into `fetch(...)` when the query is effectively a direct trace-id lookup via `_extract_trace_ids_from_query(...)`.

## Current Router Context Available for Emission

If the event is emitted at the router boundary, the request already exposes the main auth/scope values needed for the event envelope and attributes.

In current tracing routers, request handlers already read from `request.state`:

- `organization_id`
- `project_id`
- `user_id`

That makes router-level emission practical, especially if the event should be computed from the final response payload just before returning.

## Current Tracing Service Wiring

- `TracingService` currently depends only on `TracingDAOInterface`.
- It does not depend on `EventsService` and does not publish events today.
- Service wiring happens in `api/entrypoints/routers.py`.
- `EventsService` and `TracingService` are instantiated independently there.

If emission stays at the router layer, no new `TracingService` dependency seam is strictly required for the first version. A core helper can be called from routers and can publish through `publish_event(...)`, following the same pattern already used by environment and webhook event producers.

## Response Shapes Relevant to Event Payload Design

### Span read responses

- `SpansRouter.fetch_spans` returns `SpansResponse(count, spans)`.
- `SpansRouter.fetch_span` returns `SpanResponse(count, span)`.
- `SpansRouter.query_spans` returns `SpansResponse(count, spans)`.

### Trace read responses

- `TracesRouter.fetch_traces` returns `TracesResponse(count, traces)`.
- `TracesRouter.fetch_trace` returns `TraceResponse(count, trace)`.
- `TracesRouter.query_traces` returns `TracesResponse(count, traces)`.

### Event payload sizing implication

- Span reads can legitimately return many spans.
- Putting every returned span ID into `attributes` is possible in the current schema, but payload size could grow quickly.
- There is no event-specific size guard in the current pipeline beyond stream batch size handling in `EventsWorker`.

## Existing Tests Relevant to This Work

Relevant current coverage includes:

- Event query acceptance tests:
  - `api/oss/tests/pytest/acceptance/events/test_events_basics.py`
- Event stream deserialization tests:
  - `api/oss/tests/pytest/unit/events/test_events_streaming.py`
- Tracing read acceptance tests:
  - `api/oss/tests/pytest/acceptance/tracing/test_spans_basics.py`
  - `api/oss/tests/pytest/acceptance/tracing/test_traces_basics.py`
  - `api/oss/tests/pytest/acceptance/tracing/test_traces_preview.py`
  - `api/oss/tests/pytest/e2e/loadables/test_loadable_strategies.py`

There does not appear to be any current test asserting that tracing reads emit events.

## Constraints Implied by the Current Codebase

### What already fits the prompt

- The platform already has:
  - events
  - event logs
  - webhook subscriptions
  - webhook deliveries
- The event log path can support a non-webhook event without structural changes.

### What the current code does not have yet

- No tracing read event type exists.
- No tracing read code path emits an event.
- No explicit internal-only event classification exists beyond "present in `EventType`, absent from `WebhookEventType`".
- No typed event payload schema exists beyond generic `attributes`.
- No stable, propagated request metadata exists for tracing read events.

## Research Conclusions

1. The codebase already supports internal-only events. The new event should be added to `EventType` only, not `WebhookEventType`.
2. The existing event model stores event-specific data in generic `attributes`, so the first implementation will likely follow that pattern unless the broader event system is refactored.
3. The largest design choice is not naming; it is where to emit so reads are captured exactly once across:
   - `GET /preview/spans/`
   - `GET /preview/spans/{trace_id}/{span_id}`
   - `POST /preview/spans/query`
   - trace read/query endpoints that internally fetch spans
   - deprecated `/tracing/*` endpoints
4. Emitting in low-level helpers like `fetch(...)` and `query(...)` risks duplicate or overly broad events unless the event explicitly models all read modes.
5. The intended semantics are now clearer: emit one event per endpoint response when spans or traces are actually returned through the API, not when spans are only read internally inside service logic.
6. Router-level emission is the correct fit for that requirement because routers have both the auth context and the final response shape.
