# Extend Events Beyond Deployments - Gaps

## Status

All gaps in this document are now closed by the implementation in [proposal.md](./proposal.md), [events.md](./events.md), and [tasks.md](./tasks.md). The summary and gap list below are kept for historical context; they describe the pre-implementation state, not the current code.

Key deviations from the originally listed gaps:

- Preview / `/preview/*` route exclusion was dropped. Emission happens from every mount of an instrumented handler; the duplicate mounts share a single handler instance so each request emits exactly once.
- Commit emission was moved into the service layer (`commit_*_revision(...)`) for every domain, matching the existing `EnvironmentsService.commit_environment_revision` precedent. Router handlers do not emit commit events.
- The environments mount gap (point 11) was a non-issue at implementation time: `EnvironmentsRouter` is already mounted at non-preview `/environments`.

## Summary

The current docs were directionally correct, but they missed several important implementation realities:

- the event system does not have typed per-event payload models today
- tracing reads currently visible in this tree are mounted through preview or legacy route prefixes
- revision read and commit tracking exists only partially, with environments commit as the main precedent
- a non-webhook event is already supported structurally
- the main missing seam is dependency wiring and exact emission placement

This document lists the actual gaps between the prompt and the current codebase.

## 1. Missing Event Type

There is no tracing read event in `api/oss/src/core/events/types.py`.

What is missing:

- new `EventType` members such as:
  - `traces.fetched`
  - `traces.queried`
  - `testcases.fetched`
  - `testcases.queried`

Constraint:

- it should not be added to `WebhookEventType` in `api/oss/src/core/webhooks/types.py`

Reason:

- the event system needs explicit type coverage before producers can publish these events

## 2. Missing Emission in Tracing Read Paths

No stable, non-deprecated tracing read path currently publishes an event.

Observed read paths include:

- `SpansRouter.fetch_spans`
- `SpansRouter.fetch_span`
- `SpansRouter.query_spans`
- `TracesRouter.fetch_traces`
- `TracesRouter.fetch_trace`
- `TracesRouter.query_traces`
- deprecated `TracingRouter` read endpoints

Code-level reality:

- these routes eventually pass through `TracingService`, but they are mounted under `/preview/*` or `/tracing/*` in `api/entrypoints/routers.py`
- `/preview/*`, `/preview/tracing/*`, `/preview/spans/*`, `/preview/traces/*`, and `/tracing/*` are excluded from tracking because they are deprecated, legacy, or both

Design gap:

- the implementation needs the current stable tracing read API surface identified before router emission is wired
- if no stable tracing read endpoint exists, the implementation should not instrument deprecated or legacy routes just to produce the event

## 3. Missing Core Helper for Router-Level Emission

Given the current direction, the event should be emitted in stable routers after the final span or trace response is fully materialized.

What is missing:

- a shared core-layer helper to derive event payload data from router responses
- a helper that wraps both:
  - the span counting / ID sampling logic
  - the actual call to `publish_event(...)`
- consistent router instrumentation across all in-scope stable read endpoints

Why this matters:

- there may be multiple stable endpoints once the current API surface is identified
- counting spans correctly from `span`, `spans`, `trace`, or `traces` responses should not be duplicated inline in every handler
- router code already has access to `request.state.organization_id`, `request.state.project_id`, and `request.state.user_id`
- existing event producers already use the shared `publish_event(...)` utility directly, so the new helper should follow that pattern

## 4. Missing Stable Payload Contract

The prompt calls for a payload containing at least:

- `project_id`
- `user_id`
- count of returned traces or testcases
- returned trace IDs

Current state:

- persisted `Event` has generic `attributes`
- producers manually pack event-specific fields into `attributes`
- there is no canonical schema for tracing read attributes yet

What is missing:

- an agreed attributes contract for the new event

At minimum the contract should decide whether to include:

- `user_id`
- `count`
- event-specific result lists, with:
  - `trace_id` or `trace_ids` for trace results
  - `testcase_id` or `testcase_ids` for testcase results

Decisions now made:

- event-specific result lists are capped at `1000`
- `count` remains the full uncapped total
- no separate truncation flag is needed when truncation is inferable from `count > len(<event-specific list>)`
- no event is emitted when `count == 0`

## 5. Missing Decision on Event Cardinality and Duplication

This is the most important unresolved design gap.

Examples:

- `fetch_span(...)` currently calls `fetch_spans(...)`
- `query_traces(...)` internally queries spans and then materializes traces
- some query requests become direct `fetch(...)` calls when the filter is only `trace_id`

