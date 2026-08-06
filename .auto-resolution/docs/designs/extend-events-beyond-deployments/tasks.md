# Extend Events Beyond Deployments - Tasks

## Event types

- [x] Add trace read event types: `traces.fetched` and `traces.queried`.
- [x] Add testcase read event types: `testcases.fetched` and `testcases.queried`.
- [x] Add split revision read event types for stable major entities: `<domain>.revisions.retrieved`, `<domain>.revisions.fetched`, `<domain>.revisions.queried`, and `<domain>.revisions.logged`.
- [x] Add missing revision commit event types for stable major entities, using `environments.revisions.committed` as the existing precedent.
- [x] Do not add workflow revision event types until workflows are confirmed as a durable exposed entity.
- [x] Do not add span read event types for now.
- [x] Add all new trace, testcase, revision read, revision log, and revision commit event types to `WebhookEventType`.

## Helpers

- [x] Add core tracing/testcase event helpers (`publish_trace_fetched`, `publish_trace_queried`, `publish_testcase_fetched`, `publish_testcase_queried`) in `api/oss/src/core/events/utils.py`.
- [x] Add a shared revision event helper in the events/core layer (`publish_revision_event`) so each domain does not copy inline event construction.
- [x] Helper accepts domain, action, request scope (either `request` or explicit `project_id`/`user_id`), and one revision DTO or a revision list response.
- [x] Helper builds domain-specific `references` for single revision events and capped domain-specific `references` arrays for list revision events.
- [x] Treat revision `references` as partial identity objects; include artifact, variant, and revision fields only when the response exposes them.
- [x] Normalize the existing environment commit producer to the shared revision event helper.
- [x] Preserve the existing `environments.revisions.committed` `references`, `state`, and `diff` attributes (via the `extra=` kwarg).
- [x] Add optional `message` to `environments.revisions.committed` for commit-event uniformity.
- [x] For new application, query, testset, and evaluator commit events, include domain-specific `references` and optional `message`.
- [x] Do not add `state` or `diff` to the new application, query, testset, or evaluator commit events in the first version.
- [x] Trace `fetched` events carry `trace_id` (singular GET-by-path) or capped `trace_ids` (list GET / query). `traces.queried` always carries `trace_ids`.
- [x] Testcase `fetched` events carry `testcase_id` (singular GET-by-path) or capped `testcase_ids` (list GET). `testcases.queried` always carries `testcase_ids`.
- [x] Cap event-specific result lists at 1000 while preserving the uncapped `count`.
- [x] Suppress publishing when `count == 0` (and for single-shape revision actions when the revision is None).
- [x] Build events with generated `request_id`, generated `event_id`, `RequestType.UNKNOWN`, and the appropriate event type.
- [x] Publish through `publish_event(...)` with `organization_id` and `project_id` in the envelope.
- [x] Store `user_id`, `count`, and event-specific fields in event `attributes`.
- [x] Log publish failures and still return the API response normally.

## Route policy (deviation from original design)

- [x] **The original design excluded preview/tracing/deprecated routes from emission. Implementation supersedes this: emit from every mount of an instrumented handler. The duplicate `/preview/*` mounts share one handler instance, so each request still emits exactly once.**
- [x] Do not emit from `TracingRouter` (legacy deprecated trace endpoints).
- [x] Do not emit from `SpansRouter` (span events out of scope).
- [x] Trace events are only emitted by `TracesRouter`.

## Read emission (router layer)

