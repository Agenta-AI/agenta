# Shared Findings Schema

Use one canonical findings shape so scan, test, sync, triage, and resolve can hand work off cleanly.

## Master Documents

- Master findings document: `findings.md`

Each master findings document should be split into:

- optional `## Rules`
- optional `## Notes`
- optional `## Open Questions`
- `## Open Findings`
- `## Closed Findings`

Move findings between those sections whenever their status changes. Do not leave closed findings in the open section or open findings in the closed section.

Preferred document order:

1. title and sync metadata
2. sources and summary sections
3. any non-findings sections, for example `## Rules`, `## Notes`, and `## Open Questions`
4. `## Open Findings`
5. `## Closed Findings`

Keep all non-findings sections above `Open Findings` so context, policy, and unanswered questions are visible before the finding list.

Optional supporting documents:

- `findings.status.md`
- task-specific status docs when the findings list is large or thread tracking becomes noisy

## Core Fields

Every finding should include these fields when they are known:

- `ID`
- `Origin`
- `Lens`
- `Severity`
- `Confidence`
- `Status`
- `Category` or `Area`
- `Summary`
- `Evidence`
- `Files`
- `Cause`
- `Explanation`
- `Suggested Fix`
- `Alternatives`
- `Sources`

Each finding title should also carry a quick visual state prefix:

- `[OPEN]` for `candidate`, `open`, `confirmed`, `reproduced`, `needs-user-decision`, `in-progress`, `blocked`, `process`, or `migration`
- `[CLOSED]` for `fixed`, `stale`, or `wontfix`

## Origin

Use `Origin` to say where the finding came from:

- `scan`
- `test`
- `sync`
- `user`
- `mixed`

## Lens

Use `Lens` when it adds clarity:

- `verification`
- `validation`
- `mixed`

## Scan-Oriented Fields

For scan-driven findings, prefer:

- `Category`
- `Impact`
- `Activation Condition` for latent bugs

Common categories:

- `Correctness`
- `Consistency`
- `Completeness`
- `Soundness`
- `Functionality`
- `Security`
- `Performance`
- `Compatibility`
- `Migration`
- `Testing`

## Test-Oriented Fields

For test-driven findings, prefer:

- `Area`
- `Preconditions`
- `Steps`
- `Expected`
- `Observed`
- `Environment`

## Severity

Use one consistent severity scheme per document. Preferred scheme:

- `P0`: blocker, merge- or release-stopping
- `P1`: high severity, should be fixed before merge or rollout
- `P2`: medium severity, real issue with bounded risk
- `P3`: low severity, low-risk or hygiene issue

If a document already uses `High`, `Medium`, `Low`, normalize only if doing so improves clarity.

## Confidence

- `high`: directly confirmed by current code, tests, or repro
- `medium`: strong evidence, but not fully reproduced end-to-end
- `low`: plausible lead that still needs confirmation

## Status

Use statuses that reflect lifecycle, not emotion:

- `candidate`
- `open`
- `confirmed`
- `reproduced`
- `needs-user-decision`
- `in-progress`
- `fixed`
- `stale`
- `wontfix`
- `blocked`
- `process`
- `migration`

## Suggested Fix

The suggested-fix section should be action-oriented and may include:

- primary fix path
- alternative fix paths
- tests to add
- docs or rollout updates needed

If the right action is unclear, say so and move the finding to `needs-user-decision`.
