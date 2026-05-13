# Extend Events Beyond Deployments - Proposal

## Goal

Add internal events that record entity read and commit activity, store them in the existing events pipeline, and make the new event types webhook-subscribable.

## Scope

Emit one event per current, non-legacy, non-deprecated tracing read operation that returns traces.

Do not track these route families:

- `/preview/*`
- `/preview/tracing/*`
- `/preview/spans/*`
- `/preview/traces/*`
- `/tracing/*`

Current codebase note:

- The mounted span/trace read APIs found in `api/entrypoints/routers.py` are currently under preview or legacy tracing prefixes.
- Those routes are useful references for response shapes and service behavior, but they are not instrumentation targets for this event.
- If no stable non-preview tracing read endpoint exists at implementation time, add the event type and helper/tests as applicable, but do not wire emission into deprecated or legacy routes.

Do not emit for internal service-only reads.

This makes the event about API retrieval, not low-level helper activity, and avoids duplicate events from nested service calls.

## Event Contract

Add new `EventType` members in `api/oss/src/core/events/types.py`.

Tracing read events:

- `TRACES_FETCHED = "traces.fetched"`
- `TRACES_QUERIED = "traces.queried"`

Trace read events are the only tracing read events in scope for now. Span endpoints, if tracked later, should not introduce span event types unless product semantics require them.

Non-revision read events:

- `testcases.fetched`
- `testcases.queried`

Revision lifecycle events:

- `<domain>.revisions.retrieved`
- `<domain>.revisions.fetched`
- `<domain>.revisions.queried`
- `<domain>.revisions.logged`
- `<domain>.revisions.committed`

Initial revision domains:

- `applications`
- `queries`
- `testsets`
- `evaluators`
- `environments`

Workflows are intentionally omitted for now. Even though workflow revision APIs exist in this tree, tracking them may expose workflow concepts while that API surface is not expected to remain product-facing.

Add all new event values to `WebhookEventType` in `api/oss/src/core/webhooks/types.py`.

Today, `environments.revisions.committed` is already subscribable. The new read, log, and commit event types should follow the same subscribable-event path.

Use the existing generic `Event` DTO:

- `request_id`
- `event_id`
- `request_type`
- `event_type`
- `timestamp`
- `attributes`

No event model or persistence schema refactor is required.

## Attributes

Use event-family-specific bounded attributes. Do not force a generic `links` field into every event.

```json
{
  "user_id": "<uuid>",
  "count": 12
}
```

Rules:

- Always include `user_id`.
- Always include `count` for read, query, and log events.
- Commit events follow the existing `environments.revisions.committed` precedent and do not require `count`.
- Include event-specific returned reference lists only when useful.
- Cap event-specific result lists at 1000 entries.
- Keep `count` as the uncapped total.
- Do not emit an event when `count == 0`.
- Do not store full raw filtering expressions in the first version.
- A separate truncation flag is not needed when truncation is inferable from `count > len(references)`.

## Revision Entity Tracking

Track read and commit activity for major Git-style entities at the revision level, not artifact or variant reads.

In scope:

- revision retrieve RPCs: `POST /<domain>/revisions/retrieve`
- revision fetch routes: `GET /<domain>/revisions/{revision_id}`
- revision query routes: `POST /<domain>/revisions/query`
- revision log routes: `POST /<domain>/revisions/log`
- revision commit routes: `POST /<domain>/revisions/commit`

Out of scope:

- artifact fetch/query routes such as `GET /workflows/{workflow_id}` or `POST /workflows/query`
- variant fetch/query routes such as `GET /workflows/variants/{variant_id}` or `POST /workflows/variants/query`
- preview duplicate mounts
- simple compatibility routers unless they are the only stable product API for that entity

Stable mounted revision APIs found in this tree:

- `/applications/revisions/retrieve`, `/applications/revisions/{application_revision_id}`, `/applications/revisions/query`, `/applications/revisions/log`, `/applications/revisions/commit`
- `/queries/revisions/retrieve`, `/queries/revisions/{query_revision_id}`, `/queries/revisions/query`, `/queries/revisions/log`, `/queries/revisions/commit`
- `/testsets/revisions/retrieve`, `/testsets/revisions/{testset_revision_id}`, `/testsets/revisions/query`, `/testsets/revisions/log`, `/testsets/revisions/commit`
- `/evaluators/revisions/retrieve`, `/evaluators/revisions/{evaluator_revision_id}`, `/evaluators/revisions/query`, `/evaluators/revisions/log`, `/evaluators/revisions/commit`
- `/environments/revisions/retrieve`, `/environments/revisions/{environment_revision_id}`, `/environments/revisions/query`, `/environments/revisions/log`, `/environments/revisions/commit`

