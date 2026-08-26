# Status

**Date:** 2026-08-26
**State:** planning complete, plan reviewed by Codex, 33 findings addressed

The three design documents are decided. The plan, the contracts, the research, the test
specification, and the release gate proposal are written. No product code has changed.

Codex reviewed the workspace at high reasoning effort and returned 33 findings: 14 at P1, 15
at P2, and 4 at P3. All 33 are applied. The changes that moved the plan most:

- Slice 2 now owns one cached, fully paginated catalog helper. The earlier plan reused a
  cache that cannot be reused, because it lives in the HTTP router and is keyed per page.
- Migration moved out of Python entirely. The frontend owns it, in TypeScript, in Slice 6.
- Slice 4 now lands the passive TypeScript field before the Python emitter, so no
  intermediate commit breaks the runner's compile-time key guard.
- Slice 5 grew three obligations the earlier plan missed: the relay path must be able to
  pause and create a Sessions interaction, the operator switch must be read at decision time
  in a path every tool family shares, and `gateway.run` error suggestions must be sanitized.
- Both runtime tools carry `permission: "allow"` to open the coarse harness gate. Without it
  a compiled `allow` would still raise a card named `run_tool`.
- The user interface handoff is copied into this workspace, so the specification is versioned
  on this branch instead of living in another checkout.

## Slices

Each slice names the [qa.md](qa.md) test IDs it implements. It does not restate them.

| Slice | Name | Test IDs | State |
| --- | --- | --- | --- |
| 1 | SDK configuration model and permission compiler | C1 to C26, C28 to C30, C34 | not started |
| 2 | API catalog tool identity and connection resolve | A19, G11 (API half) | not started |
| 3 | API gateway search and run routes | A1 to A5, A7 to A18, A20 to A23 | not started |
| 4 | SDK gateway resolver, resolved policy, prompt guidance | C27, G6, G11 | not started |
| 5 | Runner policy gate, search filtering, approval | A6, R1 to R30, N1 to N11 | not started |
| 6 | Frontend integration rows and permission drawer | C31 to C33, F1 to F17, G5 | not started |
| 7 | End-to-end wiring and local deployment check | the live journey, W1 to W6, G1 to G12, N12 to N14 | not started |

Slice 6 splits. Its pure parts need only Slice 1 and can start at once. Its client
regeneration needs Slice 3, because the generator rebuilds the client from a running API.

Do not deploy the mid-branch state. Slices 4 and 5 ship together in one pull request, which is
the atomic-landing option [plan.md](plan.md) allows in place of a flag on the two derived
tools: Slice 4 alone hands the model a `run_tool` that reaches the provider with no policy
applied, because the gate that reads the policy is Slice 5. Nothing deploys from an
intermediate commit, so the two slices carry no feature flag.

## Decisions taken during review

All six former open questions are resolved and recorded in [plan.md](plan.md). One external
sign-off is still outstanding.

| Decision | Blocks | State |
| --- | --- | --- |
| 1. "Ask for write and delete" saves `inherit`, with a line shown when the agent mode differs | Slice 6 | adopted |
| 2. A fourth per-tool option, "Follow agent policy" | Slice 6 | adopted, **needs design sign-off before Slice 6 starts** |
| 3. An agent may hold both entry formats, and each surface keeps its own rule | Slice 4 | adopted, tested by G12 |
| 4. The provider search takes a native toolkit filter | Slice 3 | resolved by measurement on 2026-08-26 |
| 5. Catalog latency is served by the new Slice 2 helper | Slice 2, Slice 7 | resolved |
| 6. Result transformation applies to `gateway.search` alone | Slice 5 | resolved |

Decision 2 is the only item that needs a person outside this workspace. It departs from the
handoff, and the per-tool select is built once, so get the sign-off before Slice 6 begins.

## Branch

`feat/gateway-connection-rework`, based on `origin/main`.

The two superseded pull requests stay open for reference. This work does not build on them.

## Log

- 2026-08-26. Codex reviewed the workspace. Applied all 33 findings across `plan.md`,
  `contracts.md`, `qa.md`, `research.md`, and `release-gate-changes.md`. Resolved the six
  open questions. Copied the user interface handoff into the workspace as
  [ui-handoff.md](ui-handoff.md) and [ui-handoff-board.html](ui-handoff-board.html). Added
  test cases R8b, R29, R30, F16, F17, and G12, and moved A6 from the API to the runner.
  Corrected two stale code claims in `research.md`.
- 2026-08-26. Wrote [qa.md](qa.md) and [release-gate-changes.md](release-gate-changes.md).
- 2026-08-26. Read the three design documents and the user interface handoff. Researched the
  SDK, the API, the runner, and the frontend. Wrote the plan, the contracts, and the
  research. Recorded six open questions and eight conflicts between the design and the
  current code. `qa.md` was written in parallel by another workstream and reached the same
  preset mapping independently, which is recorded as F2 there and as section 10 in
  [contracts.md](contracts.md).
