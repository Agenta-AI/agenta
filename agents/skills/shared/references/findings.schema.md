# Shared Findings Schema

Use one canonical findings shape across CR and QA so scan, curate, and resolve can hand work off cleanly.

## Master Documents

- Verification findings live in `CR.findings.md`
- Validation findings live in `QA.findings.md`

Optional supporting documents:

- `CR.status.md`
- `QA.status.md`

Use status docs when the findings list is large or when thread-level tracking becomes noisy.

## Core Fields

Every finding should include these fields when they are known:

- `ID`
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

## CR-Oriented Fields

For verification findings, prefer:

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

## QA-Oriented Fields

For validation findings, prefer:

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
- `needs-user-decision`
- `in-progress`
- `fixed`
- `stale`
- `wontfix`
- `blocked`
- `process`
- `migration`

For QA, `reproduced` may be used in place of `confirmed` when scenario replay matters.

## Suggested Fix

The suggested-fix section should be action-oriented and may include:

- primary fix path
- alternative fix paths
- tests to add
- docs or rollout updates needed

If the right action is unclear, say so and move the finding to `needs-user-decision`.
