# Context

## Problem Statement

Frontend Playwright tests were failing against deployed OSS environments due to:

- Direct URL navigation to workspace-scoped routes returning 404.
- Playground direct URL rendering blank content (frontend client-side state bug).
- Stale locators not matching actual UI (div-based table rows, changed placeholders, role mismatches).
- API response interception race conditions (listeners set up after triggers).
- Tests failing hard when expected data didn't exist (testsets).

This blocked confidence when validating fixes on real deployments.

## What Was Done

All 12 OSS acceptance tests were stabilized (10 pass, 2 skip gracefully):

1. Replaced all direct URL navigation with sidebar-based navigation.
2. Fixed playground navigation to go through Overview → Playground sidebar click.
3. Updated all locators to match actual UI (search box, `getByText`, `menuitem` roles).
4. Fixed API interception timing (listeners before triggers).
5. Added graceful skips for missing data (testsets).
6. Created BDD feature specs in Gherkin format.

## Goals

1. Maintain reliable OSS acceptance suite against deployed environments.
2. Integrate as CI deployment gate.
3. Expand coverage with BDD-driven test development.
4. Keep current auth-by-UI design, hardened with explicit mode selection.

## Non-Goals

- Rewriting all tests to API-seeded auth.
- Large-scale test framework replacement.
- Fixing the playground direct URL frontend bug (tracked separately).

## Constraints

- Must run against live deployments (not only localhost).
- Must support OSS and EE trees without breaking current workflows.
- `AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN` defaults to `false` on shared environments.
