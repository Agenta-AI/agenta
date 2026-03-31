---
name: qa-resolve-findings
description: Resolve validation-oriented QA findings for a feature or release candidate. Accept optional `path` and a `priority` selector; by default resolve only the next highest remaining priority bucket, in order `P0`, `P1`, `P2`, `P3`. Also accept explicit levels or `all`. Default to `path=infer`. Confirm effective variables before starting. Use when the agent needs to take triaged QA findings, reproduce user-facing failures, implement fixes, add regression coverage where possible, and update QA status artifacts while preserving scenario evidence.
---

# QA Resolve Findings

Resolve QA findings as validation work. Start from user-visible behavior and scenario reproduction, then drive the necessary code or test changes.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Priority Input

Accept a `priority` parameter from the prompt:

- omitted priority: resolve the next highest remaining bucket only
- explicit level: `P0`, `P1`, `P2`, or `P3`
- `all`: resolve all remaining buckets

Default:

- `priority=next-highest`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Start From Curated Inputs

Prefer a curated source such as:

- `QA.findings.md`
- `findings.md` in a design folder
- explicit QA protocol notes with failed scenarios

Assume the curated findings are confirmed and the intended validation or fix plan is already chosen.

If the input is only a checklist, or if the plan is still ambiguous, stop and ask the user before coding or rewriting tests.

If the user previously commented on a finding but the expected behavior, validation target, rollout stance, or exact resolution path is still unclear, ask the follow-up question before coding.

## Workflow

1. Reproduce the scenario.
   Confirm the effective variables first:
   - `path`
   - `priority`
   - target findings files when inferable

   Select the target finding bucket based on `priority`:
   - default: the highest remaining severity bucket with unresolved work
   - explicit severity: only that bucket
   - `all`: every unresolved bucket

   Then confirm preconditions, environment, steps, expected behavior, and observed behavior for that selection.

2. Validate that the target finding is still the one you are meant to fix.
   Do not re-triage the whole document. Only stop when the finding is obviously stale, contradictory, or missing a clear intended resolution.
   If the finding is not implementation-ready after reading the user comments, ask concise finding-specific questions immediately.

3. Stay within the selected bucket.
   Keep the change scoped to the failing behavior unless a broader repair is clearly required. Do not opportunistically drift into lower-priority findings unless the user asked for `all`.

4. Add regression coverage.
   Prefer automated coverage for stable scenarios. If automation is not realistic, strengthen the QA protocol with explicit validation steps.

5. Re-run the scenario.
   Verify the fix against the original repro path.

6. Update status artifacts.
   Update `path/QA.findings.md` first, and any companion QA status document under `path` when present. Mark the finding `fixed`, `blocked`, `stale`, `wontfix`, or `in-progress` with concrete notes.
   Keep `Notes` and `Open Questions` above the findings sections.
   Keep `QA.findings.md` split into `Open Findings` and `Closed Findings`, and move the finding into the correct section when its status changes.

7. Sync PR review threads.
   If GitHub review-thread operations are available, resolve or close clearly-fixed QA-related review threads tied to the finding. Otherwise note the required manual action.

## Resolution Rules

- Do not mark a QA finding fixed without replaying the scenario or an equivalent automated check.
- Preserve preconditions and environment notes that explain why the issue appeared.
- Distinguish a fixed bug from an updated expectation.
- If the issue cannot be reproduced on current HEAD, mark it `stale` and record the evidence.
- If the right outcome is stronger validation rather than code, update the QA protocol accordingly.
- Stay in implementation and validation mode once the finding and plan are clear.
- If the finding is not actually confirmed or the plan is under-specified, ask the user instead of improvising triage.
- Do not convert user ambiguity into silent assumptions. Surface the missing decision explicitly before changing code or tests.

## Expected Outputs

Produce some combination of:

- code changes
- automated tests
- updated QA protocol/checklists
- updated findings or status documents

## What Belongs In QA vs CR

QA resolution is for validation failures:

- end-to-end regressions
- broken manual flows
- acceptance criteria misses
- deployment or environment-specific behavior
- missing validation procedures

If the work is mainly static verification of implementation details, use CR resolution instead.
