# Extend Events Beyond Deployments — Findings

## Sources

- Branch: `feat/extend-events-beyond-deployments`
- Base: `feat/add-access-controls-in-env-vars`
- Path: `docs/designs/extend-events-beyond-deployments/`
- Scope: fresh `scan-codebase` pass at `depth=deep`. Re-read code, tests, routes, schemas, design docs from scratch against [proposal.md](./proposal.md), [events.md](./events.md), [research.md](./research.md), [gap.md](./gap.md), and [tasks.md](./tasks.md).

## Summary

Second-pass deep scan against the actual base branch (`feat/add-access-controls-in-env-vars`) confirms the core implementation is sound:

- All 29 new event types are present in [EventType](../../../api/oss/src/core/events/types.py) and [WebhookEventType](../../../api/oss/src/core/webhooks/types.py).
- Shared helpers in [core/events/utils.py](../../../api/oss/src/core/events/utils.py) enforce the read=router / write=service split, with `_safe_publish` swallowing publish failures.
- All eight in-scope router classes emit reads at the boundary (verified call-by-call against the diff).
- All five domain commit services emit exactly once; delta-commit recursion in [environments service:931](../../../api/oss/src/core/environments/service.py#L931) and [testsets service:866](../../../api/oss/src/core/testsets/service.py#L866) early-returns before the emission line so the second (non-delta) entry is the only one that publishes.
- `TracingRouter` and `SpansRouter` do not import or call any `publish_*` helper.
- Caching paths in `retrieve_query_revision` and `retrieve_testset_revision` correctly emit on cache hit (the helper call is after the cache check).
- 36 unit tests cover helper behavior and the five service-layer commit paths.
- Generated TS client (`WebhookEventType.ts`), `openapi.json`, and user-facing [04-webhooks.mdx](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx) all include the new event types.

Six new findings surfaced from this pass. One is `P1` (missing `Counter.EVENTS_INGESTED` L1/L2 entitlement check at ingest); the other five are `P3` forward-compat / consistency notes. The seven findings from the first scan (preserved as `[CLOSED]` below) remain closed.

## Rules

- Read emission lives at the router. Write emission lives at the service. See [core/events/utils.py:10-90](../../../api/oss/src/core/events/utils.py#L10-L90).
- `TracingRouter` and `SpansRouter` must **not** emit; `TracesRouter` is the only trace-event source.
- Workflow revision events stay out of scope until workflows are confirmed durable.
- All new event types are webhook-subscribable.
- Double-emission on simple-service create (initial empty commit + first data commit in `SimpleApplicationsService.create` and `SimpleEvaluatorsService.create`) is **intentional** — each revision is a real commit and emits its own event.

## Notes

- This scan is verification-only. No runtime tests were executed.
- `count` in revision events reflects the response payload size, not the unpaginated population. This matches the proposal phrasing ("Keep `count` as the uncapped total") which refers to truncation of the references list, not pagination of the underlying query.

## Open Questions

- None.

## Open Findings

### [OPEN] F-013 — `Counter.EVENTS_INGESTED` quota wired with L1/L2; `Flag.AUDIT` added at query side

- **Origin:** scan
- **Lens:** verification
- **Severity:** P1
- **Confidence:** high
- **Status:** in-progress
- **Category:** Functionality
- **Resolution notes (in-progress):**
  - **L1 (silent drop, publisher side)**: added `_check_l1_events_quota` inside `core/events/utils.py::_safe_publish`. Soft-checks `Counter.EVENTS_INGESTED` with `cache=True` and drops the publish silently on over-quota. No HTTP 429 — read/commit responses are unaffected.
  - **L2 (authoritative, worker side)**: added per-org `Counter.EVENTS_INGESTED` adjust in `EventsWorker.process_batch`. Charges the full per-org delta in one call (regroups by org from the project batches). Over-quota orgs drop their batch but messages are still ACKed.
  - **Removed stale `Flag.ACCESS` check from the events worker.** That gate was a copy-paste from the org-flag-mutation context and would have dropped events for Hobby/Pro plans (which have `Flag.ACCESS=False` by design).
  - **New `Flag.AUDIT`** added to `ee.src.core.entitlements.types`. Default values: Hobby=False, Pro=False, Business=True, Agenta=True, Self-hosted=True. Added to `CONSTRAINTS[BLOCKED]` so orgs cannot promote themselves.
  - **Query-side gate**: `POST /events/query` now checks `Flag.AUDIT` and returns `NOT_ENTITLED_RESPONSE(Tracker.FLAGS)` when the org's plan doesn't include it. Ingest and webhook delivery remain unchanged so upgrade flows make historical events queryable immediately and webhook subscribers keep receiving events regardless of audit-log entitlement.
  - **AuthScope propagation**: `request_scope()` and `publish_revision_event()` now resolve scope from the ambient `AuthScope` ContextVar first, falling back to `request.state`. This fixes F-009 — service-layer commits now ship `organization_id` derived from the auth middleware's AuthScope rather than `None`.
  - **Tests**: 8 new tests in `test_events_utils.py` (AuthScope precedence, L1 allow/drop/fail-open/skip-on-OSS/skip-when-org-unknown) and 5 new tests in `test_events_worker_l2.py` (allow, deny, per-org aggregation across projects, OSS skip, check-failure drop). One pre-existing test in `test_environments_service.py` updated to patch `publish_event` at its new site. All 575 OSS unit tests pass.
- **Files:**
  - [api/ee/src/core/entitlements/types.py:70](../../../api/ee/src/core/entitlements/types.py#L70)
  - [api/ee/src/core/entitlements/types.py:378-381](../../../api/ee/src/core/entitlements/types.py#L378-L381) (Hobby)
  - [api/ee/src/core/entitlements/types.py:465-468](../../../api/ee/src/core/entitlements/types.py#L465-L468) (Pro)
  - [api/ee/src/core/entitlements/types.py:552-555](../../../api/ee/src/core/entitlements/types.py#L552-L555) (Business)
  - [api/ee/src/core/entitlements/types.py:635-637](../../../api/ee/src/core/entitlements/types.py#L635-L637) (Agenta)
  - [api/ee/src/core/entitlements/types.py:669-671](../../../api/ee/src/core/entitlements/types.py#L669-L671) (Self-hosted)
  - [api/oss/src/tasks/asyncio/events/worker.py:151-238](../../../api/oss/src/tasks/asyncio/events/worker.py#L151-L238)
  - [api/oss/src/core/events/utils.py:200-222](../../../api/oss/src/core/events/utils.py#L200-L222)
  - [api/oss/src/apis/fastapi/tracing/router.py:270-289](../../../api/oss/src/apis/fastapi/tracing/router.py#L270-L289) (TRACES_INGESTED L1 pattern)
  - [api/oss/src/tasks/asyncio/tracing/worker.py:250-285](../../../api/oss/src/tasks/asyncio/tracing/worker.py#L250-L285) (TRACES_INGESTED L2 pattern)
- **Summary:** `Counter.EVENTS_INGESTED` is declared in `entitlements/types.py` and wired into every default plan's quota map and the `READ_ONLY` constraint list, and the EE retention flush job ([api/ee/src/core/events/service.py](../../../api/ee/src/core/events/service.py)) reads its `retention`. But nothing in the event-publish path actually calls `check_entitlements(key=Counter.EVENTS_INGESTED, delta=..., ...)`:
  - **L1 (router, soft check)**: the eight in-scope routers (`TracesRouter`, `TestcasesRouter`, plus the five `*Router.{retrieve,fetch,query,log,commit}_*_revision` handlers) call `publish_*` helpers without first calling `check_entitlements(key=Counter.EVENTS_INGESTED, ...)`. Compare to `tracing/router.py:280-289` where every trace-ingest path runs a `cache=True` soft check before queuing.
  - **L2 (worker, authoritative)**: `EventsWorker.process_batch` ([worker.py:204-219](../../../api/oss/src/tasks/asyncio/events/worker.py#L204-L219)) only calls `check_entitlements(key=Flag.ACCESS, ...)` — an access flag, not the counter — and never increments `EVENTS_INGESTED`. Compare to `tracing/worker.py:261-285` where the spans worker runs `check_entitlements(key=Counter.TRACES_INGESTED, delta=delta, scope=scope_from(organization_id=...))` as the authoritative DB check + adjust.
  Net effect: plans declare an `EVENTS_INGESTED` quota that is never enforced and a meter that is never bumped. Free/limit numbers in `DEFAULT_ENTITLEMENTS` (e.g. Hobby's monthly retention-only quota, Pro/Business's tiered allowances) are dead values. The Stripe billing path (`api/ee/src/apis/fastapi/billing/router.py:912-934`) and `Meters` row for `EVENTS_INGESTED` will never see usage.
- **Impact:**
  - Revenue/quota: customers cannot be metered or rate-limited on event production, and any future plan tier built on `EVENTS_INGESTED` (e.g. webhook-event allowances) silently has no effect.
  - Observability: usage dashboards driven by `Meters` show zero for `EVENTS_INGESTED` regardless of actual volume.
  - Cost: an unbounded event producer (e.g. an abusive trace-query loop) can write to `streams:events` and through `EventsService.ingest` without backpressure.
- **Suggested Fix:**
  - **L1 (router-layer soft check)**: add a `check_entitlements(key=Counter.EVENTS_INGESTED, delta=1, cache=True)` call inside each `publish_*` helper in `core/events/utils.py` (or in `_safe_publish`) before the Redis publish, gated by `is_ee()` and skipped for `delta == 0`. Choose between fast-rejecting the originating HTTP request (matches `TRACES_INGESTED`) and silently dropping the event (less surprising for read events that the user did not opt into producing). The former matches the trace pattern; the latter avoids breaking unrelated read paths because of a quota on a meta-event.
  - **L2 (worker authoritative check + adjust)**: in `EventsWorker.process_batch`, after the existing `Flag.ACCESS` check, add a per-org `check_entitlements(key=Counter.EVENTS_INGESTED, delta=len(events), scope=scope_from(organization_id=...))` (cache=False) and on `not allowed` drop the org's events. This is the only call site that can authoritatively bump the meter.
  - **Scope dependency**: L2 needs `organization_id` per event. Today commit events emitted from the service layer publish with `organization_id=None` (see [F-009]). That defect must be resolved (or `EventMessage.organization_id` must be derived from `project_id` inside the worker) before L2 can charge commit events to the right org.
  - **Tests**: add coverage in `test_events_utils.py` (L1 short-circuits when over quota) and `test_events_worker.py` (L2 drops events when `Counter.EVENTS_INGESTED` returns `allowed=False`). Mirror the existing TRACES_INGESTED tests as the template.
- **Alternatives:**
  - Treat event production as free of charge and remove `EVENTS_INGESTED` quotas from the default plans, but keep retention. Reduces operator confusion at the cost of leaving the meter inert.
  - Charge only "user-initiated" events (read events from routers) and exempt service-layer commit events, on the basis that commits are already counted indirectly via the revision write path. Requires a `count_for_meter: bool` knob on `publish_*`.

### [OPEN] F-008 — Applications/evaluators commit emission is coupled to `WorkflowsService` being silent

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** open
- **Category:** Compatibility
- **Files:**
  - [api/oss/src/core/applications/service.py:793-823](../../../api/oss/src/core/applications/service.py#L793-L823)
  - [api/oss/src/core/evaluators/service.py:780-823](../../../api/oss/src/core/evaluators/service.py#L780-L823)
  - [api/oss/src/core/workflows/service.py](../../../api/oss/src/core/workflows/service.py)
- **Summary:** `ApplicationsService.commit_application_revision` and `EvaluatorsService.commit_evaluator_revision` both delegate the actual write to `workflows_service.commit_workflow_revision(...)` and then publish their own `<domain>.revisions.committed` event. The "exactly once" invariant for application/evaluator commits depends on `WorkflowsService.commit_workflow_revision` **not** emitting anything itself. Today that holds (grep finds zero `publish_*` calls in `core/workflows/service.py`), but the workflows service has no test, comment, or interface contract that guarantees this. Any future change that adds an emission inside the workflows service — including the deferred `workflows.revisions.committed` event — would silently start producing two commit events per application/evaluator commit.
- **Impact:** A future workflows instrumentation PR would double-emit `applications.revisions.committed` and `evaluators.revisions.committed` without any test failing, because the unit tests in [test_service_commit_emission.py](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py) mock the `workflows_service` and never observe what a real implementation would emit.
- **Suggested Fix:**
  - Primary: add a one-line comment in `core/workflows/service.py::commit_workflow_revision` stating that the method must NOT call `publish_revision_event`, with a reference to the application/evaluator delegation; or equivalently, add a guard test that constructs a real (un-mocked) `WorkflowsService` and asserts exactly one `applications.revisions.committed` event fires.
  - Alternative: when workflows are instrumented later, move application/evaluator commit emission into the workflows service and have the application/evaluator services pass a `domain` kwarg through. Out of scope here.

### [OPEN] F-009 — Service-layer commit events drop `organization_id`; read events keep it

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** open
- **Category:** Consistency
- **Files:**
  - [api/oss/src/core/applications/service.py:814-821](../../../api/oss/src/core/applications/service.py#L814-L821)
  - [api/oss/src/core/queries/service.py:883-890](../../../api/oss/src/core/queries/service.py#L883-L890)
  - [api/oss/src/core/testsets/service.py:930-937](../../../api/oss/src/core/testsets/service.py#L930-L937)
  - [api/oss/src/core/evaluators/service.py:815-822](../../../api/oss/src/core/evaluators/service.py#L815-L822)
  - [api/oss/src/core/environments/service.py:989-1003](../../../api/oss/src/core/environments/service.py#L989-L1003)
  - [api/oss/src/core/events/utils.py:617-654](../../../api/oss/src/core/events/utils.py#L617-L654)
- **Summary:** Read emissions go through `request_scope(request)` and pass the resolved `organization_id` to `_safe_publish`. Service-layer commit emissions cannot read `request.state` and call `publish_revision_event` without `organization_id` (four services omit the kwarg entirely; `environments/service.py` passes `organization_id=None` explicitly). As a result, the Redis envelope and downstream `EventMessage` for every commit event carries `organization_id=null`, while read events of the same shape carry the real org UUID.
- **Impact:** Today the persisted `events` table is project-scoped only — see [dbes.py:10-71](../../../api/oss/src/dbs/postgres/events/dbes.py#L10-L71) — and the webhook dispatcher routes by `project_id`, so the asymmetry has no functional effect. The wire-format `EventMessage` in [streaming.py:39-45](../../../api/oss/src/core/events/streaming.py#L39-L45) carries `organization_id` but no current consumer reads it on commit events. The asymmetry becomes a real bug the moment anything (analytics, future org-level filtering, the planned `OrganizationScopeDBA` hinted at in the `# TODO` at [dbes.py:7](../../../api/oss/src/dbs/postgres/events/dbes.py#L7)) starts relying on `organization_id` for commit events.
- **Suggested Fix:**
  - Primary: have each commit-service method resolve `organization_id` from the project (e.g. `await projects_service.fetch(project_id=...)`) and pass it through. Adds one async lookup per commit.
  - Alternative: thread `organization_id` from the router into each commit-service signature so the service does not have to re-resolve it. Pure plumbing change; matches how `user_id` is already threaded.
  - Doc-only fallback: document the asymmetry in `core/events/utils.py` and `events.md` so subscribers do not assume commit events carry `organization_id`.

### [OPEN] F-010 — Delta-commit re-entry path is not covered by the exactly-once commit tests

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** open
- **Category:** Testing
- **Files:**
  - [api/oss/src/core/environments/service.py:918-1003](../../../api/oss/src/core/environments/service.py#L918-L1003)
  - [api/oss/src/core/environments/service.py:1005-1071](../../../api/oss/src/core/environments/service.py#L1005-L1071)
  - [api/oss/src/core/testsets/service.py:855-939](../../../api/oss/src/core/testsets/service.py#L855-L939)
  - [api/oss/src/core/testsets/service.py:981-1112](../../../api/oss/src/core/testsets/service.py#L981-L1112)
  - [api/oss/tests/pytest/unit/events/test_service_commit_emission.py:306-373](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py#L306-L373)
- **Summary:** `commit_environment_revision` and `commit_testset_revision` early-return into `_commit_*_revision_delta` whenever the request carries `delta` instead of `data`. The delta helper resolves the delta into full data and then re-enters `commit_*_revision`, which now takes the non-delta branch and reaches the single `publish_revision_event` call. The structure is sound, but the existing unit tests only construct non-delta commits (`EnvironmentRevisionData(references={})`, `TestsetRevisionData(testcase_ids=[])`). There is no test asserting that a delta commit emits exactly one event — neither zero (regression: early-return missing the emit) nor two (regression: emit added to the delta helper as well).
- **Impact:** A future refactor that, for example, moves the `publish_revision_event` call out of the non-delta branch and into a shared helper at the top of `commit_*_revision` could either silently double-emit on delta commits (if it fires before the early return) or silently miss the event (if it fires only inside the delta helper without re-entry). Neither case would be caught by the current test suite.
- **Suggested Fix:**
  - Add one test per service that constructs a delta commit, mocks `_get_previous_environment_references` / equivalent so the delta resolves to full data, and asserts `len(captured_events) == 1`.

### [OPEN] F-011 — `events.md` per-event reference does not document the delta-commit emission rule

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** medium
- **Status:** open
- **Category:** Completeness
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/events.md:679-712](./events.md#L679-L712)
  - [api/oss/src/core/environments/service.py:918-1003](../../../api/oss/src/core/environments/service.py#L918-L1003)
- **Summary:** [events.md](./events.md) describes per-event payloads in detail but does not document how the `*.revisions.committed` event interacts with delta commits. A reader implementing a webhook consumer would not know from this doc that a `POST /environments/revisions/commit` with `delta` (instead of `data`) produces exactly one event — the same as a full-data commit — because the resolved-delta re-entry path is what actually publishes.
- **Impact:** Consumers planning idempotency / deduplication around commit events have to read the service code to confirm the semantics. Low-impact because the implementation is already correct.
- **Suggested Fix:** Add a one-line note under the commit-event sections (or in the [proposal.md](./proposal.md) "Create and Commit Note") stating "delta commits emit exactly one `*.revisions.committed` event, after the delta is resolved into full data."

### [OPEN] F-012 — Webhook event-type list in user docs and TS client can drift from `WebhookEventType`

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** open
- **Category:** Migration
- **Files:**
  - [docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx:239-285](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx#L239-L285)
  - [api/oss/src/core/webhooks/types.py:47-101](../../../api/oss/src/core/webhooks/types.py#L47-L101)
  - [web/packages/agenta-api-client/src/generated/api/types/WebhookEventType.ts](../../../web/packages/agenta-api-client/src/generated/api/types/WebhookEventType.ts)
- **Summary:** The user-facing webhook docs and the TS client both enumerate the subscribable event types. Today they are in sync with `WebhookEventType` because they were updated together with this PR, but there is no automated check (or even a contributing note) tying the three artifacts together. The next person to add a `WebhookEventType` value can ship a green build with stale docs or a stale generated client.
- **Impact:** Webhook subscribers reading the docs would see a partial event-type list and miss new subscriptions; the Fern client would not type-check against new event values until regenerated.
- **Suggested Fix:**
  - Primary: add a contributing checklist entry ("when extending `WebhookEventType`, regenerate the Fern client and update `04-webhooks.mdx`") next to the enum definition in `core/webhooks/types.py`.
  - Alternative: add a small unit test that loads the markdown file, scrapes the bullet list under "Available event types", and compares it to `WebhookEventType.values()`. Fragile but catches drift mechanically.

## Closed Findings

### [CLOSED] F-001 — Acceptance test coverage deferred for the event-emission surface

- **Origin:** scan
- **Lens:** verification
- **Severity:** P2
- **Confidence:** high
- **Status:** wontfix
- **Category:** Testing
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/tasks.md:82-89](./tasks.md#L82-L89)
  - [api/oss/tests/pytest/acceptance/events/test_events_basics.py](../../../api/oss/tests/pytest/acceptance/events/test_events_basics.py)
- **Summary:** Eight acceptance items in `tasks.md` remain unchecked, all labelled "Deferred — requires full HTTP + redis stack." There is no end-to-end test that drives an HTTP request through the real router → publisher → worker → `events` table and asserts the event appears in `POST /events/query`.
- **Disposition:** Deferred by design and accepted for this branch. Unit helper coverage ([test_events_utils.py](../../../api/oss/tests/pytest/unit/events/test_events_utils.py), 30 tests) and service-layer mock coverage ([test_service_commit_emission.py](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py), 6 tests across all five commit services) are sufficient for merge. Full acceptance coverage stays deferred until the HTTP + Redis fixture lands.

### [CLOSED] F-002 — `proposal.md` / `research.md` described the environments mount as a "gap to fix"

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** fixed
- **Category:** Consistency
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/proposal.md](./proposal.md)
  - [docs/designs/extend-events-beyond-deployments/research.md](./research.md)
  - [api/entrypoints/routers.py:977-988](../../../api/entrypoints/routers.py#L977-L988)
- **Summary:** Both docs still claimed the domain-style `EnvironmentsRouter` was preview-mount-only and treated that as a gap. The code mounts it at both `/environments` and `/preview/environments` from a single shared instance.
- **Resolution:** Rewrote the "Environment note" block in `proposal.md` and the "Environment caveat" block in `research.md` to describe the dual mount with a single shared instance, and to record that each request emits exactly once.

### [CLOSED] F-003 — `proposal.md` showed an incorrect helper signature

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** medium
- **Status:** fixed
- **Category:** Consistency
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/proposal.md](./proposal.md)
  - [api/oss/src/core/events/utils.py:572-654](../../../api/oss/src/core/events/utils.py#L572-L654)
- **Summary:** `proposal.md` listed `publish_revision_event(domain, action, revision|revisions, ..., request=... | project_id/user_id explicit)`, which a reader could mistake for a positional call. The actual helper is keyword-only and exposes `organization_id`, `extra`, and `count` kwargs not shown in the doc.
- **Resolution:** Updated the "Emission Design" helper list in `proposal.md` to show the full keyword-only signatures of all five helpers, including `publish_revision_event`'s `organization_id`, `extra`, and `count` kwargs.

### [CLOSED] F-004 — `events.md` overview included `count` in a shape that also applies to commits

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** medium
- **Status:** fixed
- **Category:** Consistency
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/events.md](./events.md)
  - [api/oss/src/core/events/utils.py:521-569](../../../api/oss/src/core/events/utils.py#L521-L569)
- **Summary:** The "Revision Payload Pattern" overview showed `count: 1` on a generic single-revision shape. Commit events deliberately omit `count` (the helper drops it). Per-event examples elsewhere in `events.md` are correct; only the overview was ambiguous.
- **Resolution:** Added a clarifying sentence at the top of the "Revision Payload Pattern" section noting that read events include `count` and commit events omit it (enforced by the helper), and that the generic shapes apply to read events.

### [CLOSED] F-005 — `environments.revisions.retrieved` does not include `resolution_info`

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** medium
- **Status:** wontfix
- **Category:** Completeness
- **Files:**
  - [api/oss/src/apis/fastapi/environments/router.py:771-783](../../../api/oss/src/apis/fastapi/environments/router.py#L771-L783)
- **Summary:** `EnvironmentsRouter.retrieve_environment_revision` returns `environment_revision` and `resolution_info`. The event only carries `environment_revision` references; `resolution_info` is dropped.
- **Disposition:** Wontfix. Retrieve events stay identity-only by design — consumers that need resolved app revisions should subscribe to `environments.revisions.committed` (which already carries `state`/`diff`).

### [CLOSED] F-006 — No assertion that dual-mount domain routers do not double-emit

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** high
- **Status:** wontfix
- **Category:** Testing
- **Files:**
  - [api/entrypoints/routers.py:977-988](../../../api/entrypoints/routers.py#L977-L988)
- **Summary:** The exactly-once property of `/environments` + `/preview/environments` depends on both prefixes sharing one `EnvironmentsRouter` instance. No regression test enforces that invariant.
- **Disposition:** Wontfix / false-positive. The single-instance pattern is held in place by the existing instantiation block in `routers.py`; the hypothetical refactor that would break it is not a real risk.

### [CLOSED] F-007 — OpenAPI / Fern client regeneration not verifiable from scan

- **Origin:** scan
- **Lens:** verification
- **Severity:** P3
- **Confidence:** low
- **Status:** wontfix
- **Category:** Consistency
- **Files:**
  - [docs/designs/extend-events-beyond-deployments/tasks.md:92-93](./tasks.md#L92-L93)
- **Summary:** Tasks marks "Update API reference docs (OpenAPI / Fern client)" as `[x]`, but a scan cannot verify the generated artifacts include the new `WebhookEventType` values.
- **Disposition:** Wontfix at scan time. Owner will regenerate Fern clients and API references as the final step before merge. (This second scan pass confirmed `openapi.json` and `WebhookEventType.ts` were regenerated and include all 29 new event types — see the parent PR diff.)
