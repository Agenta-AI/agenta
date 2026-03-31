---
name: cr-triage-findings
description: Triage verification-oriented code review findings for a branch, PR, or design change. Accept optional `path` and GitHub PR `url`; when `url` is provided, triage against both remote PR state and local code, otherwise default to local-only triage. Default to `path=infer`. Confirm effective variables before starting. Use when the agent needs to sync external review notes, GitHub comments, prior CR documents, and current code into a deduplicated and evidence-backed findings set focused on correctness, regressions, compatibility, design drift, severity, confidence, status, and next action.
---

# CR Triage Findings

Triage code review findings as verification work. Focus on whether the implementation is correct, coherent, compatible, and aligned with documented intent.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## URL Input

Accept an optional GitHub PR `url` from the prompt.

- If a PR URL is provided, perform remote plus local triage:
  - pull open PR comments and review state from that PR
  - sync them against local findings files and current local code
- If no URL is provided, perform local-only triage using repo artifacts and current local code

Default:

- `url=local-only`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Source Material To Mine First

Search the repo before inventing a new review document. This repo already contains review artifacts under `docs/design` and `docs/designs`.

Prioritize files matching:

- `docs/design*/**/CR.md`
- `docs/design*/**/CR.findings.md`
- `docs/design*/**/CR.status.md`
- `docs/design*/**/*-CR.md`
- related `PR.md` files when they define intended scope or rollout

Representative examples already in the repo:

- `docs/designs/runnables/CR.md`
- `docs/designs/webhooks/CR.findings.md`
- `docs/designs/loadables/CR.status.md`
- `docs/design/annotation-queue-v2/CR.findings.md`

Treat external reviewer output as input hypotheses, not truth. A finding is only confirmed after checking the current code or tests.

## Workflow

1. Establish the review target.
   Confirm the effective variables first:
   - `path`
   - `url`
   - branch, PR, base branch, date, and any explicit scope limits

2. Gather prior findings.
   Read existing CR docs, review comments, external reviewer notes, and relevant design docs.

3. Classify each source artifact.
   Distinguish:
   - raw review notes
   - consolidated findings
   - status/resolution tracking
   - design intent or migration plan

4. Normalize candidate findings.
   Merge duplicates by behavior, not wording. Keep all relevant source references.

5. Re-verify against current code.
   Confirm each candidate using code, tests, schemas, routes, or runtime behavior. Downgrade or drop stale findings.

6. Sync the master findings set.
   Use `path/CR.findings.md` as the canonical record. Pull from existing findings, open PR comments, prior CR docs, and current code, then sync them into one consistent state.

7. Resolve open questions.
   When evidence is ambiguous, reviewers disagree, or multiple fix paths are legitimate, ask the user and record the resulting decision in the findings document.

8. Update PR thread disposition.
   If GitHub review-thread operations are available, resolve or close clearly-fixed review threads and keep unresolved threads mapped to finding IDs. If not, note the required manual action.

## Output Shape

For each finding kept in `CR.findings.md`, include:

- `ID`
- `Severity`
- `Confidence`
- `Status`
- `Category`
- `Summary`
- `Evidence`
- `Files`
- `Cause`
- `Explanation`
- `Impact`
- `Suggested Fix`
- `Alternatives`
- `Sources`

Allowed status values:

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

When helpful, include:

- review scope
- verification performed
- coverage gaps
- thread disposition table
- open questions or decision points

## Severity Rules

- `High` or `P0/P1`: correctness, security, compatibility, migration, or data-loss issues that should block merge or demand immediate follow-up
- `Medium` or `P2`: real defects or contract drift with bounded blast radius
- `Low` or `P3`: maintainability, clarity, or low-risk consistency issues

Preserve the source severity if it is already established, but normalize the final document to one scheme.

## Curation Rules

- Do not keep duplicate findings just because different reviewers worded them differently.
- Do not preserve stale findings without marking them stale.
- Do not upgrade speculation into a confirmed bug without evidence.
- Prefer file-level evidence over general statements.
- Separate code defects from process or rollout comments.
- Call out missing tests when the risk depends on absent coverage.
- Keep the master findings file in sync with current PR comments and current code.

## What Belongs In CR vs QA

CR is verification:

- implementation correctness
- API or schema drift
- migration safety
- design-doc mismatch
- contract regressions
- missing or misleading tests

If the issue is primarily about end-user behavior, scenario validation, or acceptance-flow coverage, move it to QA instead of forcing it into CR.
