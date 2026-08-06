# Extend Events Beyond Deployments - Research

## Scope Restatement

The requested work extends the existing event system beyond deployment events. New read, log, and commit events should be recorded in the existing events pipeline and made subscribable by webhooks.

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

### Important implication for the new events

- A new event can exist in `EventType` without being added to `WebhookEventType`, but this proposal intentionally makes the new events subscribable.
- New event values should therefore be added to both `EventType` and `WebhookEventType`.

## Current Event Producers

Only two real producers currently emit events:

### Environment revision commit

- Implemented in `api/oss/src/core/environments/service.py`.
- Builds an `Event` inline and publishes it with `publish_event(...)`.
- Stores `user_id` inside `attributes`.
- Stores environment revision `references`, normalized committed `state`, and a references `diff` inside `attributes`.
- The diff shape is `{created, updated, deleted}` with `old`/`new` values as applicable.
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

## Current Revision Entity APIs

The current domain-style Git pattern exposes revision retrieve/query/commit operations for several major entities.

Stable mounted revision APIs:

- Applications are mounted at `/applications` and expose:
  - `POST /applications/revisions/retrieve`
  - `GET /applications/revisions/{application_revision_id}`
  - `POST /applications/revisions/query`
  - `POST /applications/revisions/log`
  - `POST /applications/revisions/commit`
- Workflows are mounted at `/workflows` and expose:
  - `POST /workflows/revisions/retrieve`
  - `GET /workflows/revisions/{workflow_revision_id}`
  - `POST /workflows/revisions/query`
  - `POST /workflows/revisions/log`
  - `POST /workflows/revisions/commit`
- Queries are mounted at `/queries` and expose:
  - `POST /queries/revisions/retrieve`
  - `GET /queries/revisions/{query_revision_id}`
  - `POST /queries/revisions/query`
  - `POST /queries/revisions/log`
  - `POST /queries/revisions/commit`
- Testsets are mounted at `/testsets` and expose:
  - `POST /testsets/revisions/retrieve`
  - `GET /testsets/revisions/{testset_revision_id}`
  - `POST /testsets/revisions/query`
  - `POST /testsets/revisions/log`
  - `POST /testsets/revisions/commit`
- Evaluators are mounted at `/evaluators` and expose:
  - `POST /evaluators/revisions/retrieve`
  - `GET /evaluators/revisions/{evaluator_revision_id}`
  - `POST /evaluators/revisions/query`
  - `POST /evaluators/revisions/log`
  - `POST /evaluators/revisions/commit`
- Environments are in scope with the same intended stable shape:
  - `POST /environments/revisions/retrieve`
  - `GET /environments/revisions/{environment_revision_id}`
  - `POST /environments/revisions/query`
  - `POST /environments/revisions/log`
  - `POST /environments/revisions/commit`

Environment caveat:

- The domain-style `EnvironmentsRouter` (with revision retrieve/fetch/query/log/commit) is mounted at both `/environments` and `/preview/environments` from a single shared instance, so each request emits exactly once.
- `environments.revisions.committed` is already emitted from `core/environments/service.py`, matching the read-router / write-service split used by every other domain.
- Environments remain in scope as a major entity.

Create route caveat:

- The direct revision create handlers call `create_*_revision(...)`, which calls DAO `create_revision(...)` or delegates to another domain's `create_*_revision(...)`.
- They do not call `commit_revision(...)` in the direct workflow/application/query/testset/evaluator/environment revision create paths reviewed here.
- Some higher-level create/import/update compatibility paths do call `commit_*_revision(...)` internally.
- Commit events should be emitted from successful commit service/helper paths, regardless of which route initiated them.

Notable exclusions for broad tracking:

- Workflow revision APIs exist, but workflow events are intentionally skipped for now because workflows may stop being a durable exposed product entity.
- Artifact reads such as `query_workflows`, `query_applications`, and `query_testsets` should not be tracked by revision read events.
- Variant reads such as `query_workflow_variants` and `fetch_workflow_variant` should not be tracked by revision read events.
- Preview duplicate mounts should not double-emit for routers also mounted at stable paths.

## Current Testcase APIs

Testcases are mounted at `/testcases` and also duplicated at `/preview/testcases`. Stable testcase read endpoints are in scope for testcase read events; preview testcase endpoints are out of scope.

## Current Tracing Read Paths

The prompt originally considered both span-level and trace-level read event names. Current scope keeps only trace read event names.

Query revision endpoints are query entity reads and should emit query revision events, even when query data is later used to fetch traces or spans. Loadable workflows should not emit trace events unless they call stable trace endpoints that return traces.

### Observed preview spans API

Observed preview read endpoints:

- `GET /preview/spans/` -> `SpansRouter.fetch_spans`
- `GET /preview/spans/{trace_id}/{span_id}` -> `SpansRouter.fetch_span`
- `POST /preview/spans/query` -> `SpansRouter.query_spans`

These are implemented in `api/oss/src/apis/fastapi/tracing/router.py`.

These routes are not tracking targets for this event because `/preview/*` is deprecated or legacy surface.

### Observed preview traces API

Trace reads can also result in span fetch/query work:

- `GET /preview/traces/`
- `GET /preview/traces/{trace_id}`
- `POST /preview/traces/query`

These call `TracingService.fetch_traces`, `fetch_trace`, or `query_traces`, which internally operate on spans before formatting trace responses.

These routes are not tracking targets for this event because `/preview/*` is deprecated or legacy surface.

### Observed legacy tracing API

There is also an older router still mounted at:

- `POST /tracing/spans/query`
- `GET /tracing/traces/{trace_id}`

This router lives in the same file and still performs tracing reads. It is not a tracking target for this event because `/tracing/*` is legacy surface.

### Stable tracing read API

No stable non-preview span or trace read router was found in the current tree during this review.

Implementation implication:

- Do not instrument `/preview/*`.
- Do not instrument `/tracing/*`.
- Do not instrument deprecated or legacy routers just to emit this event.
- Wire emission only when the current stable tracing read API surface is identified.

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

If the event is emitted at the router boundary, the ambient `AuthScope` and the request state already expose the main auth/scope values needed for the event envelope and attributes.

In current tracing routers, request handlers already read from `request.state` as a fallback when an ambient `AuthScope` is not available:

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

Because the currently observed tracing read routes are preview or legacy routes, new event-emission acceptance tests should target stable endpoints only. Add negative coverage for preview and legacy routes if those routes continue to exist during implementation.

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
- Subscribability is controlled by presence in `WebhookEventType`.
- No typed event payload schema exists beyond generic `attributes`.
- No stable, propagated request metadata exists for tracing read events.

## Research Conclusions

1. The codebase already supports internal-only events. The new event should be added to `EventType` only, not `WebhookEventType`.
2. The existing event model stores event-specific data in generic `attributes`, so the first implementation will likely follow that pattern unless the broader event system is refactored.
3. The largest design choice is not naming; it is identifying the stable, non-preview, non-legacy tracing read API surface where reads should be captured exactly once.
4. The currently observed `/preview/*` and `/tracing/*` trace read routes are useful implementation references but should not emit this event.
5. Emitting in low-level helpers like `fetch(...)` and `query(...)` risks duplicate or overly broad events, including accidental emission from deprecated or legacy routes.
6. The intended semantics are now clearer: emit one event per stable endpoint response when traces are actually returned through the API, not when spans are only read internally inside service logic.
7. Router-level emission is the correct fit for that requirement because routers have both the auth context and the final response shape.
