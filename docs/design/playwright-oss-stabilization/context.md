# Context

## Problem Statement

Frontend Playwright tests were failing against deployed OSS environments due to:

- Direct URL navigation to workspace-scoped routes returning 404.
- Playground direct URL rendering blank content (frontend client-side state bug).
- Settings content hydrating after the shell renders, which caused early interactions to be lost.
- Settings page remounting during org and project hydration, which made some clicks flaky in CI.
- Stale locators not matching actual UI (div-based table rows, changed placeholders, role mismatches).
- API response interception race conditions (listeners set up after triggers).
- Tests failing hard when expected data didn't exist (testsets).
- Shared local Playwright runs competing over one `test-project.json` file and default-project switching.

This blocked confidence when validating fixes on real deployments.

## What Was Done

The suite moved forward, but it is not fully done:

1. Replaced the broken unscoped Settings path with the project-scoped route.
2. Added readiness checks for Settings Models so the fixture waits for content, not just the shell.
3. Fixed Playground navigation to go through Overview and then the app sidebar.
4. Added a generic test-provider fixture with a working `mock` profile for the UI path.
5. Fixed API interception timing and other locator issues from the earlier stabilization pass.
6. Confirmed that Playground now reaches real execution with `mock/custom/gpt-6`.
7. Identified the remaining blocker. Runtime still rejects the custom mock model as missing credentials.

## Goals

1. Maintain reliable OSS acceptance suite against deployed environments.
2. Integrate as CI deployment gate.
3. Expand coverage with BDD-driven test development.
4. Keep current auth-by-UI design, hardened with explicit mode selection.
5. Keep the suite honest about the current runtime blocker instead of hiding it with UI-only success.

## Non-Goals

- Rewriting all tests to API-seeded auth.
- Large-scale test framework replacement.
- Fixing the playground direct URL frontend bug (tracked separately).

## Constraints

- Must run against live deployments (not only localhost).
- Must support OSS and EE trees without breaking current workflows.
- Local verification is only trustworthy when runs stay serial. Parallel invocations still share setup state.
