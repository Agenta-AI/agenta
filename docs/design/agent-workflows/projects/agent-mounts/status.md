# Status: agent mounts

- **2026-07-11 (later)**: Review round with Mahmoud on discovery: the env var alone is
  not discoverable, and agent.md must not change. D3 gains the `agent-files` symlink in
  the cwd and the seeded README in the agent mount (write-if-absent); research.md gains
  the verbatim-instructions fact that rules out a platform instructions line, and the
  geesefs-symlink verification task. Implementation started (slices 1-3 in flight).
- **2026-07-11**: Workspace created from the Mahmoud+JP conversation (JP's voice note
  settled the mechanism: reserved slug from the artifact id, no session_id, runner upserts
  at mount time, derived mount point). Docs went through one internal review round before
  the PR: reconciled the mount-point wording, added the UUID-canonicalization requirement
  the slug validator forces, and scoped the sessionless claim to verified run types.
  Nothing implemented yet.

## Current state

Design review + implementation in flight (Mahmoud approved starting 2026-07-11 evening).
The six open questions at the end of `plan.md` still need JP's answers (slug shape,
endpoint placement, mount point + visible names, query semantics, frontend slice
ownership, run-type coverage); implementation follows the recommendations and adjusts if
an answer lands differently.

## Next

1. Land the implementation PR(s) for slices 1-3 per `plan.md`.
2. Resolve the open questions on the design PR.

## Blockers

None. The design depends on #5197's transcript-mount pattern, which is applied to the
working tree; if #5197 changes shape before merge, revisit the runner slice only.
