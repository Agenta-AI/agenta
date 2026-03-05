# Plan

## Phase 0 - Stabilize OSS Deployment Smoke (Immediate)

Milestones:

1. Lock a minimal OSS smoke profile (single test + optional app creation test).
2. Enforce clear environment contract for deployment runs.
3. Keep workers at 1 and retries low (1) for deterministic signal.

Exit criteria:

- Smoke profile passes >= 95% across repeated runs on deployment.

## Phase 1 - Structural Fixes (High Priority)

Milestones:

1. Normalize EE wrapper imports to stable, resolvable paths.
2. Align runner docs with actual runner behavior.
3. Harden auth setup flow branches and failure messages.
4. Rename `testsset` to `testset` with compatibility migration.

Exit criteria:

- OSS and EE suites both list and execute in CI dry-runs.

## Phase 2 - Flake Reduction (Medium Priority)

Milestones:

1. Remove randomness in assertions and identifiers where possible.
2. Replace first-item assumptions with deterministic selection.
3. Normalize tags (`scope`, `coverage`, `path`) for reliable filtering.

Exit criteria:

- Core OSS subset (smoke + app + playground) has stable pass trend.

## Phase 3 - Production Rollout

Milestones:

1. Add OSS smoke subset as deployment gate (required).
2. Run broader OSS acceptance nightly (non-blocking initially).
3. Promote selected broader suite to required checks after stability window.

Exit criteria:

- Deployment gate is green and trusted.
- No critical regressions missed by smoke profile for 2 weeks.
