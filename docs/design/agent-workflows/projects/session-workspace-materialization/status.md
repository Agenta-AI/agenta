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

## Blockers

The explicit Pi skill-path seam and local transcript persistence seam require focused probes before
their follow-up implementations. They do not block the verified-load correctness gate.

## Open questions

1. Does Pi 0.80.6 load an absolute skill path from isolated global settings while the project stays
   untrusted? The probe must pass before moving skills.
2. Should local Pi use a direct session mount, or should the throwaway agent directory link its
   `sessions` child to stable private storage? Choose after fault-injection tests compare teardown
   and mount-failure behavior.
3. Does a newer `pi-acp` validate transcript existence and identity? Keep the Agenta verification
   guard even if upstream now does.

## Next steps

1. File the confirmed conversation-loss issue and publish this design-only PR.
2. Implement the verified-load fallback as the launch gate.
3. Add durable local Pi transcript storage.
4. Move Pi skills to append-only cwd snapshots after the explicit-path probe passes.