Stable workflow revision APIs exist at `/workflows/revisions/*`, but they are intentionally out of scope until workflows are confirmed as a durable exposed entity.

Environment note:

- `api/oss/src/apis/fastapi/environments/router.py::EnvironmentsRouter` has the same revision retrieve/fetch/query/commit shape as the other Git-style domains.
- The intended stable API surface is `/environments/revisions/*`, not `/preview/environments/revisions/*`.
- Emission is implemented at the route handler boundary, so the same handler instrumentation applies once the router is mounted at the non-preview path.
- In the current mount table, the domain-style router is still mounted only at `/preview/environments`; that should be treated as a mounting gap to fix, not as an exclusion of environments from tracking.
- The existing non-preview `/environments` mount points to `api/oss/src/routers/environment_router.py`, which is legacy and only exposes deployment behavior, not revision retrieve/fetch/query/commit.
- Do not add revision read tracking to any preview environments endpoint.
- Environments remain in scope as a major entity.
- The existing `environments.revisions.committed` producer in `core/environments/service.py` is the commit-event precedent.
- Environment revision read tracking should be wired to `/environments/revisions/*`, not to `/preview/environments/revisions/*`.

Create and Commit Note

- The direct `POST /<domain>/revisions/` handlers currently call `create_*_revision(...)`, which calls `create_revision(...)`, not `commit_revision(...)`.
- Some higher-level create/import/update compatibility paths do call `commit_*_revision(...)` internally.
- Emit `<domain>.revisions.committed` from any successful path that actually reaches domain commit logic.
- Do not infer commit from HTTP `POST` alone.
- Track the commit at the commit helper/service boundary once, not at both a compatibility route and the commit route.

Recommended event names:

- `applications.revisions.retrieved`
- `applications.revisions.fetched`
- `applications.revisions.queried`
- `applications.revisions.logged`
- `applications.revisions.committed`
- `queries.revisions.retrieved`
- `queries.revisions.fetched`
- `queries.revisions.queried`
- `queries.revisions.logged`
- `queries.revisions.committed`
- `testsets.revisions.retrieved`
- `testsets.revisions.fetched`
- `testsets.revisions.queried`
- `testsets.revisions.logged`
- `testsets.revisions.committed`
- `evaluators.revisions.retrieved`
- `evaluators.revisions.fetched`
- `evaluators.revisions.queried`
- `evaluators.revisions.logged`
- `evaluators.revisions.committed`
- `environments.revisions.retrieved`
- `environments.revisions.fetched`
- `environments.revisions.queried`
- `environments.revisions.logged`
- `environments.revisions.committed`
- `testcases.fetched`
- `testcases.queried`
- `traces.fetched`
- `traces.queried`

Revision event attributes:

```json
{
  "user_id": "<uuid>",
  "count": 1,
  "references": {
    "application": {"id": "..."},
    "application_variant": {"id": "..."},
    "application_revision": {"id": "...", "slug": "...", "version": 3}
  }
}
```

Rules:

- Use `*.revisions.retrieved` for `POST /<domain>/revisions/retrieve`.
- Use `*.revisions.fetched` for `GET /<domain>/revisions/{revision_id}`.
- Use `*.revisions.queried` for `POST /<domain>/revisions/query`.
- Use `*.revisions.logged` for `POST /<domain>/revisions/log`.
- Use `*.revisions.committed` for `POST /<domain>/revisions/commit`.
- Use `count` for returned result count.
- Query/log events may include a domain-specific `references` list capped at 1000.
- For single revision fetch/retrieve, include `count = 1` and domain-specific `references`.
- For new application, query, testset, and evaluator commit events, include domain-specific `references`.
- Keep domain-specific `references` names compatible with existing environment commit events.
- Treat `references` as partial identity objects. Include artifact, variant, and revision fields when the returned DTO exposes them, but do not fail emission if artifact or variant details are incomplete.
- New commit events may include the commit `message` when present.
- Preserve the existing `environments.revisions.committed` `references`, `state`, and `diff` attributes.
- Add optional `message` to `environments.revisions.committed` for commit-event uniformity.
- Do not add `state` or `diff` to the new application, query, testset, or evaluator commit events in the first version.
- Skip revision read events when no revision is returned.