- [x] Emit `traces.fetched` from `TracesRouter.fetch_trace` and `TracesRouter.fetch_traces` after the final response is materialized.
- [x] Emit `traces.queried` from `TracesRouter.query_traces` after the final response is materialized.
- [x] Trace endpoints that internally read spans emit only trace events.
- [x] Query revision endpoints emit query revision events, not trace events.
- [x] Loadable workflows do not emit trace events unless they call stable trace endpoints.
- [x] Emit `testcases.fetched` from `TestcasesRouter.fetch_testcase` and `TestcasesRouter.fetch_testcases`.
- [x] Emit `testcases.queried` from `TestcasesRouter.query_testcases`.
- [x] Emit `applications.revisions.retrieved`, `applications.revisions.fetched`, `applications.revisions.queried`, and `applications.revisions.logged` from the respective `ApplicationsRouter` handlers.
- [x] Emit `queries.revisions.retrieved/fetched/queried/logged` from the respective `QueriesRouter` handlers.
- [x] Emit `testsets.revisions.retrieved/fetched/queried/logged` from the respective `TestsetsRouter` handlers.
- [x] Emit `evaluators.revisions.retrieved/fetched/queried/logged` from the respective `EvaluatorsRouter` handlers.
- [x] Emit `environments.revisions.retrieved/fetched/queried/logged` from the respective `EnvironmentsRouter` handlers (already mounted at non-preview `/environments`).
- [x] Do not emit workflow revision events from `/workflows/revisions/*` yet.

## Commit emission (service layer)

- [x] Commit events emit from the **service-layer** `commit_*_revision(...)` for every domain. This ensures direct commit routes, simple-service create/edit, deploy paths, fork, and defaults seeding all produce exactly one commit event.
- [x] `EnvironmentsService.commit_environment_revision` — preserves `references`/`state`/`diff` and adds optional `message`.
- [x] `ApplicationsService.commit_application_revision`.
- [x] `QueriesService.commit_query_revision`.
- [x] `TestsetsService.commit_testset_revision`.
- [x] `EvaluatorsService.commit_evaluator_revision`.
- [x] Router handlers do **not** emit commit events; emission is exclusively at the service boundary, so compatibility routes do not double-publish.
- [x] Do not emit for artifact query/fetch routes such as `/workflows/query` or `/workflows/{workflow_id}`.
- [x] Do not emit for variant query/fetch routes such as `/workflows/variants/query` or `/workflows/variants/{workflow_variant_id}`.

## Tests

- [x] Add unit tests for event construction (`test_events_utils.py`).
- [x] Add unit tests for revision event construction across all supported domains, including incomplete references.
- [x] Add unit tests mapping retrieve, fetch, query, log, and commit actions to distinct event types per domain.
- [x] Add unit tests for stable trace and traces response counting (singular and plural).
- [x] Add unit tests for stable testcase and testcases response counting (singular and plural).
- [x] Add unit tests proving event-specific result lists are capped at 1000 and `count` remains accurate.
- [x] Add unit tests proving zero-count responses do not publish (read, query, log, commit).
- [x] Add unit tests proving publish failures are swallowed after logging.
- [x] Add tests proving trace and testcase read events are accepted by `EventType`.
- [x] Add tests proving all new event types are present in `WebhookEventType`.
- [x] Add service-layer commit unit tests proving exactly one commit event is emitted per commit call across all five domains.
- [ ] Acceptance coverage showing trace fetch emits exactly one `traces.fetched` event. *(Deferred — requires full HTTP + redis stack.)*
- [ ] Acceptance coverage showing trace query emits exactly one `traces.queried` event. *(Deferred.)*
- [ ] Acceptance coverage showing testcase fetch emits exactly one `testcases.fetched` event. *(Deferred.)*
- [ ] Acceptance coverage showing testcase query emits exactly one `testcases.queried` event. *(Deferred.)*
- [ ] Acceptance coverage proving the event appears in `POST /events/query`. *(Deferred.)*
- [ ] Acceptance coverage proving stable revision retrieve/fetch/query/log routes emit their distinct read event types exactly once. *(Deferred.)*
- [ ] Acceptance coverage proving stable revision commit routes emit commit events exactly once. *(Deferred.)*
- [ ] Acceptance coverage proving artifact and variant reads do not emit revision read events. *(Deferred.)*

## Docs

- [x] Update API reference docs (OpenAPI / Fern client) once event semantics are stable.
