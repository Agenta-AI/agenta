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

## P2 (CI integration and coverage)

1. Define CI job for OSS deployment smoke profile (gate on deployment).
2. Add smoke profile aliases to `web/tests/package.json` scripts.
3. Run broader OSS acceptance suite nightly (non-blocking initially).
4. Add regression test for playground variable rename payload behavior.
5. Track pass-rate trend per domain and tighten retries over time.
6. Normalize EE wrapper import paths for OSS test reuse.