## Emission Design

Add a shared core-layer helper near `api/oss/src/core/tracing/` that:

- accepts request scope:
  - `organization_id`
  - `project_id`
  - `user_id`
- inspects the final response object
- computes the returned count
- extracts bounded event-specific reference lists when useful
- builds an `Event`
- publishes with `publish_event(...)`
- logs publish failures without failing the read request

For revision entities, add a shared event helper in the events core layer, not separately in every entity service. The helper should:

- accept a domain descriptor such as `workflow`, `query`, or `testset`
- accept action type: `retrieve`, `fetch`, `query`, `log`, or `commit`
- accept one revision DTO or a list response
- derive references and capped event-specific reference lists
- build the correct `EventType`
- publish through `publish_event(...)`
- fail open with logging

Use:

- generated `request_id`
- generated `event_id`
- `RequestType.UNKNOWN`
- `EventType.TRACES_FETCHED` or `EventType.TRACES_QUERIED`

Include `organization_id` and `project_id` in the publish envelope. Include `user_id`, `count`, and event-specific attributes in `attributes`.

Only include workspace scope if these tracing routes expose a stable workspace identifier in request context.

## Router Instrumentation

Emit at router boundaries after the full response object is materialized and just before returning it.

Recommended flow per handler:

1. Execute existing read logic.
2. Materialize the final response object.
3. Run the helper against that response object.
4. Skip publishing when `count == 0`.
5. Return the response object normally even if publishing fails.

Instrumentation targets:

- current stable trace read endpoints that return span-derived trace data, once identified
- current stable trace query endpoints that return span-derived trace data, once identified

Explicitly excluded targets:

- `TracingRouter`
- `TracesRouter` while mounted only under `/preview/traces`
- any router mounted under `/preview/*`
- any router mounted under `/tracing/*`

For revision entities, instrument stable router boundaries for retrieve/fetch/query. Keep commit emission in the service layer or in a shared helper called by services, because commit events represent a state transition and already have a service-layer precedent in `EnvironmentsService.commit_environment_revision`.

## Tracing Event Shape

For tracing, support trace-level read events.

Use:

- `traces.fetched` for stable trace fetch endpoints only, with `trace_id` when a single trace is returned
- `traces.queried` for stable trace query endpoints only, with capped `trace_ids` when multiple traces are returned

Emission rule:

- trace events are emitted only by stable trace API endpoints
- if a trace endpoint returns traces, emit the matching trace event
- trace events may include `trace_id` or capped `trace_ids`
- if a trace endpoint internally fetches spans to materialize traces, emit only the trace event
- query revision endpoints emit query revision events, not trace events
- loadable or query workflows do not emit trace events unless they call a trace endpoint that returns that entity

This keeps trace endpoint access separate from query entity access and avoids double counting internal service calls.

The helper should support at least:

- `TraceResponse`
- `TracesResponse`

## Testcase Tracking

Testcases are blob-like records, not Git-style revisions. Track read access but do not add commit events.

In scope:

- `GET /testcases/` -> `testcases.fetched`
- `GET /testcases/{testcase_id}` -> `testcases.fetched`
- `POST /testcases/query` -> `testcases.queried`

Attributes:

- `testcase_id` for single testcase responses
- `testcase_ids` for list responses, capped at 1000

Out of scope:

- `/preview/testcases/*`
- testcase save/create internals
- testset revision reads that merely include testcase IDs unless the testcase endpoint itself returns testcase records

## Non-Goals

Do not combine this work with:

- a full event payload typing refactor
- request-context propagation changes
- webhook subscription behavior changes
- event table schema changes
- frontend automation type updates

## Risks

Duplicate events:

- Emit only once per handler.
- Keep helper calls at the endpoint boundary.
- Add tests for exact event counts.

Oversized payloads:

- Store only `count`, revision references, testcase IDs, trace IDs, and other capped event-specific result lists where useful.

Publish failures:

- Fail open.
- Log errors.
- Keep tracing read responses unaffected.
