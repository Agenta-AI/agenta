# Status

## Current state

Implementation approved on 2026-09-04 for the reduced cleanup in [plan.md](./plan.md).
PR: #6365. Target: `release/v0.114.4`.

The design now builds on the gateway-guidance separation already in the release.
Instruction digests, database changes, new restart rules, and new harness delivery
mechanisms are out of scope.

## Progress

- Design updated to the approved scope.
- SDK and runner implementation pending.
- Independent review and focused tests/live QA pending.

## Workspace

Implementation uses an isolated source copy of release commit
`76f7b0b6f0795c2e792ab4a4403e3e01303f228c`. The shared checkout contains unrelated
website conflicts. Publication must preserve those files and the shared index.
