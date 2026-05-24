# Extend Events Beyond Deployments — Findings

## Sources

- Branch: `feat/extend-events-beyond-deployments`
- Base: `feat/add-access-controls-in-env-vars`
- Path: `docs/designs/extend-events-beyond-deployments/`
- Scope: fresh `scan-codebase` pass at `depth=deep`. Re-read code, tests, routes, schemas, design docs from scratch against [proposal.md](./proposal.md), [events.md](./events.md), [research.md](./research.md), [gap.md](./gap.md), and [tasks.md](./tasks.md).

## Summary

Deep scans against the actual base branch (`feat/add-access-controls-in-env-vars`) confirm the core event-emission implementation is now mostly sound:

- All 29 new event types are present in [EventType](../../../api/oss/src/core/events/types.py) and [WebhookEventType](../../../api/oss/src/core/webhooks/types.py).
- Shared helpers in [core/events/utils.py](../../../api/oss/src/core/events/utils.py) enforce the read=router / write=service split, swallow publish failures, and now run the L1 `Counter.EVENTS_INGESTED` soft check.
- `EventsWorker.process_batch` now performs the L2 authoritative per-org `Counter.EVENTS_INGESTED` adjustment.
- Service-layer commit events now resolve organization scope through AuthScope-first scope resolution rather than dropping `organization_id`.
- Generated TS/Python clients, `openapi.json`, and user-facing webhook docs include the new event types.

All scan findings that were actionable in this pass have been resolved or explicitly closed. The remaining closed record below preserves the review history and rationale.


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

_None._

## Open Findings

_None._

## Closed Findings

### F-010 — [CLOSED] Delta-commit re-entry path is not covered by the exactly-once commit tests

