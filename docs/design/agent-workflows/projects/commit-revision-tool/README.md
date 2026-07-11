# commit-revision-tool

Move `commit_revision`'s agent-facing logic (read current config → validate the model's
edit → build the change set) out of the direct-call-to-core path and into a dedicated
first-party Agenta tool in the tools domain. Keep JP's `delta` commit (`4ae6289d68`) as the
clean core primitive.

## Files

- `research.md` — code-truth research with file:line: the two tool layers, how
  `commit_revision` works now, JP's `delta` contract from `origin/big-agents`, how schema
  validation is done today, and why the tool must stay a direct-call platform op.
- `design.md` — plan-feature-style design: chosen home (Option A), the four-step behavior,
  `delta`-vs-`data` call, error handling, draft constraint, interface review, the
  draft-PR spec, and risks/open questions.

## Source threads (read-only context, do not re-derive)

- `../../scratch/pr-4936-followup/01-commit-revision.md` — D1 (where it lives), D2 (delta vs data).
- `../../scratch/pr-4936-followup/03-ctx-variant-binding.md` — self-targeting, drafts, generic errors.

## Status

Design ready for owner review. No code, no PR yet — the draft PR (design §8) is the next
orchestrator-sequenced step.
