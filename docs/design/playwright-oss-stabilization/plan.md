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

Milestones:
1. Add OSS smoke subset as deployment gate (required check).
2. Add `test:smoke` and `test:acceptance` script aliases in `web/tests/package.json`.
3. Run broader OSS acceptance nightly (non-blocking initially).
4. Promote to required check after 2-week stability window.

Exit criteria:
- Deployment gate is green and trusted.
- No critical regressions missed by smoke profile for 2 weeks.

## Phase 3 - Coverage Expansion

Milestones:
1. Add regression test for playground variable rename payload behavior.
2. Add testset CRUD tests (create, edit, delete).
3. Normalize EE wrapper imports for shared test reuse.
4. Track pass-rate trend per domain.

Exit criteria:
- Core OSS subset has stable pass trend across 1 month of nightly runs.
