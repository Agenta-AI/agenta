---
name: qa-triage-findings
description: Triage validation-oriented QA findings for a feature, branch, or release candidate. Accept optional `path` and GitHub PR `url`; when `url` is provided, triage against both remote PR state and local behavior, otherwise default to local-only triage. Default to `path=infer`. Confirm effective variables before starting. Use when the agent needs to sync manual QA notes, acceptance-check failures, scenario regressions, rollout validation docs, PR comments, and current behavior into a deduplicated findings set focused on user-visible behavior, workflows, reproducibility, severity, confidence, status, and missing validation coverage.
---

# QA Triage Findings

Triage QA findings as validation work. Focus on whether the feature behaves correctly in realistic user flows and whether acceptance criteria are actually satisfied.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## URL Input

Accept an optional GitHub PR `url` from the prompt.

- If a PR URL is provided, perform remote plus local triage:
  - pull open PR comments and review state from that PR
  - sync them against local findings files and current local behavior
- If no URL is provided, perform local-only triage using repo artifacts and current local behavior

Default:

- `url=local-only`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Source Material To Mine First

This repo already contains QA artifacts under `docs/design` and `docs/designs`.

Prioritize files matching:

- `docs/design*/**/QA.md`
- `docs/design*/**/qa.md`
- `docs/design*/**/findings.md` when the file captures validation outcomes
- design docs that define expected behavior or rollout protocol

Representative examples already in the repo:

- `docs/designs/advanced-auth/QA.md`
- `docs/designs/api-rate-limiting/QA.md`
- `docs/designs/data-retention/QA.md`
- `docs/design/align-evaluator-interface/qa.md`
- `docs/design/stateless-playground/qa.md`
- `docs/design/evaluation-runtime-heartbeats/findings.md`

Treat old QA notes as reusable evidence and scenario seeds. Re-check them against the current build or current code before carrying them forward.

## Workflow

1. Establish the validation target.
   Confirm the effective variables first:
   - `path`
   - `url`
   - feature, environment, branch, deployment phase, and any before/after or migration constraints

2. Gather validation inputs.
   Read QA protocols, acceptance criteria, bug reports, support notes, rollout docs, and prior findings.

3. Normalize scenarios.
   Convert free-form notes into explicit reproducible findings with preconditions, steps, expected behavior, and observed behavior.

4. Dedupe by scenario outcome.
   Merge duplicates when they represent the same broken flow, even if they came from different runs.

5. Separate findings from test plans.
   A QA checklist item is not a finding unless it failed, is missing coverage, or revealed risk worth tracking.

6. Sync the master findings set.
   Use `path/QA.findings.md` as the canonical record. Pull from existing findings, open PR comments, QA notes, validation docs, and current behavior, then sync them into one consistent state.
   Keep `Notes` and `Open Questions` above `Open Findings` so unresolved context is visible before the list.
   Keep the file split into `Open Findings` and `Closed Findings`, and move each finding into the correct section whenever its status changes.

7. Resolve open questions.
   When expected behavior is ambiguous, acceptance criteria conflict, or multiple validation paths are legitimate, ask the user and record the resulting decision in the findings document.
   If the user already commented on a finding but the validation target or disposition is still unclear, ask the missing follow-up question in the same turn rather than silently leaving the item open.

8. Update PR thread disposition.
   If GitHub review-thread operations are available, resolve or close clearly-fixed QA-related review threads and keep unresolved threads mapped to finding IDs. If not, note the required manual action.

## Output Shape

For each finding kept in `QA.findings.md`, include:

- `ID`
- `Severity`
- `Confidence`
- `Status`
- `Area`
- `Summary`
- `Preconditions`
- `Steps`
- `Expected`
- `Observed`
- `Evidence`
- `Files`
- `Cause`
- `Explanation`
- `Suggested Fix`
- `Alternatives`
- `Sources`

Useful status values:

- `candidate`
- `open`
- `reproduced`
- `needs-user-decision`
- `in-progress`
- `fixed`
- `stale`
- `wontfix`
- `blocked`

## Curation Rules

- Prefer scenario clarity over code-level theorizing.
- Keep user-visible impact explicit.
- Preserve environment details when they matter.
- Mark irreproducible or outdated issues as `stale`, not `open`.
- Call out missing QA coverage separately from confirmed failures.
- Keep the master findings file in sync with current PR comments, current findings, and current behavior.
- When the user gives a per-finding reply, continue asking until the finding is clearly ready for fix, accepted, blocked, or still under investigation for a specific reason.

## What Belongs In QA vs CR

QA is validation:

- broken user flows
- failed acceptance criteria
- regressions in manual scenarios
- environment- or deployment-sensitive behavior
- missing scenario coverage

If the issue is primarily about implementation correctness without a scenario repro, route it to CR instead.
