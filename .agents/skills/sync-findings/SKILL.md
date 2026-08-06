---
name: sync-findings
description: Sync the findings record against local review artifacts and optionally a GitHub PR. Accept optional `path` and GitHub PR `url`; when `url` is provided, sync against both remote PR state and local state, otherwise default to local-only sync. Default to `path=infer`. Confirm effective variables before starting.
---

# Sync Findings

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Keep the active findings record aligned with current local state and, when requested, current GitHub PR state.

- Pull in open PR comments, review notes, local review docs, and current code state.
- Map comments to findings, update sources and statuses, and surface follow-up questions.
- When GitHub thread operations are available, reply to and resolve threads that are clearly closed by current findings.

## URL Input

Accept an optional GitHub PR `url` from the prompt.

- If a PR URL is provided, do remote plus local sync.
- If no URL is provided, do local-only sync.

Default:

- `url=local-only`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Establish sync scope.
   Confirm the effective variables first:
   - `path`
   - `url`
   - branch, PR URL if present, and any requested focus areas

2. Load the active findings record.
   Use `path/findings.md`.

3. **SAVE FIRST — write every new finding into `path/findings.md` before doing anything else.**
   This is the non-negotiable first action of every sync. Before proposing fixes, discussing implications, replying to threads, or updating any other doc:
   - For each new PR review comment or scan observation, add an entry under `## Open Findings` using the canonical schema (ID, severity, files, evidence, decision pending).
   - Mark every new finding as `needs-user-decision` unless the user has already given direction.
   - Refresh the `## Summary` section so the latest state is visible at the top.
   - Only after `findings.md` is up to date may you start summarizing for the user or proposing fixes.

   This rule exists because diving straight into "let me explain / propose / fix" mode loses context and leaves the user to reconstruct the finding list themselves. The doc is the source of truth, not the chat history.

4. Sync sources into findings.
   Re-check existing findings against current local code and docs.
   If `url` is present, pull open PR comments and thread state into the same record.

5. Ask clarifying questions before parking ambiguity.
   If a finding's disposition or intended action is still unclear, ask the next concrete question instead of silently leaving it vague.

6. Close only what is clearly closed.
   When a GitHub thread maps to a closed finding, leave a short reply with the finding ID when relevant and resolve the thread.
   Leave still-open or still-ambiguous threads untouched.

## Rules

- **Save-first is mandatory.** Step 3 must complete before any code change, fix proposal, GitHub reply, or summary update. No exceptions.
- Sync is not a substitute for execution planning; use `triage-findings` when the user needs help deciding what to do next.
- Do not silently drop sources, thread IDs, or comment provenance.
