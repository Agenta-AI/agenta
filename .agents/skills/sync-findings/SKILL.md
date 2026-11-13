---
name: sync-findings
description: Sync the findings record against local review artifacts and optionally a GitHub PR. Accept optional `path` and GitHub PR `url`; when `url` is provided, sync against both remote PR state and local state, otherwise default to local-only sync. Default to `path=infer`. Confirm effective variables before starting.
---

# Sync Findings

Read `../shared/references/findings.lifecycle.md` for the inputs, their defaults, and the
rules all findings stages share. Read `../shared/references/findings.schema.md` for the shape
of `findings.md`.

## Role

Keep the active findings record aligned with current local state and, when requested, current GitHub PR state.

- Pull in open PR comments, review notes, local review docs, and current code state.
- Map comments to findings, update sources and statuses, and surface follow-up questions.
- When GitHub thread operations are available, propose replies to threads and thread resolutions. Ask the user before you post a reply or resolve a thread.

## Workflow

1. Establish sync scope.
   Confirm the effective variables first:
   - `path`
   - `url`
   - branch, PR URL if present, and any requested focus areas

2. Load the active findings record.
   Use `path/findings.md`.

3. Save new findings first.
   Before you propose fixes, discuss implications, reply to threads, or update any other doc,
   write every new finding into `path/findings.md`:
   - For each new PR review comment or scan observation, add an entry under `## Open Findings`
     with the fields in `findings.schema.md` (ID, severity, files, evidence, decision pending).
   - Mark each new finding `needs-user-decision` unless the user already gave direction.
   - Refresh the title, sync metadata, and sources block at the top of the document, as the
     document order in `findings.schema.md` sets out.

   The document is the source of truth. If you explain or fix before you save, the user must
   rebuild the finding list from the chat.

4. Sync sources into findings.
   Re-check existing findings against current local code and docs.
   If `url` is present, pull open PR comments and thread state into the same record.

5. Ask clarifying questions before parking ambiguity.
   If a finding's disposition or intended action is still unclear, ask the next concrete question instead of silently leaving it vague.

6. Close only what is clearly closed.
   When a GitHub thread maps to a closed finding, draft a short reply with the finding ID.
   Ask the user before you post replies or resolve threads. Leave still-open or still-unclear
   threads untouched.

## Rules

- Finish step 3 before any code change, fix proposal, or GitHub reply.
- Sync is not a substitute for execution planning; use `triage-findings` when the user needs help deciding what to do next.
- Do not silently drop sources, thread IDs, or comment provenance.
