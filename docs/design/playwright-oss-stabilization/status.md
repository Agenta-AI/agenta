# Status

## Current State

- OSS deployment smoke test is runnable against live URL using `AGENTA_LICENSE=oss` and `AGENTA_WEB_URL`.
- Playwright runner/setup received stability fixes (arg parsing, default URL behavior, setup/teardown robustness).
- Frontend suite structure and gaps reviewed.

## Open Risks

1. EE wrapper import paths for OSS test reuse require normalization.
2. Some acceptance specs remain flaky due to nondeterministic data assumptions.
3. Tag semantics are inconsistent, reducing filter accuracy.

## Decisions

- Keep current auth-via-UI design for now.
- Prioritize OSS deployment subset as production gate before broad-suite enforcement.
- Use phased rollout (gate small first, expand later).

## Next Actions

1. Land P0 structural fixes.
2. Define CI job for OSS deployment smoke profile.
3. Add regression test for playground variable rename payload behavior.
