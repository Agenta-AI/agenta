# Status and decisions

## Current status

Planning complete. No implementation changes were made in this workspace.

Pull request under review:

- `https://github.com/Agenta-AI/agenta/pull/5860`
- Head commit reviewed: `c17d5541288cb5e3f8f5bac645ca48f38175a7a6`
- Base branch: `release/v0.112.0`

## Settled recommendations

- Rewind creates a new runtime session. It does not truncate the existing session in place.
- The original session remains complete in History.
- Pull request 5860 stays frontend-only and does not introduce backend lineage.
- The pull request must persist edit or rerun mode, restored draft, and replay state, then clear the
  bootstrap only after success.
- The pull request should preserve custom titles.
- The pull request must describe its same-browser durability limitation.
- Durable branching uses session lineage, not parent pointers on every record.
- Records remain append-only.
- A durable child stores how many complete turns it inherits from the parent's effective transcript.
- The backend also stores an internal physical record cutoff so transcript reads do not scan
  discarded parent tails.
- Physical records use one null-safe total order ending in `record_id`, backed by a matching tracing
  database index.
- The effective transcript endpoint replaces the frontend's records hydration request rather than
  adding another request.
- The client-tool `{}` input replay defect is valid and should be fixed separately.

## Open decisions for durable branching

### Parent deletion

Recommended default: retain soft-deleted ancestor records while descendants reference them. The
team must define permanent purge behavior and retention accounting.

### Attachment access

Recommended default: add `session_attachment_access` rows that grant the child access to existing
parent-owned attachments without copying bytes or changing attachment IDs.

### Running-parent forks

Recommended default: reject a fork when the selected turn is incomplete. Decide whether a completed
prefix of a currently running parent may be forked safely.

### Header naming

Recommended default: copy a custom title with `(branch)` and copy description unchanged. Decide how
the API distinguishes a custom title from an auto-generated title if auto-title should be
recalculated.

### Branch depth

Choose a maximum after measuring realistic usage. The implementation must have a finite ceiling and
cycle protection even if the UI rarely creates deep chains.

### Session files

Recommended first contract: transcript and attachment-access inheritance only. Do not inherit
arbitrary sandbox files or processes until a snapshot capability exists.

## Known implementation risks

- Frontend and backend may deploy at different times. Removing `replayHistory` requires a capability
  or rollout gate.
- Session turns live in the core database while records may live in the tracing database. Effective
  transcript resolution needs a bounded two-store read rather than a relational cross-database join.
- Existing comments in older agent-workflows session documentation describe a cold-only system and
  are stale relative to current warm and durable behavior. Treat current code as authoritative.
- The package-level `@agenta/chat` rewind remains in-place and can reintroduce the original bug when
  that surface becomes active.