Without a clear rule, the implementation could accidentally emit:

- one event for the low-level fetch and another for the higher-level read
- span events for trace reads, even though span events are out of scope for now
- accidental events from preview or legacy routers

The intended approach is now:

1. Emit one event per user-facing endpoint call.
2. Include only current stable, non-preview, non-legacy endpoints that return traces through the API.
3. Do not emit for internal service-only reads.
4. Do not emit for deprecated or legacy endpoints.

The remaining gap is identifying the stable mounted endpoint set. The currently observed `/preview/*` and `/tracing/*` routes are explicitly out of scope.

## 6. Missing Guidance on Sensitive and Large Payload Data

The original docs noted payload size concerns but understated the security and operational tradeoff.

Real risks:

- returned trace IDs can be numerous
- storing full query/filter payloads may capture sensitive identifiers or search inputs
- large `attributes` blobs increase Redis stream payload size and event-table storage

What is missing:

- a size budget or truncation policy
- a rule for whether raw query filters should be recorded at all

Chosen direction:

- record `count`, references, and capped event-specific result lists only where useful
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
- include `user_id`, `count`, and event-specific fields in attributes

## 9. Missing Test Plan Specificity

The original docs said "add tests", but not enough detail.

Missing coverage areas:

- unit tests for event construction and truncation logic
- unit tests for subscribability:
  - event in `EventType`
  - event in `WebhookEventType`
- acceptance tests that a tracing read results in an event log entry
- tests covering stable trace fetch/query endpoints
- tests covering stable testcase fetch/query endpoints
- tests preventing double emission on nested helper flows
- tests proving zero-count responses do not emit events
- tests proving publish failures do not fail the API response
- tests proving preview and legacy tracing routes do not emit this event

## 10. Missing Documentation Scope Decision

The original docs suggested frontend typing and broad doc updates, but the codebase does not require that by default.

What is actually missing:

- backend design clarity first
- only then API/docs updates if the event is intended to be user-visible in event querying docs

Not automatically required:

- frontend automation type updates, because these event types are API-level event/webhook contracts first

## 11. Missing Cross-Entity Revision Tracking

The broader audit requirement is not only tracing reads. Major Git-style entities should also record revision read and commit activity.

Current state:

- `environments.revisions.committed` already exists and is emitted from `EnvironmentsService.commit_environment_revision`.
- No equivalent commit events were found for workflows, applications, queries, testsets, or evaluators.
- No revision read events were found for workflows, applications, queries, testsets, evaluators, or environments.

In-scope revision operations:

- `POST /<domain>/revisions/retrieve`
- `GET /<domain>/revisions/{revision_id}`
- `POST /<domain>/revisions/query`
- `POST /<domain>/revisions/log`
- `POST /<domain>/revisions/commit`

In-scope stable domains:

- applications
- queries
- testsets
- evaluators
- environments, using non-preview domain-style endpoints only

Intentionally deferred:

- workflows, because tracking workflow events may expose a product concept that might not remain publicly available

Additional non-revision read domains:

- traces, with `traces.fetched` and `traces.queried`, emitted only from trace endpoints
- testcases, with `testcases.fetched` and `testcases.queried`, emitted only from testcase endpoints

Out of scope:

- span events for now
- artifact fetch/query routes
- variant fetch/query routes
- preview duplicate mounts
- all `/preview/*` endpoints
- legacy compatibility routers

Main design gap:

- event construction should be shared instead of copying the inline environment commit producer into every service
- retrieved, fetched, queried, and logged events should be emitted once at stable router boundaries after the response is known
- commit events can stay service-level because they represent state transitions and already have a service-layer precedent
- create routes should not be counted as commit events unless their code path actually calls commit logic
- the domain-style environments revision router should be available at non-preview `/environments/revisions/*`; the current preview-only mount is a mounting gap, not a product exclusion
- all new event types are intended to be webhook-subscribable

## Recommended Gap Closure Priorities

1. Identify the exact stable endpoint list that emits the event.
2. Implement the bounded payload contract.
3. Define the core helper that counts spans from final response objects and publishes through `publish_event(...)`.
4. Add the new event values to both `EventType` and `WebhookEventType`.
5. Add shared revision event helper coverage for retrieve, fetch, query, log, and commit actions with distinct event types.
6. Add tests that guard against duplicate emission, zero-count suppression, publish-failure behavior, oversized payloads, and accidental emission from preview or legacy routes.
