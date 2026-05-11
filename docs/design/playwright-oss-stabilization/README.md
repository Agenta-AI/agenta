# Playwright OSS Stabilization

Tracks the stabilization of frontend Playwright tests for OSS deployed environments and their integration into CI.

## Current State

The branch improves the OSS Playwright harness, but the suite is not fully stabilized yet.

- The two reviewed harness regressions are now fixed on this branch: Playground now starts its response wait before clicking Run, and cached-auth setup now recreates the ephemeral project with stored auth.
- Several specs are still skipped or conditionally skipped, so the suite should not be described as "10 pass, 2 skip" right now.
- The latest CI run on this branch reported `5 passed`, `4 skipped`, `1 failed`, and `2 flaky`.
- The design docs in this folder track the real pass/skip state instead of the earlier optimistic claim.

## Files

- `context.md` - Problem statement, what was done, goals, and constraints.
- `research.md` - Test architecture, suite inventory, and key patterns discovered.
- `plan.md` - Execution phases and next steps.
- `status.md` - Test results, how to run, known issues, and key patterns.
- `qa.md` - QA profile, environment contract, and coverage map.
- `backlog.md` - Remaining work items (P1/P2).

## Quick Links

- OSS acceptance specs: `web/oss/tests/playwright/acceptance/`
- BDD feature specs: `web/oss/tests/playwright/acceptance/features/`
- Playwright config: `web/tests/playwright.config.ts`
- Run instructions: see `status.md`
