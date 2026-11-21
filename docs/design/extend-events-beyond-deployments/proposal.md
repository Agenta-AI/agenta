# Extend Events Beyond Deployments - Proposal

## Goal

Add internal events that record entity read and commit activity, store them in the existing events pipeline, and make the new event types webhook-subscribable.

## Scope

Emit one event per API-level read operation (fetch / retrieve / query / log) that returns the target entity.

Route-prefix policy:

- Emission is **not** gated by the route prefix. The same handler emits the same event regardless of whether it is mounted at the stable path, the `/preview/*` duplicate, or a deprecated/legacy compatibility path. Suppressing preview emission would under-count real reads. The duplicate mounts share a single handler instance, so each call emits exactly once.
- `TracingRouter` and `SpansRouter` are still **not** instrumented, because span-level events are out of scope and the trace endpoints exposed on those routers are deprecated. Trace events come only from `TracesRouter` (mounted at `/traces` and `/preview/traces`).

Do not emit for internal service-only reads (read events).

Commit events follow a different rule: emit from the **service layer** at the `commit_*_revision(...)` boundary, so every code path that successfully commits — direct `POST /<domain>/revisions/commit`, simple-service create/edit, deploy paths, defaults seeding — produces exactly one commit event.

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
- `EnvironmentsRouter` is mounted at both `/environments` and `/preview/environments` from a single instance (`api/entrypoints/routers.py`). Both prefixes share the same handler object, so each request emits exactly once regardless of which prefix is hit.
- Emission is implemented at the route handler boundary; both mounts therefore inherit the same instrumentation automatically.
- Environments remain in scope as a major entity.
- The existing `environments.revisions.committed` producer in `core/environments/service.py` is the commit-event precedent.

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

Shared utilities live in `api/oss/src/core/events/utils.py`. All helpers use keyword-only arguments:

- `publish_trace_fetched(*, request, count, trace_id=None, trace_ids=None)`
- `publish_trace_queried(*, request, count, trace_ids=None)`
- `publish_testcase_fetched(*, request, count, testcase_id=None, testcase_ids=None)`
- `publish_testcase_queried(*, request, count, testcase_ids=None)`
- `publish_revision_event(*, request=None, organization_id=None, project_id=None, user_id=None, domain, action, revision=None, revisions=None, count=None, message=None, extra=None)`

Behavior:

- Each helper resolves scope (`organization_id`, `project_id`, `user_id`) from ambient `AuthScope` first, then falls back to `request.state`, and short-circuits without raising if the scope is unusable. Callers do not need to None-check fields.
- Each helper builds an `Event` with generated `request_id`, generated `event_id`, `RequestType.UNKNOWN`, and the matching `EventType`.
- `publish_event(...)` is called with `organization_id` and `project_id` in the envelope. `attributes` always carries `user_id`. Read/query/log events carry `count`. Commit events do not carry `count` (matching the existing `environments.revisions.committed` precedent).
- Publish failures are caught, logged, and swallowed so the API response is unaffected.
- `publish_revision_event` accepts either a `request` (router-layer) **or** explicit `project_id`/`user_id`/`organization_id` (service-layer, e.g., environments commit). This lets the commit emission live at the service boundary even when no request context is available.

For revision entities, the helper accepts:

- domain: `application`, `query`, `testset`, `evaluator`, or `environment`
- action: `retrieve`, `fetch`, `query`, `log`, or `commit`
- one revision DTO (single-shape actions) **or** a list of revisions (`query`/`log`)
- optional `message`
- optional `extra` (used by `environments.revisions.committed` for `state` and `diff`)

## Router and Service Instrumentation

### Read events (retrieve, fetch, query, log)

Emit at router boundaries after the full response object is materialized and just before returning it.

Recommended flow per handler:

1. Execute existing read logic.
2. Materialize the final response object.
3. Call the matching helper with `request` and the response.
4. The helper skips publishing when `count == 0`.
5. Return the response object normally even if publishing fails.

Instrumentation targets:

- `TracesRouter.fetch_trace`, `TracesRouter.fetch_traces`, `TracesRouter.query_traces`
- `TestcasesRouter.fetch_testcase`, `TestcasesRouter.fetch_testcases`, `TestcasesRouter.query_testcases`
- For each revision domain (`applications`, `queries`, `testsets`, `evaluators`, `environments`):
  - `retrieve_*_revision` handler → `*.revisions.retrieved`
  - `fetch_*_revision` handler → `*.revisions.fetched`
  - `query_*_revisions` handler → `*.revisions.queried`
  - `log_*_revisions` handler → `*.revisions.logged`

Explicitly excluded:

- `TracingRouter` (legacy deprecated trace endpoints)
- `SpansRouter` (span events out of scope)
- Workflows revisions (intentionally deferred)

### Write events (commits, and any future write actions)

Write emission lives in the **service layer**, at the operation's seam — currently `commit_*_revision(...)` — so that any code path that reaches the write logic emits exactly once. This matches the existing `EnvironmentsService.commit_environment_revision` precedent.

Service-layer commit emission points:

- `EnvironmentsService.commit_environment_revision` (already in place, normalized to the shared helper, now includes optional `message`)
- `ApplicationsService.commit_application_revision`
- `QueriesService.commit_query_revision`
- `TestsetsService.commit_testset_revision`
- `EvaluatorsService.commit_evaluator_revision`

Compatibility / nested paths that funnel through these methods (deploy paths, simple-service create/edit, defaults seeding, fork) automatically emit once via the service layer. Router handlers do **not** also emit commit events — that would double-publish.

### Why this split (read=router, write=service)

The asymmetry is intentional and is documented in detail in the `core/events/utils.py` module docstring. Summary:

- **Reads** are called both from routers (user-initiated, count-worthy) and internally from other services to resolve refs and hydrate state (not count-worthy). Emitting at the router is the only way to suppress the internal lookups. Examples that would mis-fire if reads emitted at the service:
  - `commit_environment_revision` calls `query_environment_revisions` to compute the diff → every commit would also fire `environments.revisions.queried`.
  - `TracingService.query_traces` calls `queries_service.fetch_query_revision` to resolve the saved query → every trace query would falsely fire `queries.revisions.fetched`.
  - Evaluation runs call multiple revision fetches per scenario → one evaluation would produce hundreds of stray `*.revisions.fetched` events.
- **Writes** are *always* user-initiated state transitions. There is no "internal write happening as a side effect of a read" pattern in this codebase. Emitting at the service is the only way to cover compatibility paths (deploy, simple-service create/edit, defaults seeding, fork) that bypass `/<domain>/revisions/commit`.

Future write actions (e.g. `archive_*_revision`) should follow the same service-layer rule.

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
