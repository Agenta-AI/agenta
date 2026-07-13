# Status

## Current state

Research and revised launch design complete. No implementation has started. The plan now covers
native transcript loss as well as stale skill paths.

## Progress log

- 2026-07-13: Traced the stale Pi skill path to the random per-run agent directory.
- 2026-07-13: Verified the history that introduced Pi agent-dir skills and later added Claude
  workspace-local skills.
- 2026-07-13: Verified Pi 0.80.6 cwd discovery and project-trust behavior from the pinned upstream
  source.
- 2026-07-13: Confirmed a local Pi resume can report `loaded=true` after replacing a deleted
  transcript with a blank native session.
- 2026-07-13: Rejected launch-time deletion reconciliation after reviewing Claude's existing
  merge-only copier and the failure modes of mutable workspace ownership.
- 2026-07-13: Split delivery into an immediate verified-load gate, append-only skill snapshots, and
  durable private transcript storage.
- 2026-07-13: Review pass on PR #5284. Confirmed every research claim against the runner source
  and the pinned Pi 0.80.6 and `pi-acp@0.0.29` code. Adopted the launch stance that every cold Pi
  load is unverified until real evidence exists, and split the `pi-acp` change out of the gate
  into Phase 0b.
- 2026-07-13: Traced Pi's session-directory override end to end. Selected the `settings.json`
  `sessionDir` form as the leading durable-transcript mechanism because `pi-acp` reads the same
  settings key for its scans and ignores the env var.
- 2026-07-13: Accepted immutable-by-convention skill snapshots as the threat model and documented
  the write-ownership fail-closed rule as distinct from history-uncertainty fallback.

## Decisions

- Land the verified-load replay fallback before storage or skill-layout changes.
- Use the literal non-hidden `./agents/skills`, not trust-gated `.agents/skills` or
  `.pi/skills`, for configured Pi skill snapshots.
- Keep `AGENTS.md` in the cwd.
- Keep Pi system prompts, credentials, settings, custom models, and executable extensions in the
  ephemeral private Pi agent directory.
- Persist only the native transcript directory in private session-scoped storage.
- Do not auto-trust the session cwd.
- Load only the complete current skill snapshot through an explicit Pi skill source.
- Refresh startup resources on environment acquisition, not on every warm turn.
- Do not reconcile, replace, or garbage-collect old snapshots during environment acquisition.
- Do not change Claude skill materialization in the urgent implementation.
- Ship the launch gate without any `pi-acp` change: every cold Pi load starts unverified and
  replays. Verified loads return through Phase 0b, preferably in `pi-acp`, with a local runner
  header check as an acceptable interim source.
- Use the `settings.json` `sessionDir` key in the per-run agent directory, not the env var, as
  the leading mechanism for durable local transcripts.
- Accept immutable-by-convention snapshots: the cwd is agent-writable and the completion record
  does not hash contents.

## Blockers

The explicit Pi skill-path seam and local transcript persistence seam require focused probes before
their follow-up implementations. They do not block the verified-load correctness gate.

## Open questions

1. Does Pi 0.80.6 load an absolute skill path from isolated global settings while the project stays
   untrusted? The probe must pass before moving skills.
2. Does the `sessionDir` settings override hold up under fault injection? Code reading confirms Pi
   honors it in RPC mode and `pi-acp` reads the same settings key for its scans, but teardown,
   runner restart, map-miss recovery, and storage-failure behavior still need the Phase 1 probe.
   The mount extension and the `sessions`-child link remain fallbacks.
3. Does a newer `pi-acp` validate transcript existence and identity? Keep the Agenta verification
   guard even if upstream now does.

## Next steps

1. Issue #5283 and design PR #5284 are filed; the review updates are on the PR.
2. Implement the Phase 0 conservative fallback as the launch gate.
3. Restore verified loads (Phase 0b), preferably in `pi-acp`.
4. Add durable local Pi transcript storage through the `sessionDir` settings override.
5. Move Pi skills to append-only cwd snapshots after the explicit-path probe passes.
