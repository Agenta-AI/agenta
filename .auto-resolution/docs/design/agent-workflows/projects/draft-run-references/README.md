# Draft-run references

An agent that edits its own configuration can commit once, then every later commit in the
same chat fails with `missing run-context value for direct-call binding
'workflow_revision.workflow_variant_id'`. The page has to reload to recover. This workspace
explains why and proposes the fix.

The cause: `isDirty` means the loaded revision carries unsaved edits, a draft overlay.
Whenever the panel is dirty, for any reason, the playground sends `references: null`, which
drops the variant identity that the `commit_revision` tool needs. The panel goes dirty from a
user editing the config, or from a missed `data-committed-revision` event that should have
repointed the panel to the revision the agent just committed. Either way, the old
all-or-nothing gate dropped every reference, so the agent's next commit failed.

The recommended fix: keep dropping the committed-revision reference on a dirty run (that is
the correct draft signal), but keep forwarding the variant reference, because the variant is
what `commit_revision` targets. Variant identity and draft-ness are independent.

## Files

- [context.md](context.md): what the user sees, why it matters, goals and non-goals, and the
  three layers involved.
- [research.md](research.md): the full trace of the bug through the frontend, the SDK and
  service, and the runner. Includes the worked before/after reference blocks and the verified
  proof that the frontend fix is safe. Read this to understand the mechanism.
- [plan.md](plan.md): the two fix options, their trade-offs, the recommendation, the
  draft-mode interaction, the acceptance checks, and the test plan.
- [status.md](status.md): current state, decisions, verified citations, provenance, and
  recorded follow-ups.

## Start here

Read context.md, then research.md (it proves the mechanism before anything is proposed), then
plan.md.

## Tracking

Issue: https://github.com/Agenta-AI/agenta/issues/5162
