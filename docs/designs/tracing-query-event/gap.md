# Tracing Query Event - Gaps

## Summary

The current docs were directionally correct, but they missed several important implementation realities:

- the event system does not have typed per-event payload models today
- tracing reads happen through multiple routers and helper paths
- a non-webhook event is already supported structurally
- the main missing seam is dependency wiring and exact emission placement

This document lists the actual gaps between the prompt and the current codebase.

## 1. Missing Event Type

There is no tracing read event in `api/oss/src/core/events/types.py`.

What is missing:

- a new `EventType` member such as:
  - `spans.retrieved`

Constraint:

- it should not be added to `WebhookEventType` in `api/oss/src/core/webhooks/types.py`

Reason:

- the prompt explicitly asks for an event that is recorded but not subscribable by webhooks

## 2. Missing Emission in Tracing Read Paths

No tracing read path currently publishes an event.

Affected paths include:

- `SpansRouter.fetch_spans`
- `SpansRouter.fetch_span`
- `SpansRouter.query_spans`
- `TracesRouter.fetch_traces`
- `TracesRouter.fetch_trace`
- `TracesRouter.query_traces`
- deprecated `TracingRouter` read endpoints

Code-level reality:

- all of these routes eventually pass through `TracingService`, but not through one single method that cleanly represents every user-facing read operation

Design gap:

- the implementation needs explicit endpoint coverage so each user-visible API response produces exactly one event without duplicates

## 3. Missing Core Helper for Router-Level Emission

Given the current direction, the event should be emitted in routers after the final span or trace response is fully materialized.

What is missing:

- a shared core-layer helper to derive event payload data from router responses
- a helper that wraps both:
  - the span counting / ID sampling logic
  - the actual call to `publish_event(...)`
- consistent router instrumentation across all in-scope read endpoints

Why this matters:

- there are many endpoints
- counting spans correctly from `span`, `spans`, `trace`, or `traces` responses should not be duplicated inline in every handler
- router code already has access to `request.state.organization_id`, `request.state.project_id`, and `request.state.user_id`
- existing event producers already use the shared `publish_event(...)` utility directly, so the new helper should follow that pattern

## 4. Missing Stable Payload Contract

The prompt calls for a payload containing at least:

- `project_id`
- `user_id`
- count of returned spans
- possibly returned span IDs

Current state:

- persisted `Event` has generic `attributes`
- producers manually pack event-specific fields into `attributes`
- there is no canonical schema for tracing read attributes yet

What is missing:

- an agreed attributes contract for the new event

At minimum the contract should decide whether to include:

- `user_id`
- `count`
- `links`, with:
  - `{trace_id, span_id}` for span results
  - `{trace_id}` for trace results

Decisions now made:

- `links` are capped at `1000`
- `count` remains the full uncapped total
- no separate truncation flag is needed because truncation is inferable when `count > len(links)`
- no event is emitted when `count == 0`

## 5. Missing Decision on Event Cardinality and Duplication

This is the most important unresolved design gap.

Examples:

- `fetch_span(...)` currently calls `fetch_spans(...)`
- `query_traces(...)` internally queries spans and then materializes traces
- some query requests become direct `fetch(...)` calls when the filter is only `trace_id`

Without a clear rule, the implementation could accidentally emit:

- one event for the low-level fetch and another for the higher-level read
- span events for trace reads, even if the product intent is "span reads only"
- duplicate events across preview and deprecated routers

The intended approach is now:

1. Emit one event per user-facing endpoint call.
2. Include endpoints that return spans or traces through the API.
3. Do not emit for internal service-only reads.

The remaining gap is implementation completeness across the full mounted endpoint set, including deprecated read/query/fetch routes.

## 6. Missing Guidance on Sensitive and Large Payload Data

The original docs noted payload size concerns but understated the security and operational tradeoff.

Real risks:

- returned span IDs can be numerous
- storing full query/filter payloads may capture sensitive identifiers or search inputs
- large `attributes` blobs increase Redis stream payload size and event-table storage

What is missing:

- a size budget or truncation policy
- a rule for whether raw query filters should be recorded at all

Chosen direction:

- record `count` and capped `links` only
- avoid recording full raw filter expressions unless there is a clear audit requirement

## 7. Missing Request Metadata Strategy

Current event producers generate fresh `request_id` values and use `RequestType.UNKNOWN`.

Decision now made:

- keep using generated `request_id` and `RequestType.UNKNOWN`, matching current environment/webhook producers

## 8. Missing Scope Mapping Decision

`publish_event(...)` supports `organization_id`, but current producers do not consistently pass it.

For a tracing read event, the docs need to decide exactly which request-scope values are used:

- `organization_id` in the stream envelope when available
- `project_id` in the stream envelope
- `user_id` in attributes
- any workspace identifier only if it truly exists in request context for these routes

Why:

- `EventsWorker` groups and entitlement-checks with organization scope when present
- omitting it loses context and may be inconsistent with future EE expectations

Decision now made:

- include `organization_id` and `project_id` in the publish envelope
- include `user_id`, `count`, and `links` in attributes

## 9. Missing Test Plan Specificity

The original docs said "add tests", but not enough detail.

Missing coverage areas:

- unit tests for event construction and truncation logic
- unit tests for non-subscribability:
  - event in `EventType`
  - absent from `WebhookEventType`
- acceptance tests that a tracing read results in an event log entry
- tests covering both:
  - span fetch endpoints
  - span query endpoints
- tests for trace read behavior, because those are intended to emit too
- tests preventing double emission on nested helper flows
- tests proving zero-count responses do not emit events
- tests proving publish failures do not fail the API response

## 10. Missing Documentation Scope Decision

The original docs suggested frontend typing and broad doc updates, but the codebase does not require that by default.

What is actually missing:

- backend design clarity first
- only then API/docs updates if the event is intended to be user-visible in event querying docs

Not automatically required:

- frontend automation type updates, because the event is intentionally not subscribable

## Recommended Gap Closure Priorities

1. Choose exact semantics:
   - the exact endpoint list that emits the event
2. Implement the bounded payload contract.
3. Define the core helper that counts spans from final response objects and publishes through `publish_event(...)`.
4. Add the new `spans.retrieved` `EventType` only, not `WebhookEventType`.
5. Add tests that guard against duplicate emission, zero-count suppression, publish-failure behavior, and oversized payloads.
