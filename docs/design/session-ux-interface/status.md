# Status

Date: 2026-08-10

## Current phase

Implementation complete. Residual verification and one deferred history-retention risk remain.

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
- Verified the existing standalone EE deployment for this checkout at
  `http://144.76.237.122:8280`.
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
- Deployment: `agenta-ee-dev-wp-b2-rendering` on port 8280, with this checkout bind-mounted into
  API, workers, web, generated clients, and frontend packages.
- Database: `agenta_ee_core` on the stack Postgres container, published on port 5434.

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

## Residual verification

- Browser QA did not run because host Chromium sandboxing is disabled. The run did not bypass the
  sandbox with `--no-sandbox`.
- Subscription live acceptance did not run because `COMPOSIO_TEST_CONNECTED_ACCOUNT` was missing.
- The representative benchmark with 10,000 sessions and 200,000 records did not run. No index was
  added, and no representative performance claim is made.

## Deferred risk

Hard deletion of a gateway connection can still cascade through subscription and delivery history.
This path is outside direct automation deletion and remains deferred.

## Decisions remaining

Generic tags, work status, usage, cost, and models remain separately scoped future work.
