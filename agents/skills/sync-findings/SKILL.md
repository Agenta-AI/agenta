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

3. Sync sources into findings.
   Re-check existing findings against current local code and docs.
   If `url` is present, pull open PR comments and thread state into the same record.

4. Ask clarifying questions before parking ambiguity.
   If a finding's disposition or intended action is still unclear, ask the next concrete question instead of silently leaving it vague.

5. Close only what is clearly closed.
   When a GitHub thread maps to a closed finding, leave a short reply with the finding ID when relevant and resolve the thread.
   Leave still-open or still-ambiguous threads untouched.

## Rules

- Sync is not a substitute for execution planning; use `triage-findings` when the user needs help deciding what to do next.
- Do not silently drop sources, thread IDs, or comment provenance.
