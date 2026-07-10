# Status: agent mounts

- **2026-07-11**: Workspace created from the Mahmoud+JP conversation (JP's voice note
  settled the mechanism: reserved slug from the artifact id, no session_id, runner upserts
  at mount time, derived mount point). Docs went through one internal review round before
  the PR: reconciled the mount-point wording, added the UUID-canonicalization requirement
  the slug validator forces, and scoped the sessionless claim to verified run types.
  Nothing implemented yet.

## Current state

Design review. The six open questions at the end of `plan.md` need answers (slug shape,
endpoint placement, mount point constant, query semantics, frontend slice ownership,
run-type coverage); JP and Mahmoud comment on the PR.

## Next

1. Resolve the open questions on the PR.
2. Implement slice 1 (API) per `plan.md`.

## Blockers

None. The design depends on #5197's transcript-mount pattern, which is applied to the
working tree; if #5197 changes shape before merge, revisit the runner slice only.
