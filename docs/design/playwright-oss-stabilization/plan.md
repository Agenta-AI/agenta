# Plan

## Phase 0 - Stabilize OSS Deployment Smoke -- COMPLETE

All 12 OSS acceptance tests stabilized (10 pass, 2 skip gracefully).

What was done:
1. Fixed all tests to use sidebar navigation instead of direct URL navigation.
2. Fixed API response interception race conditions.
3. Fixed locator mismatches (div-based rows, placeholder text, role selectors).
4. Added graceful skip for testset test when no data exists.
5. Added BDD feature specs in Gherkin format.

## Phase 1 - Structural Cleanup (Next)

Milestones:
1. Rename `testsset` folder to `testset` with EE wrapper import updates.
2. Normalize tag usage (`scope`, `coverage`, `path`) for reliable filtering.
3. Resolve API keys test: either unskip with proper setup or document why it stays skipped.
4. Fix playground direct URL blank content bug in the frontend.

Exit criteria:
- Folder names and tags are consistent across OSS and EE suites.

## Phase 2 - CI Integration

Run all Playwright tests on every PR (not just smoke). The suite is fast (~3.5 min) and has no monetary cost, so there's no reason to defer tests to nightly. Catching breakages at PR time is cheaper than discovering them on a release branch.

Milestones:
1. Add CI workflow that runs the full OSS acceptance suite on every PR.
2. Add `test:smoke` and `test:acceptance` script aliases in `web/tests/package.json`.
3. Create ephemeral project per CI run in global-setup, delete in global-teardown. This avoids data accumulation from repeated runs against the same environment (apps, variants, traces pile up otherwise).
4. Make the workflow a required check after a stability window.

Exit criteria:
- Full acceptance suite runs on every PR and is green.
- Repeated runs against the same environment don't leave stale data.

## Phase 3 - Test Independence and Parallelization

Currently tests run sequentially because of a dependency chain: app creation → playground (produces traces) → observability (reads traces). To enable future parallelization:

Milestones:
1. Make each test domain self-sufficient: each domain should be able to create its own prerequisites via API rather than depending on a previous test's side effects.
2. Structure CI so parallelization is a config change (separate jobs per domain), not a test rewrite.
3. When parallelizing, each job creates its own project via `POST /api/projects` for full isolation.

Design constraints:
- OSS allows only one organization. Projects are unlimited within the workspace and almost everything (apps, variants, testsets, traces, deployments) is scoped to `project_id`.
- The first run against a fresh env needs account creation (org/workspace/project). Subsequent runs reuse the same account. Global-setup already handles sign-up vs sign-in detection.
- Project creation/deletion is available via API (`POST /api/projects`, `DELETE /api/projects/{id}`), so ephemeral projects are straightforward.

Exit criteria:
- Any test domain can run independently in its own project.
- CI jobs can be split by domain without test code changes.

## Phase 4 - Coverage Expansion

Milestones:
1. Add regression test for playground variable rename payload behavior.
2. Add testset CRUD tests (create, edit, delete).
3. Normalize EE wrapper imports for shared test reuse.
4. Track pass-rate trend per domain.

Exit criteria:
- Core OSS subset has stable pass trend across 1 month of runs.
