# Status

## Current state

Implementation approved on 2026-09-04 for the reduced cleanup in [plan.md](./plan.md).
PR: #6365. Target: `release/v0.114.4`.

The design now builds on the gateway-guidance separation already in the release.
Instruction digests, database changes, new restart rules, and new harness delivery
mechanisms are out of scope.

## Progress

- Design updated to the approved scope.
- SDK and runner implementation complete. The SDK sends the shared string; the
  runner retains existing delivery and accepts the legacy input during rollout.
- Independent correctness and maintainability reviews found no blocking issues.
- SDK adapter/wire checks: 110 passed. Full SDK agent unit suite: 1,194 passed,
  4 skipped. These ran with the existing development virtual environment; its lock
  differs from the release snapshot, so this is not locked-environment validation.
- Runner unit suite: 2,617 passed. TypeScript checks passed. Runner dependency lock
  matches the existing installed development dependencies.
- Documentation production build passed. Changed runner files formatted with the
  repository's installed Prettier.
- Focused live QA in progress in isolated runner/service containers. Both processes
  load the changed source. Existing managed-provider test keys were rejected by the
  available test deployments; a Pi subscription check is being attempted.

## Workspace

Implementation uses an isolated source copy of release commit
`76f7b0b6f0795c2e792ab4a4403e3e01303f228c`. The shared checkout contains unrelated
website conflicts. Publication must preserve those files and the shared index.
