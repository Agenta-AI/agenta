# Backlog

## Completed

1. ~~Fix all OSS acceptance tests against deployed environment~~ (10 pass, 2 skip)
2. ~~Replace direct URL navigation with sidebar navigation in all tests~~
3. ~~Fix API response interception race conditions~~
4. ~~Add graceful skip for testset test when no testsets exist~~
5. ~~Add BDD feature specs in Gherkin format~~
6. ~~Add explicit safety guard for destructive teardown paths (`AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN`)~~
7. ~~Harden auth setup with explicit mode selection (auto/password/otp)~~

## P1 (Stability and maintainability)

1. Rename `testsset` folder to `testset` (requires updating EE wrapper imports).
2. Normalize tag usage across suites for reliable filtered runs.
3. Unskip or clearly document API keys test with rationale for what setup it needs.
4. Fix playground direct URL blank content (frontend bug, not test issue).

## P2 (CI integration)

1. Add CI workflow running full acceptance suite on every PR.
2. Add `test:smoke` and `test:acceptance` script aliases in `web/tests/package.json`.
3. Create ephemeral project per CI run (global-setup creates via `POST /api/projects`, global-teardown deletes via `DELETE /api/projects/{id}`) to prevent data accumulation from repeated runs.
4. Make the workflow a required check after stability window.

## P3 (Test independence and parallelization)

1. Make each test domain self-sufficient — create own prerequisites via API instead of depending on prior test side effects (e.g., playground should create its own app, not rely on app creation test).
2. Structure CI so domain jobs can run in parallel, each in its own ephemeral project.
3. Current dependency chain to break: app creation → playground (produces traces) → observability (reads traces).

## P4 (Coverage expansion)

1. Add regression test for playground variable rename payload behavior.
2. Add testset CRUD tests (create, edit, delete).
3. Normalize EE wrapper import paths for shared test reuse.
4. Track pass-rate trend per domain.
