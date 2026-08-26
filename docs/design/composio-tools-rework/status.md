# Status

**Date:** 2026-08-26
**State:** planning complete

The three design documents are decided. The plan, the contracts, the research, the test
specification, and the release gate proposal are written. No product code has changed.

## Slices

Each slice names the [qa.md](qa.md) test IDs it implements. It does not restate them.

| Slice | Name | Test IDs | State |
| --- | --- | --- | --- |
| 1 | SDK configuration model and permission compiler | C1 to C34 | not started |
| 2 | API catalog tool identity and connection resolve | A19, part of A23 | not started |
| 3 | API gateway search and run routes | A1 to A18, A20 to A23 | not started |
| 4 | SDK gateway resolver, resolved policy, prompt guidance | C27, G6, G11 | not started |
| 5 | Runner policy gate, search filtering, approval | R1 to R28, N1 to N11 | not started |
| 6 | Frontend integration rows and permission drawer | F1 to F15, G5 | not started |
| 7 | End-to-end wiring and local deployment check | the live journey, W1 to W6, G1 to G11, N12 to N14 | not started |

Slice 6 needs only the saved format from Slice 1. It can run beside slices 2 to 5.

## Open questions

Six are recorded in [plan.md](plan.md), each with a recommendation. Two need an answer before
the slice that depends on them starts.

| Question | Blocks | State |
| --- | --- | --- |
| 1. What "Ask for write and delete" means when the agent-wide mode changes | Slice 6 | open |
| 2. How the drawer shows a tool set to `inherit` | Slice 6 | open, needs design sign-off |
| 3. Whether an agent may hold both entry formats at once | Slice 4 | open, recommendation is to allow it |
| 4. Whether the provider search accepts a toolkit filter | Slice 3 | open, Slice 3 checks it |
| 5. Latency of the catalog slice at run start | Slice 7 | open, Slice 7 measures it |
| 6. Scope of the new result-processing step | Slice 5 | open, recommendation is to keep it narrow |

## Branch

`feat/gateway-connection-rework`, based on `origin/main`.

The two superseded pull requests stay open for reference. This work does not build on them.

## Log

- 2026-08-26. Wrote [qa.md](qa.md) and [release-gate-changes.md](release-gate-changes.md).
- 2026-08-26. Read the three design documents and the user interface handoff. Researched the
  SDK, the API, the runner, and the frontend. Wrote the plan, the contracts, and the
  research. Recorded six open questions and eight conflicts between the design and the
  current code. `qa.md` was written in parallel by another workstream and reached the same
  preset mapping independently, which is recorded as F2 there and as section 10 in
  [contracts.md](contracts.md).