- ID: F-010
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Testing
- Files:
  - [api/oss/src/core/environments/service.py:918-1003](../../../api/oss/src/core/environments/service.py#L918-L1003)
  - [api/oss/src/core/environments/service.py:1005-1071](../../../api/oss/src/core/environments/service.py#L1005-L1071)
  - [api/oss/src/core/testsets/service.py:855-939](../../../api/oss/src/core/testsets/service.py#L855-L939)
  - [api/oss/src/core/testsets/service.py:981-1112](../../../api/oss/src/core/testsets/service.py#L981-L1112)
  - [api/oss/tests/pytest/unit/events/test_service_commit_emission.py:306-373](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py#L306-L373)
- Summary: `commit_environment_revision` and `commit_testset_revision` early-return into `_commit_*_revision_delta` whenever the request carries `delta` instead of `data`. The delta helper resolves the delta into full data and then re-enters `commit_*_revision`, which now takes the non-delta branch and reaches the single `publish_revision_event` call. The structure is sound, but the existing unit tests only construct non-delta commits (`EnvironmentRevisionData(references={})`, `TestsetRevisionData(testcase_ids=[])`). There is no test asserting that a delta commit emits exactly one event — neither zero (regression: early-return missing the emit) nor two (regression: emit added to the delta helper as well).
- Evidence:
  - [environments/service.py:918-1071](../../../api/oss/src/core/environments/service.py#L918-L1071) and [testsets/service.py:855-1112](../../../api/oss/src/core/testsets/service.py#L855-L1112) route delta commits through a re-entry helper.
  - [test_service_commit_emission.py:306-373](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py#L306-L373) covers non-delta commits only.
- Cause: The first exactly-once tests were written around the straightforward full-data path, not the less common delta normalization path.
- Explanation: The current implementation is sound, but the uncovered branch is precisely where an apparently harmless refactor could introduce zero or duplicate emission.
- Impact: A future refactor that, for example, moves the `publish_revision_event` call out of the non-delta branch and into a shared helper at the top of `commit_*_revision` could either silently double-emit on delta commits (if it fires before the early return) or silently miss the event (if it fires only inside the delta helper without re-entry). Neither case would be caught by the current test suite.
- Suggested Fix:
  - Add one test per service that constructs a delta commit, mocks `_get_previous_environment_references` / equivalent so the delta resolves to full data, and asserts `len(captured_events) == 1`.
- Alternatives: Accept the latent gap, but then future refactors of delta normalization remain unguarded.
- Resolution: Closed as fixed. Added delta-commit exactly-once coverage for both environment and testset service commit paths in `test_service_commit_emission.py`; each test drives the delta branch through re-entry and asserts exactly one commit event is published.
- Sources: Second `scan-codebase` pass.

### F-011 — [CLOSED] `events.md` per-event reference does not document the delta-commit emission rule

- ID: F-011
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: fixed
- Category: Completeness
- Files:
  - [docs/designs/extend-events-beyond-deployments/events.md:679-712](./events.md#L679-L712)
  - [api/oss/src/core/environments/service.py:918-1003](../../../api/oss/src/core/environments/service.py#L918-L1003)
- Summary: [events.md](./events.md) describes per-event payloads in detail but does not document how the `*.revisions.committed` event interacts with delta commits. A reader implementing a webhook consumer would not know from this doc that a `POST /environments/revisions/commit` with `delta` (instead of `data`) produces exactly one event — the same as a full-data commit — because the resolved-delta re-entry path is what actually publishes.
- Evidence:
  - [events.md:679-712](./events.md#L679-L712) documents commit payloads but does not state the delta-commit rule.
  - [environments/service.py:918-1003](../../../api/oss/src/core/environments/service.py#L918-L1003) implements delta resolution followed by one re-entered commit publish.
- Cause: The event catalog focused on payload shapes and did not capture a behavior that is encoded in service control flow rather than the payload schema.
- Explanation: Consumers can infer the rule only by reading code, even though it affects deduplication expectations for commit webhooks.
- Impact: Consumers planning idempotency / deduplication around commit events have to read the service code to confirm the semantics. Low-impact because the implementation is already correct.
- Suggested Fix: Add a one-line note under the commit-event sections (or in the [proposal.md](./proposal.md) "Create and Commit Note") stating "delta commits emit exactly one `*.revisions.committed` event, after the delta is resolved into full data."
- Alternatives: Leave the rule implicit in service code, at the cost of making consumer-facing semantics harder to discover.
- Resolution: Closed as fixed. Updated `events.md` to state that delta commits emit exactly one `*.revisions.committed` event after the delta is resolved into full committed data, with an environment-specific note under `environments.revisions.committed`.
- Sources: Second `scan-codebase` pass.

### F-012 — [CLOSED] Webhook event-type list in user docs and TS client can drift from `WebhookEventType`

- ID: F-012
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Migration
- Files:
  - [docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx:239-285](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx#L239-L285)
  - [api/oss/src/core/webhooks/types.py:47-101](../../../api/oss/src/core/webhooks/types.py#L47-L101)
  - [web/packages/agenta-api-client/src/generated/api/types/WebhookEventType.ts](../../../web/packages/agenta-api-client/src/generated/api/types/WebhookEventType.ts)
- Summary: The user-facing webhook docs and the TS client both enumerate the subscribable event types. Today they are in sync with `WebhookEventType` because they were updated together with this PR, but there is no automated check (or even a contributing note) tying the three artifacts together. The next person to add a `WebhookEventType` value can ship a green build with stale docs or a stale generated client.
- Evidence:
  - [core/webhooks/types.py](../../../api/oss/src/core/webhooks/types.py), [WebhookEventType.ts](../../../web/packages/agenta-api-client/src/generated/api/types/WebhookEventType.ts), and [04-webhooks.mdx](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx) each maintain their own event-type surface.
  - No automated check or contribution note ties the three artifacts together.
- Cause: The enum, generated clients, and hand-authored documentation are updated through different workflows.
- Explanation: They are synchronized in this branch, but nothing makes future synchronization fail closed.
- Impact: Webhook subscribers reading the docs would see a partial event-type list and miss new subscriptions; the Fern client would not type-check against new event values until regenerated.
- Suggested Fix:
  - Primary: add a contributing checklist entry ("when extending `WebhookEventType`, regenerate the Fern client and update `04-webhooks.mdx`") next to the enum definition in `core/webhooks/types.py`.
  - Alternative: add a small unit test that loads the markdown file, scrapes the bullet list under "Available event types", and compares it to `WebhookEventType.values()`. Fragile but catches drift mechanically.
- Alternatives: Keep a manual checklist only; weaker than a generated/checking path but still better than no coupling note.
- Resolution: Closed as fixed. Added a maintainer note to `WebhookEventType` documenting that extending the enum requires regenerating Fern clients and updating the `04-webhooks.mdx` Available event types section.
- Sources: Second `scan-codebase` pass.

### F-016 — [CLOSED] Webhook user docs say commit events carry `count`, but commit payloads intentionally omit it

- ID: F-016
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Correctness
- Summary: The user-facing webhook guide says “Revision events carry `references`, `count`, and `user_id`. Commit events also carry optional `message`.” The implementation and event catalog intentionally do the opposite for commits: `build_revision_event_attributes()` skips `count` when `action == "commit"`, and `events.md` explicitly says commit events omit `count`.
- Evidence:
  - [04-webhooks.mdx:263-270](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx#L263-L270) claims revision events carry `count` before introducing commit events.
  - [events.md:151-152](./events.md#L151-L152) states commit events omit `count`.
  - [core/events/utils.py:636-683](../../../api/oss/src/core/events/utils.py#L636-L683) only adds `count` for non-commit single-revision actions.
- Files:
  - [docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx](../../../docs/docs/prompt-engineering/integrating-prompts/04-webhooks.mdx)
  - [docs/designs/extend-events-beyond-deployments/events.md](./events.md)
  - [api/oss/src/core/events/utils.py](../../../api/oss/src/core/events/utils.py)
- Cause: The public webhook copy generalized the read-event payload sentence across all revision events after commit events were added, while the implementation preserved the older environment-commit contract that intentionally omits `count`.
- Explanation: Read/log revision events and commit revision events have different payload contracts. The current MDX collapses them into one sentence, so the public contract no longer matches the emitted JSON for `*.revisions.committed`.
- Impact: Webhook consumers following the public docs may build schemas or downstream logic that require `count` on `*.revisions.committed`, then fail on valid production payloads.
- Suggested Fix: Split the sentence by action family: read/log revision events carry `count`; commit events carry `references`, `user_id`, and optional `message` but omit `count`.
- Alternatives: Add `count=1` to commit payloads for uniformity, but that would intentionally change the as-shipped contract and contradict the current proposal/event catalog.
- Resolution: Closed as fixed. Updated the public webhook docs to distinguish revision read/log payloads from commit payloads: read/log events carry `count`; commit events carry references, user_id, optional message, and no count.
- Sources: Fresh `scan-codebase` pass on 2026-05-18.

### F-017 — [CLOSED] Design docs still preserve pre-AuthScope / pre-metering assumptions after the implementation changed

- ID: F-017
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The as-shipped helper now resolves scope `AuthScope`-first with `request.state` fallback, and the branch now enforces `Counter.EVENTS_INGESTED` through L1/L2 checks. Some design docs still describe the older model.
- Evidence:
  - [proposal.md:214-219](./proposal.md#L214-L219) says helpers resolve scope from `request.state`.
  - [research.md:238-247](./research.md#L238-L247) frames router emission only around `request.state`.
  - [dynamic-access-and-billing/gap.md:69-77](../dynamic-access-and-billing/gap.md#L69-L77) still calls `EVENTS_INGESTED` a retention-only, unmetered counter.
  - [core/events/utils.py:184-220](../../../api/oss/src/core/events/utils.py#L184-L220) implements AuthScope-first resolution.
  - [core/events/utils.py:245-321](../../../api/oss/src/core/events/utils.py#L245-L321) implements the L1 events quota check.
- Files:
  - [docs/designs/extend-events-beyond-deployments/proposal.md](./proposal.md)
  - [docs/designs/extend-events-beyond-deployments/research.md](./research.md)
  - [docs/designs/dynamic-access-and-billing/gap.md](../dynamic-access-and-billing/gap.md)
  - [api/oss/src/core/events/utils.py](../../../api/oss/src/core/events/utils.py)
- Cause: The design docs were written before the F-009/F-013 implementation changes and were not fully reconciled after the branch adopted AuthScope-first scope propagation and event metering.
- Explanation: `summary.md` and the current code now describe the final shipped model, but `proposal.md`, `research.md`, and the adjacent gap doc still record the earlier implementation assumption without marking it historical.
- Impact: A future contributor reading proposal/gap instead of summary/code can reintroduce the exact asymmetry this branch just fixed, or make the wrong assumption about whether events usage is chargeable/enforced.
- Suggested Fix: Update proposal/research to describe AuthScope-first resolution with `request.state` fallback, and update the adjacent gap doc to the current usage + retention model or explicitly mark that paragraph historical.
- Alternatives: Leave historical docs untouched, but then add a clear “superseded by summary/current implementation” note at each stale paragraph.
- Resolution: Closed as fixed. Updated proposal/research wording to describe AuthScope-first scope resolution with `request.state` fallback, and updated the adjacent dynamic-access-and-billing gap doc to describe `EVENTS_INGESTED` as an events usage + retention counter.
- Sources: Fresh `scan-codebase` pass on 2026-05-18.

### F-018 — [CLOSED] New `Flag.AUDIT` query gate has no direct test coverage

- ID: F-018
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Testing
- Summary: The branch adds a new entitlement decision at `POST /events/query`: after `Permission.VIEW_SPANS`, EE requests must pass `Flag.AUDIT` or receive `NOT_ENTITLED_RESPONSE(Tracker.FLAGS)`. Existing tests cover event-query happy-path behavior and worker-side `EVENTS_INGESTED` metering, but not the new `Flag.AUDIT` allow/deny branch.
- Evidence:
  - [events/router.py:34-67](../../../api/oss/src/apis/fastapi/events/router.py#L34-L67) adds the `Flag.AUDIT` check.
  - [test_events_basics.py](../../../api/oss/tests/pytest/acceptance/events/test_events_basics.py) covers only normal event-query responses and validation.
  - [test_events_worker_l2.py](../../../api/oss/tests/pytest/unit/events/test_events_worker_l2.py) covers the worker quota path, not the query-router feature gate.
  - Repo grep found no test references to `Flag.AUDIT` or `query_events` beyond the acceptance happy-path file.
- Files:
  - [api/oss/src/apis/fastapi/events/router.py](../../../api/oss/src/apis/fastapi/events/router.py)
  - [api/oss/tests/pytest/acceptance/events/test_events_basics.py](../../../api/oss/tests/pytest/acceptance/events/test_events_basics.py)
  - [api/oss/tests/pytest/unit/events/test_events_worker_l2.py](../../../api/oss/tests/pytest/unit/events/test_events_worker_l2.py)
- Cause: The entitlement feature gate was added as part of the quota follow-up, but the added tests focused on scope propagation and L1/L2 metering rather than the new router branch.
- Explanation: The new code path is product-visible and has two materially different outcomes, yet current automated coverage exercises only the pre-existing query success surface.
- Impact: A future refactor could remove, invert, or bypass the audit-log gate while the current suite remains green.
- Suggested Fix: Add targeted router tests for the EE path: one asserting `Flag.AUDIT=True` returns the normal `EventsQueryResponse`, and one asserting `Flag.AUDIT=False` returns the 403 feature-gate response.
- Alternatives: Cover the same branch in EE acceptance tests instead, but a unit-style router test is smaller and does not require Redis or worker integration.
- Resolution: Closed as fixed. Added direct router tests for the `Flag.AUDIT` query gate covering both entitled success and unentitled 403 behavior in `test_events_router_audit.py`.
- Sources: Fresh `scan-codebase` pass on 2026-05-18.

### F-008 — [CLOSED] Applications/evaluators commit emission is coupled to `WorkflowsService` being silent

- ID: F-008
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: wontfix
- Category: Compatibility
- Files:
  - [api/oss/src/core/applications/service.py:793-823](../../../api/oss/src/core/applications/service.py#L793-L823)
  - [api/oss/src/core/evaluators/service.py:780-823](../../../api/oss/src/core/evaluators/service.py#L780-L823)
  - [api/oss/src/core/workflows/service.py](../../../api/oss/src/core/workflows/service.py)
- Summary: `ApplicationsService.commit_application_revision` and `EvaluatorsService.commit_evaluator_revision` both delegate the actual write to `workflows_service.commit_workflow_revision(...)` and then publish their own `<domain>.revisions.committed` event. The "exactly once" invariant for application/evaluator commits depends on `WorkflowsService.commit_workflow_revision` **not** emitting anything itself. Today that holds (grep finds zero `publish_*` calls in `core/workflows/service.py`), but the workflows service has no test, comment, or interface contract that guarantees this. Any future change that adds an emission inside the workflows service — including the deferred `workflows.revisions.committed` event — would silently start producing two commit events per application/evaluator commit.
- Evidence:
  - [applications/service.py:793-823](../../../api/oss/src/core/applications/service.py#L793-L823) and [evaluators/service.py:780-823](../../../api/oss/src/core/evaluators/service.py#L780-L823) delegate to `workflows_service.commit_workflow_revision(...)` and emit afterward.
  - Repo grep finds no `publish_*` call in [core/workflows/service.py](../../../api/oss/src/core/workflows/service.py).
- Cause: Applications and evaluators reuse workflow persistence, while event emission is layered outside the shared workflow commit helper.
- Explanation: That layering is correct today but only by convention; there is no executable contract protecting it if workflows later gain their own commit event.
- Impact: A future workflows instrumentation PR would double-emit `applications.revisions.committed` and `evaluators.revisions.committed` without any test failing, because the unit tests in [test_service_commit_emission.py](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py) mock the `workflows_service` and never observe what a real implementation would emit.
- Suggested Fix:
  - Primary: add a one-line comment in `core/workflows/service.py::commit_workflow_revision` stating that the method must NOT call `publish_revision_event`, with a reference to the application/evaluator delegation; or equivalently, add a guard test that constructs a real (un-mocked) `WorkflowsService` and asserts exactly one `applications.revisions.committed` event fires.
  - Alternative: when workflows are instrumented later, move application/evaluator commit emission into the workflows service and have the application/evaluator services pass a `domain` kwarg through. Out of scope here.
- Alternatives: When workflow revisions become durable/public, centralize domain-aware emission in the workflow service instead.
- Resolution: Wontfix by design. We are intentionally not adding workflow commit publishing because application/evaluator commits delegate through `WorkflowsService.commit_workflow_revision()` and already publish their domain-specific commit events afterward. Added a commented-out publish marker in `core/workflows/service.py::commit_workflow_revision` warning that enabling workflow publishing there would double-emit application/evaluator commit events.
- Sources: Second `scan-codebase` pass.

### F-013 — [CLOSED] `Counter.EVENTS_INGESTED` quota was missing from event ingest

- ID: F-013
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Functionality
- Resolution notes:
  - **L1 (silent drop, publisher side)**: added `_check_l1_events_quota` inside `core/events/utils.py::_safe_publish`. Soft-checks `Counter.EVENTS_INGESTED` with `cache=True` and drops the publish silently on over-quota. No HTTP 429 — read/commit responses are unaffected.
  - **L2 (authoritative, worker side)**: added per-org `Counter.EVENTS_INGESTED` adjust in `EventsWorker.process_batch`. Charges the full per-org delta in one call (regroups by org from the project batches). Over-quota orgs drop their batch but messages are still ACKed.
  - **Removed stale `Flag.ACCESS` check from the events worker.** That gate was a copy-paste from the org-flag-mutation context and would have dropped events for Hobby/Pro plans (which have `Flag.ACCESS=False` by design).
  - **New `Flag.AUDIT`** added to `ee.src.core.entitlements.types`. Default values: Hobby=False, Pro=False, Business=True, Agenta=True, Self-hosted=True. Added to `CONSTRAINTS[BLOCKED]` so orgs cannot promote themselves.
  - **Query-side gate**: `POST /events/query` now checks `Flag.AUDIT` and returns `NOT_ENTITLED_RESPONSE(Tracker.FLAGS)` when the org's plan doesn't include it. Ingest and webhook delivery remain unchanged so upgrade flows make historical events queryable immediately and webhook subscribers keep receiving events regardless of audit-log entitlement.
  - **AuthScope propagation**: `request_scope()` and `publish_revision_event()` now resolve scope from the ambient `AuthScope` ContextVar first, falling back to `request.state`. This fixes F-009 — service-layer commits now ship `organization_id` derived from the auth middleware's AuthScope rather than `None`.
  - **Tests**: 8 new tests in `test_events_utils.py` (AuthScope precedence, L1 allow/drop/fail-open/skip-on-OSS/skip-when-org-unknown) and 5 new tests in `test_events_worker_l2.py` (allow, deny, per-org aggregation across projects, OSS skip, check-failure drop). One pre-existing test in `test_environments_service.py` updated to patch `publish_event` at its new site. All 575 OSS unit tests pass.
- Files:
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
- Summary: `Counter.EVENTS_INGESTED` is declared in `entitlements/types.py` and wired into every default plan's quota map and the `READ_ONLY` constraint list, and the EE retention flush job ([api/ee/src/core/events/service.py](../../../api/ee/src/core/events/service.py)) reads its `retention`. But nothing in the event-publish path actually calls `check_entitlements(key=Counter.EVENTS_INGESTED, delta=..., ...)`:
  - **L1 (router, soft check)**: the eight in-scope routers (`TracesRouter`, `TestcasesRouter`, plus the five `*Router.{retrieve,fetch,query,log,commit}_*_revision` handlers) call `publish_*` helpers without first calling `check_entitlements(key=Counter.EVENTS_INGESTED, ...)`. Compare to `tracing/router.py:280-289` where every trace-ingest path runs a `cache=True` soft check before queuing.
  - **L2 (worker, authoritative)**: `EventsWorker.process_batch` ([worker.py:204-219](../../../api/oss/src/tasks/asyncio/events/worker.py#L204-L219)) only calls `check_entitlements(key=Flag.ACCESS, ...)` — an access flag, not the counter — and never increments `EVENTS_INGESTED`. Compare to `tracing/worker.py:261-285` where the spans worker runs `check_entitlements(key=Counter.TRACES_INGESTED, delta=delta, scope=scope_from(organization_id=...))` as the authoritative DB check + adjust.
  Net effect: plans declare an `EVENTS_INGESTED` quota that is never enforced and a meter that is never bumped. Free/limit numbers in `DEFAULT_ENTITLEMENTS` (e.g. Hobby's monthly retention-only quota, Pro/Business's tiered allowances) are dead values. The Stripe billing path (`api/ee/src/apis/fastapi/billing/router.py:912-934`) and `Meters` row for `EVENTS_INGESTED` will never see usage.
- Evidence:
  - Pre-fix diff showed no `Counter.EVENTS_INGESTED` check in the publish path and only `Flag.ACCESS` in `EventsWorker.process_batch`.
  - The current in-progress resolution notes record the added L1 helper, L2 worker adjustment, AuthScope propagation, and new tests.
- Cause: The events counter was introduced for retention before the event-emission surface started using it for production quotas, so the meter existed in plan defaults without a write-path adjust.
- Explanation: Retention configuration and usage metering share the same counter enum, but only the tracing path had the two-layer enforcement pattern before this follow-up.
- Impact:
  - Revenue/quota: customers cannot be metered or rate-limited on event production, and any future plan tier built on `EVENTS_INGESTED` (e.g. webhook-event allowances) silently has no effect.
  - Observability: usage dashboards driven by `Meters` show zero for `EVENTS_INGESTED` regardless of actual volume.
  - Cost: an unbounded event producer (e.g. an abusive trace-query loop) can write to `streams:events` and through `EventsService.ingest` without backpressure.
- Suggested Fix:
  - **L1 (router-layer soft check)**: add a `check_entitlements(key=Counter.EVENTS_INGESTED, delta=1, cache=True)` call inside each `publish_*` helper in `core/events/utils.py` (or in `_safe_publish`) before the Redis publish, gated by `is_ee()` and skipped for `delta == 0`. Choose between fast-rejecting the originating HTTP request (matches `TRACES_INGESTED`) and silently dropping the event (less surprising for read events that the user did not opt into producing). The former matches the trace pattern; the latter avoids breaking unrelated read paths because of a quota on a meta-event.
  - **L2 (worker authoritative check + adjust)**: in `EventsWorker.process_batch`, after the existing `Flag.ACCESS` check, add a per-org `check_entitlements(key=Counter.EVENTS_INGESTED, delta=len(events), scope=scope_from(organization_id=...))` (cache=False) and on `not allowed` drop the org's events. This is the only call site that can authoritatively bump the meter.
  - **Scope dependency**: L2 needs `organization_id` per event. Today commit events emitted from the service layer publish with `organization_id=None` (see [F-009]). That defect must be resolved (or `EventMessage.organization_id` must be derived from `project_id` inside the worker) before L2 can charge commit events to the right org.
  - **Tests**: add coverage in `test_events_utils.py` (L1 short-circuits when over quota) and `test_events_worker.py` (L2 drops events when `Counter.EVENTS_INGESTED` returns `allowed=False`). Mirror the existing TRACES_INGESTED tests as the template.
- Alternatives:
  - Treat event production as free of charge and remove `EVENTS_INGESTED` quotas from the default plans, but keep retention. Reduces operator confusion at the cost of leaving the meter inert.
  - Charge only "user-initiated" events (read events from routers) and exempt service-layer commit events, on the basis that commits are already counted indirectly via the revision write path. Requires a `count_for_meter: bool` knob on `publish_*`.
- Resolution: Closed as fixed. The working tree now implements the originally suggested L1 publish-side soft check in `core/events/utils.py::_safe_publish`, the L2 worker-side authoritative `Counter.EVENTS_INGESTED` adjustment in `EventsWorker.process_batch`, removes the stale `Flag.ACCESS` worker gate, adds `Flag.AUDIT` for event-query access, and resolves commit-event organization scope through AuthScope-first scope resolution. Remaining direct test coverage for the `Flag.AUDIT` query gate is tracked separately as F-018.
- Sources: Second `scan-codebase` pass plus in-progress resolution work.

### F-009 — [CLOSED] Service-layer commit events drop `organization_id`; read events keep it

- ID: F-009
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Files:
  - [api/oss/src/core/applications/service.py:814-821](../../../api/oss/src/core/applications/service.py#L814-L821)
  - [api/oss/src/core/queries/service.py:883-890](../../../api/oss/src/core/queries/service.py#L883-L890)
  - [api/oss/src/core/testsets/service.py:930-937](../../../api/oss/src/core/testsets/service.py#L930-L937)
  - [api/oss/src/core/evaluators/service.py:815-822](../../../api/oss/src/core/evaluators/service.py#L815-L822)
  - [api/oss/src/core/environments/service.py:989-1003](../../../api/oss/src/core/environments/service.py#L989-L1003)
  - [api/oss/src/core/events/utils.py:617-654](../../../api/oss/src/core/events/utils.py#L617-L654)
- Summary: Read emissions go through `request_scope(request)` and pass the resolved `organization_id` to `_safe_publish`. Service-layer commit emissions cannot read `request.state` and call `publish_revision_event` without `organization_id` (four services omit the kwarg entirely; `environments/service.py` passes `organization_id=None` explicitly). As a result, the Redis envelope and downstream `EventMessage` for every commit event carries `organization_id=null`, while read events of the same shape carry the real org UUID.
- Evidence:
  - Service-layer commit calls in the five listed services omit `organization_id` or passed `None` before the AuthScope follow-up.
  - Router-layer read helpers resolve scope from the request and included `organization_id` in the event envelope.
- Cause: Commit emission moved to services to avoid missed write paths, but service methods originally lacked request-bound organization scope.
- Explanation: The event wire format already had an organization slot; the asymmetry came from where the publish helper was invoked, not from the event model.
- Impact: Today the persisted `events` table is project-scoped only — see [dbes.py:10-71](../../../api/oss/src/dbs/postgres/events/dbes.py#L10-L71) — and the webhook dispatcher routes by `project_id`, so the asymmetry has no functional effect. The wire-format `EventMessage` in [streaming.py:39-45](../../../api/oss/src/core/events/streaming.py#L39-L45) carries `organization_id` but no current consumer reads it on commit events. The asymmetry becomes a real bug the moment anything (analytics, future org-level filtering, the planned `OrganizationScopeDBA` hinted at in the `# TODO` at [dbes.py:7](../../../api/oss/src/dbs/postgres/events/dbes.py#L7)) starts relying on `organization_id` for commit events.
- Suggested Fix:
  - Primary: have each commit-service method resolve `organization_id` from the project (e.g. `await projects_service.fetch(project_id=...)`) and pass it through. Adds one async lookup per commit.
  - Alternative: thread `organization_id` from the router into each commit-service signature so the service does not have to re-resolve it. Pure plumbing change; matches how `user_id` is already threaded.
  - Doc-only fallback: document the asymmetry in `core/events/utils.py` and `events.md` so subscribers do not assume commit events carry `organization_id`.
- Alternatives: Resolve organization scope from project lookup, thread it through service signatures, or rely on AuthScope propagation (the implemented follow-up path).
- Resolution: Closed as fixed by AuthScope-first scope resolution. `request_scope()` and `publish_revision_event()` now resolve scope from the ambient `AuthScope` before falling back to `request.state`, so service-layer commit emissions can populate `organization_id` without threading a request object through service signatures.
- Sources: Second `scan-codebase` pass.


### F-014 — [CLOSED] Self-host access-control docs omit the new `audit` flag

- ID: F-014
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Documentation
- Summary: The code introduced `Flag.AUDIT` and gated `POST /events/query` on it, but the operator-facing self-host docs still listed only `rbac`, `access`, `domains`, and `sso`, omitted `"audit": true` from the `self_hosted_enterprise` example, and still said “All four flags are `true`.”
- Evidence:
  - [entitlements/types.py:57-71](../../../api/ee/src/core/entitlements/types.py#L57-L71) defines `Flag.AUDIT`.
  - [events/router.py:47-60](../../../api/oss/src/apis/fastapi/events/router.py#L47-L60) gates event queries on `Flag.AUDIT`.
  - Pre-fix [04-dynamic-access-controls.mdx:83-156](../../../docs/docs/self-host/04-dynamic-access-controls.mdx#L83-L156) omitted the flag from the key list, example, and prose.
- Files:
  - [api/ee/src/core/entitlements/types.py](../../../api/ee/src/core/entitlements/types.py)
  - [api/oss/src/apis/fastapi/events/router.py](../../../api/oss/src/apis/fastapi/events/router.py)
  - [docs/docs/self-host/04-dynamic-access-controls.mdx](../../../docs/docs/self-host/04-dynamic-access-controls.mdx)
- Cause: The entitlement enum changed during the follow-up implementation, but the operator-facing dynamic access-controls guide was not updated in the same pass.
- Explanation: `audit` is part of the same env-configurable flag map as the older flags. Omitting it from the canonical self-host guide made the public configuration shape incomplete.
- Impact: Operators could not intentionally configure the new events-query entitlement surface from the canonical self-host guide, and the worked example no longer matched code defaults.
- Suggested Fix: Add `audit` to the flag-key list, the self-hosted example, and the default-shape prose.
- Alternatives: None preferred; hiding a configurable flag from the operator guide would be misleading.
- Resolution: Updated `04-dynamic-access-controls.mdx` to list `audit`, include `"audit": true` in the `self_hosted_enterprise` example, and describe the code-default shape as five enabled flags including audit-log access.
- Sources: Fresh `scan-codebase` pass on 2026-05-18.

### F-015 — [CLOSED] Adjacent access-control docs still describe `events_ingested` as retention-only and unmetered

- ID: F-015
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The branch now performs both an L1 soft check and an L2 authoritative adjust for `Counter.EVENTS_INGESTED`, but several adjacent docs still said the counter was retention-only, unmetered, and had no write path.
- Evidence:
  - [core/events/utils.py:245-321](../../../api/oss/src/core/events/utils.py#L245-L321) implements the L1 check.
  - [events/worker.py:204-273](../../../api/oss/src/tasks/asyncio/events/worker.py#L204-L273) implements the L2 meter adjustment.
  - Pre-fix docs in dynamic-access-and-billing proposal/research/tasks/summary plus the self-host guide still described the previous retention-only model.
- Files:
  - [api/oss/src/core/events/utils.py](../../../api/oss/src/core/events/utils.py)
  - [api/oss/src/tasks/asyncio/events/worker.py](../../../api/oss/src/tasks/asyncio/events/worker.py)
  - [docs/designs/dynamic-access-and-billing/proposal.md](../dynamic-access-and-billing/proposal.md)
  - [docs/designs/dynamic-access-and-billing/research.md](../dynamic-access-and-billing/research.md)
  - [docs/designs/dynamic-access-and-billing/tasks.md](../dynamic-access-and-billing/tasks.md)
  - [docs/designs/dynamic-access-and-billing/summary.md](../dynamic-access-and-billing/summary.md)
  - [docs/docs/self-host/04-dynamic-access-controls.mdx](../../../docs/docs/self-host/04-dynamic-access-controls.mdx)
- Cause: Adjacent access-control docs were authored against the earlier retention-only design and were not reconciled after this branch made `EVENTS_INGESTED` an enforced usage counter.
- Explanation: The same enum slug now carries both retention and quota semantics. Leaving the old prose in place made the adjacent docs contradict the implementation and this feature folder's summary.
- Impact: Reviewers and operators would infer that `events_ingested` cannot enforce quotas or produce usage, while the current branch does both.
- Suggested Fix: Update adjacent docs to describe `events_ingested` as an independent usage + retention counter with L1 publish-side checks and L2 worker-side adjustment.
- Alternatives: Revert the metering implementation and keep the retention-only design, but that is not the direction reflected by the current branch.
- Resolution: Updated the self-host guide plus the adjacent dynamic-access-and-billing proposal, research, tasks, and summary docs to describe the current usage + retention model.
- Sources: Fresh `scan-codebase` pass on 2026-05-18.

### F-001 — [CLOSED] Acceptance test coverage deferred for the event-emission surface

- ID: F-001
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: wontfix
- Category: Testing
- Files:
  - [docs/designs/extend-events-beyond-deployments/tasks.md:82-89](./tasks.md#L82-L89)
  - [api/oss/tests/pytest/acceptance/events/test_events_basics.py](../../../api/oss/tests/pytest/acceptance/events/test_events_basics.py)
- Summary: Eight acceptance items in `tasks.md` remain unchecked, all labelled "Deferred — requires full HTTP + redis stack." There is no end-to-end test that drives an HTTP request through the real router → publisher → worker → `events` table and asserts the event appears in `POST /events/query`.
- Evidence:
  - [tasks.md:82-89](./tasks.md#L82-L89) leaves the HTTP + Redis acceptance items unchecked and explicitly deferred.
  - [test_events_basics.py](../../../api/oss/tests/pytest/acceptance/events/test_events_basics.py) exercises query shape only, not full router → publisher → worker persistence.
- Cause: The available test harness did not yet provide the full HTTP + durable Redis fixture needed for an end-to-end emission proof.
- Explanation: Unit coverage verifies helper and service behavior, but the complete deployed pipeline remains intentionally deferred.
- Suggested Fix: Add the deferred acceptance coverage once the HTTP + Redis fixture exists.
- Alternatives: Keep the branch at unit coverage only, which was accepted for this scope.
- Sources: Initial `scan-codebase` pass.
- Disposition: Deferred by design and accepted for this branch. Unit helper coverage ([test_events_utils.py](../../../api/oss/tests/pytest/unit/events/test_events_utils.py), 30 tests) and service-layer mock coverage ([test_service_commit_emission.py](../../../api/oss/tests/pytest/unit/events/test_service_commit_emission.py), 6 tests across all five commit services) are sufficient for merge. Full acceptance coverage stays deferred until the HTTP + Redis fixture lands.

### F-002 — [CLOSED] `proposal.md` / `research.md` described the environments mount as a "gap to fix"

- ID: F-002
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Files:
  - [docs/designs/extend-events-beyond-deployments/proposal.md](./proposal.md)
  - [docs/designs/extend-events-beyond-deployments/research.md](./research.md)
  - [api/entrypoints/routers.py:977-988](../../../api/entrypoints/routers.py#L977-L988)
- Summary: Both docs still claimed the domain-style `EnvironmentsRouter` was preview-mount-only and treated that as a gap. The code mounts it at both `/environments` and `/preview/environments` from a single shared instance.
- Evidence:
  - Pre-fix proposal/research text described environments as preview-only.
  - [entrypoints/routers.py:977-988](../../../api/entrypoints/routers.py#L977-L988) mounts one shared router instance at both `/environments` and `/preview/environments`.
- Cause: The design notes were written against an earlier route-mount understanding and were not updated when the router composition changed.
- Explanation: Because both prefixes share the same handler instance, instrumentation behavior is one publish per request, not one per mount.
- Suggested Fix: Keep the docs aligned with the dual-mount implementation.
- Alternatives: None preferred.
- Sources: Initial `scan-codebase` pass.
- Resolution: Rewrote the "Environment note" block in `proposal.md` and the "Environment caveat" block in `research.md` to describe the dual mount with a single shared instance, and to record that each request emits exactly once.

### F-003 — [CLOSED] `proposal.md` showed an incorrect helper signature

- ID: F-003
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: fixed
- Category: Consistency
- Files:
  - [docs/designs/extend-events-beyond-deployments/proposal.md](./proposal.md)
  - [api/oss/src/core/events/utils.py:572-654](../../../api/oss/src/core/events/utils.py#L572-L654)
- Summary: `proposal.md` listed `publish_revision_event(domain, action, revision|revisions, ..., request=... | project_id/user_id explicit)`, which a reader could mistake for a positional call. The actual helper is keyword-only and exposes `organization_id`, `extra`, and `count` kwargs not shown in the doc.
- Evidence:
  - Pre-fix proposal text showed an incomplete/positional-looking helper signature.
  - [core/events/utils.py](../../../api/oss/src/core/events/utils.py) exposes a keyword-only helper with additional kwargs.
- Cause: The proposal signature was drafted before the final helper interface settled.
- Explanation: Incomplete signatures in design docs are easy to copy into new call sites and can obscure required scoping/extra arguments.
- Suggested Fix: Keep the proposal signature aligned with the implementation.
- Alternatives: None preferred.
- Sources: Initial `scan-codebase` pass.
- Resolution: Updated the "Emission Design" helper list in `proposal.md` to show the full keyword-only signatures of all five helpers, including `publish_revision_event`'s `organization_id`, `extra`, and `count` kwargs.

### F-004 — [CLOSED] `events.md` overview included `count` in a shape that also applies to commits

- ID: F-004
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: fixed
- Category: Consistency
- Files:
  - [docs/designs/extend-events-beyond-deployments/events.md](./events.md)
  - [api/oss/src/core/events/utils.py:521-569](../../../api/oss/src/core/events/utils.py#L521-L569)
- Summary: The "Revision Payload Pattern" overview showed `count: 1` on a generic single-revision shape. Commit events deliberately omit `count` (the helper drops it). Per-event examples elsewhere in `events.md` are correct; only the overview was ambiguous.
- Evidence:
  - Pre-fix `events.md` overview used a generic shape containing `count` for both reads and commits.
  - The helper omits `count` for commit actions.
- Cause: A read-oriented generic payload example was reused for commit events without preserving their older contract.
- Explanation: Commits intentionally follow the existing environment precedent, so the generic overview needed to distinguish action families.
- Suggested Fix: Keep commit examples separate from read/log examples.
- Alternatives: Add `count` to commit events, but that would change the existing contract.
- Sources: Initial `scan-codebase` pass.
- Resolution: Added a clarifying sentence at the top of the "Revision Payload Pattern" section noting that read events include `count` and commit events omit it (enforced by the helper), and that the generic shapes apply to read events.

### F-005 — [CLOSED] `environments.revisions.retrieved` does not include `resolution_info`

- ID: F-005
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: wontfix
- Category: Completeness
- Files:
  - [api/oss/src/apis/fastapi/environments/router.py:771-783](../../../api/oss/src/apis/fastapi/environments/router.py#L771-L783)
- Summary: `EnvironmentsRouter.retrieve_environment_revision` returns `environment_revision` and `resolution_info`. The event only carries `environment_revision` references; `resolution_info` is dropped.
- Evidence:
  - Pre-fix environment retrieve docs promised `resolution_info` in the event references.
  - The emitted helper reads only identity fields exposed by the revision DTO.
- Cause: The docs inherited response-level information that the event contract never included.
- Explanation: Event references are intentionally partial identity objects, not full response mirrors.
- Suggested Fix: Keep the docs scoped to emitted identity references.
- Alternatives: Expand the event contract to include resolution info, which was not needed for this scope.
- Sources: Initial `scan-codebase` pass.
- Disposition: Wontfix. Retrieve events stay identity-only by design — consumers that need resolved app revisions should subscribe to `environments.revisions.committed` (which already carries `state`/`diff`).

### F-006 — [CLOSED] No assertion that dual-mount domain routers do not double-emit

- ID: F-006
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: wontfix
- Category: Testing
- Files:
  - [api/entrypoints/routers.py:977-988](../../../api/entrypoints/routers.py#L977-L988)
- Summary: The exactly-once property of `/environments` + `/preview/environments` depends on both prefixes sharing one `EnvironmentsRouter` instance. No regression test enforces that invariant.
- Evidence:
  - The route composition mounts some domain routers at multiple prefixes.
  - The branch had no explicit test proving one request emits once despite shared instances.
- Cause: The dual-mount behavior is a composition-root invariant rather than a helper-local behavior, so it was easy to leave outside unit coverage.
- Explanation: The code is correct because one handler instance is shared, but a future mount refactor could accidentally duplicate emission without a guardrail.
- Suggested Fix: Add a focused guard test if this mount topology becomes less obvious or more dynamic.
- Alternatives: Retain the explanatory docs only, which was accepted for this branch.
- Sources: Initial `scan-codebase` pass.
- Disposition: Wontfix / false-positive. The single-instance pattern is held in place by the existing instantiation block in `routers.py`; the hypothetical refactor that would break it is not a real risk.

### F-007 — [CLOSED] OpenAPI / Fern client regeneration not verifiable from scan

- ID: F-007
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: low
- Status: wontfix
- Category: Consistency
- Files:
  - [docs/designs/extend-events-beyond-deployments/tasks.md:92-93](./tasks.md#L92-L93)
- Summary: Tasks marks "Update API reference docs (OpenAPI / Fern client)" as `[x]`, but a scan cannot verify the generated artifacts include the new `WebhookEventType` values.
- Evidence:
  - The original scan saw the task checked but could not yet verify regenerated OpenAPI/Fern artifacts.
  - A later pass confirmed the generated client and OpenAPI now include the new event types.
- Cause: Generated artifacts were scheduled as a finalization step after the first scan.
- Explanation: The finding was process-oriented: a source-code scan cannot assume generated outputs exist until they are present in the diff.
- Suggested Fix: Regenerate generated artifacts before merge when event enums change.
- Alternatives: None preferred.
- Sources: Initial `scan-codebase` pass plus second scan verification.
- Disposition: Wontfix at scan time. Owner will regenerate Fern clients and API references as the final step before merge. (This second scan pass confirmed `openapi.json` and `WebhookEventType.ts` were regenerated and include all 29 new event types — see the parent PR diff.)
