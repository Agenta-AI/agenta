---
name: cr-resolve-findings
description: Resolve verification-oriented code review findings for a branch or PR. Accept optional `path` and a `priority` selector; by default resolve only the next highest remaining priority bucket, in order `P0`, `P1`, `P2`, `P3`. Also accept explicit levels or `all`. Default to `path=infer`. Confirm effective variables before starting. Use when the agent needs to take triaged CR findings, validate that the target fix is still applicable, implement fixes, add targeted regression coverage, and update review-status artifacts without losing source attribution.
---

# CR Resolve Findings

Resolve code review findings as verification work. The goal is to eliminate confirmed implementation defects and keep the review artifact set current.

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

- `CR.findings.md`
- `CR.status.md`
- PR review comments already mapped to actionable findings

Assume the curated findings are confirmed and the intended plan is already chosen.

If only raw CR notes exist, or if the intended fix path is still ambiguous, stop and ask the user before coding.

If the user previously commented on a finding but the policy, mutability rule, compatibility expectation, or exact desired outcome is still unclear, ask the follow-up question before coding.

## Workflow

1. Load the current findings set.
   Confirm the effective variables first:
   - `path`
   - `priority`
   - target findings files when inferable

   Select the target finding bucket based on `priority`:
   - default: the highest remaining severity bucket with unresolved work
   - explicit severity: only that bucket
   - `all`: every unresolved bucket

   Then identify source refs, severity, and affected files for that selection.

2. Validate that the target finding is still the one you are meant to fix.
   Do not re-triage the whole document. Only stop when the finding is obviously stale, contradictory, or missing a clear intended resolution.
   If the finding text and the user comments do not yet produce an implementation-ready plan, ask concise finding-specific questions immediately.

3. Stay within the selected bucket.
   Do not opportunistically drift into lower-priority findings unless the user asked for `all`.

4. Implement the smallest correct fix.
   Preserve existing architecture and documented conventions unless the finding requires broader repair.

5. Add verification.
   Add or update targeted tests whenever the finding is about behavior, contract, migration, or regression risk.

6. Update status artifacts.
   Update `path/CR.findings.md` first, and `path/CR.status.md` when present. Mark findings `fixed`, `stale`, `wontfix`, `blocked`, or leave them `in-progress` with a concrete blocker.

7. Sync PR review threads.
   If GitHub review-thread operations are available, resolve or close clearly-fixed review threads tied to the finding. Otherwise note the required manual action.

## Resolution Rules

- Never mark a finding fixed unless the current code actually addresses the reported behavior.
- Never close a finding only because the code changed nearby.
- Preserve source IDs or thread references when updating status docs.
- If a finding is invalid on current HEAD, mark it `stale` and explain why.
- If a finding is intentionally accepted, mark it `wontfix` or `process` with rationale.
- If the real fix is documentation or migration planning, say so instead of forcing a code patch.
- Stay in implementation mode once the finding and plan are clear.
- If the finding is not actually confirmed or the plan is under-specified, ask the user instead of improvising triage.
- Do not convert user ambiguity into hidden assumptions. Surface the missing decision explicitly before touching code.

## Expected Outputs

Produce some combination of:

- code changes
- targeted tests
- updates to `CR.findings.md`
- updates to `CR.status.md` when present

When updating a status table, prefer explicit action language like:

- fixed and verified
- stale on current head
- accepted intentionally
- blocked pending decision

## What Belongs In CR vs QA

CR resolution is for verification defects:

- broken logic
- wrong filters or merge order
- contract drift
- compatibility gaps
- migration omissions
- missing regression tests

If the work is mainly about reproducing user flows, acceptance criteria, or scenario validation, use QA resolution instead.
