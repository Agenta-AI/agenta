# Status

Date: 2026-08-10

## Current phase

Implementation, review, and verification are complete. The stack is ready for final review. See
the closing update at the end of this file.

## Completed

- Reviewed PR #5767 backend changes.
- Mapped the v0.112 frontend PR stack.
- Recorded the public interface and storage recommendations.
- Confirmed product behavior for names, row actions, delivery history, kinds, sessions, previews,
  and origin defaults.
- Confirmed no session meta use.
- Confirmed no data backfill is required before production.
- Created the implementation plan.
- Retargeted GitButler to `origin/release/v0.112.0`.
- Pulled release commit `965851e15d` and removed the old `main` target from the applied workspace.
- Pulled nine later release commits after implementation; the final target is `4af155162b`.
- Verified no implementation stack is applied and unrelated local changes remain untouched.
- Verified the existing standalone EE development deployment for this checkout (see the
  `debug-local-deployment` skill for how to reach it).
- Implemented atomic delivery claim and session attribution with one linked delivery/session ID.
- Implemented typed session queries, response expansions, windowing, and generated TypeScript and
  Python clients.
- Implemented trigger soft deletion, retained history, and live-only normal lists and mutations.
- Implemented authenticated exact-by-ID schedule and subscription reads that include soft-deleted
  configurations as read-only.
- Implemented typed frontend origin policies, row actions, and exact-only delivery mode.
- Implemented reserved-tag sanitization so public tags contain only user-visible keys.
- Verified a scheduled run with linked delivery and session IDs.
- Verified an authenticated canonical session query with the current trigger name and kind, typed
  delivery, terminal windowing, and only user tags.
- Verified exact delivery retrieval with the linked session and result.

## Implementation start state

Recorded start state:

- Current branch: `gitbutler/workspace`.
- GitButler target: `origin/release/v0.112.0` at `4af155162b`.
- Target version: v0.112 release branch.
- Applied stacks: none.
- Existing unrelated uncommitted changes: present and untouched.
- Deployment: the standalone EE development deployment, with this checkout bind-mounted into API,
  workers, web, generated clients, and frontend packages.
- Database: the deployment's stack Postgres container.

The implementation is being packaged as the stacked review set described in `implementation.md`.

## Verification

- 565 non-integration session and trigger API tests passed after the final release pull.
- Eight core Postgres claim and history tests passed in the deployed container.
- Phase 5 trigger join, cursor, and origin Postgres tests passed in the deployed container.
- Three generated Python client tests passed.
- Frontend builds, type checks, lint, and relevant package suites passed.
- Schedule live acceptance passed.
- Final reviews found no P0 or P1 findings.
- Restored the EE development web service after bind-mounted host-owned package outputs blocked
  the container's UID from completing dependency preparation.

## Later verification (2026-08-11)

- Browser QA ran in a browser environment with working sandbox support. Eight of ten checklist
  items passed. The permission-restricted step is blocked pending a deployment configured with a
  custom access role; the mobile-width step is blocked by a pre-existing desktop-only dashboard
  gate, unrelated to this change.
- Subscription live acceptance ran twice against a real provider event, producing one delivery and
  one session with `kind: subscription` each time, correct typed attribution, and no `ag.*` tag
  leakage.
- The representative benchmark ran at 10,000 sessions and 200,000 records. No index is required at
  this volume. Human-surface queries measured 15 to 19 ms p50; automation-surface queries measured
  24 to 25 ms p50. An optional partial index for automation-heavy queries at larger volume is
  documented as a follow-up option, not a requirement for this release.

## Known limitation: connection deletion and history

Hard deletion of a gateway connection cascades through its subscriptions' tombstones and delivery
history; history for a subscription survives only while its connection exists. This is accepted
product behavior for this release. The docs are corrected to state this bound; no follow-up code
change is planned.

## Decisions remaining

Generic tags, work status, usage, cost, and models remain separately scoped future work.

## Closing update — 2026-08-11

Implementation, review, and fix waves are complete. The stack is ready for final review: PR #5929
(API attribution, lifecycle, query, expansion, sanitization), PR #5928 (generated Python and
TypeScript clients), PR #5927 (frontend entity contracts, list policies, row models, actions,
drawers), and PR #5926 (this design record). PR #5930 (subscription reference validation fix) and
PR #5931 (schedule cron per-row error isolation) merged separately during the same effort.

Follow-up issues filed for out-of-scope findings: #5933 (unbounded reconciliation fetch), #5934
(delivery-upsert builder dedup), and #5935 (worker UUID guards).
