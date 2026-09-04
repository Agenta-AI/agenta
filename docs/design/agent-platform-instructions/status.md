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
  differs from the release snapshot. The subsequent locked SDK CI suite also passed.
- Runner unit suite: 2,617 passed. TypeScript checks passed. Runner dependency lock
  matches the existing installed development dependencies.
- Documentation production build passed. Changed runner files formatted with the
  repository's installed Prettier.
- Locked CI passed SDK, API, services, and runner unit suites, plus runner integration
  and acceptance suites, at implementation commit `cff860e45e`.
- Pi live QA passed on the changed SDK and runner: fresh author instructions,
  unchanged continuation, edited author instructions, and a fresh control. No stream
  errors or silent turns occurred. Runner logs confirmed warm reuse for the unchanged
  turn and a rebuild for the author edit. Session: `1ce65cf6-32e9-47d1-be68-fd3b9fe0d287`.
- Claude, Codex, and gateway live QA remain unverified because existing test keys were
  rejected by the available deployments. Automatic approval review blocked copying
  provider keys into a new test vault without explicit permission. No keys were copied.
- The two isolated QA containers were stopped and removed, and three QA workflows
  were archived. The empty ephemeral account/project remains because the existing
  account fixture has no teardown. Existing deployments were not changed.

## Workspace

Implementation uses an isolated source copy of release commit
`76f7b0b6f0795c2e792ab4a4403e3e01303f228c`. The shared checkout contains unrelated
website conflicts. Publication must preserve those files and the shared index.
