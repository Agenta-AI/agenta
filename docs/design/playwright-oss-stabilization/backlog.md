# Backlog

## P0 (Must-fix before broad rollout)

1. Fix EE wrapper imports that reference OSS Playwright modules through brittle paths.
2. Reconcile runner documentation with actual `run-tests.ts` behavior.
3. Make auth setup branching explicit and improve diagnostics in `global-setup.ts`.
4. Add explicit safety guard for destructive teardown paths.

## P1 (Stability and maintainability)

1. Standardize naming from `testsset` -> `testset`.
2. Normalize tag usage for filtering precision.
3. Remove flaky random input patterns and first-item assumptions.
4. Unskip or clearly quarantine API keys suite with rationale.

## P2 (Cleanup and optimization)

1. Remove dead/unused fixtures and stale docs sections.
2. Add explicit smoke profile aliases to `web/tests/package.json` scripts.
3. Track pass-rate trend for each domain and tighten retries over time.
