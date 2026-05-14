# Extend Events Beyond Deployments — Findings

## Sources

- Branch: `feat/extend-events-beyond-deployments`
- Base: `main`
- Path: `docs/designs/extend-events-beyond-deployments/`
- Scope: fresh scan of code, docs, routes, and tests against the proposal/events/gap/research/tasks docs.

## Summary

The implementation closely matches the design. New event types are present in both [EventType](../../../api/oss/src/core/events/types.py) and [WebhookEventType](../../../api/oss/src/core/webhooks/types.py). Shared helpers in [core/events/utils.py](../../../api/oss/src/core/events/utils.py) are correctly used: reads emit at router boundaries, commits emit at service boundaries. All eight in-scope router classes have the expected emission call sites, and all five service-layer commit methods emit exactly once per call. No stray emissions in the workflows surface. Unit-test coverage is dense (30 helper tests + 6 service-layer commit tests across all five domains).

First scan produced 7 findings, all `P2`–`P3`. After triage:

- **F-002 / F-003 / F-004** closed — docs updated to match the code.
- **F-001 / F-005 / F-006 / F-007** closed as `wontfix` — see each finding for the reason.

No P0/P1 correctness issues observed.

## Rules

- Read emission lives at the router. Write emission lives at the service. See [core/events/utils.py:10-90](../../../api/oss/src/core/events/utils.py).
- `TracingRouter` and `SpansRouter` must **not** emit; `TracesRouter` is the only trace-event source.
- Workflow revision events stay out of scope until workflows are confirmed durable.
- All new event types are webhook-subscribable.

## Notes

- This scan is verification-only. No runtime tests were executed.

## Open Questions

- None.

## Open Findings

_None — all findings from this scan pass have been triaged and closed._

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
- **Disposition:** Wontfix at scan time. Owner will regenerate Fern clients and API references as the final step before merge.
