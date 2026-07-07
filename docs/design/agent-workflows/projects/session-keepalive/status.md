# Session keep-alive: status

Source of truth for progress. Keep this current.

## Current state (2026-07-07)

- Phase: planning. Plan drafted and awaiting Mahmoud's review.
- Code: none written. Do not commit code from this workspace yet (another lane is in flight).
- Research: [architecture-notes.md](architecture-notes.md) verified against the current runner code. See "Drift check" below.

## Decisions made

- Build order: keep-alive slice 1, then slice 2, then session-resume slice A. Keep-alive before session resume (see plan.md Q6).
- Local only first; Daytona (slice 3) only after slices 1 and 2 have run in real use with no problems (plan.md Q8).
- Flag-gated, default off. Flag off is byte-identical behavior.
- Pool key is the conversation `session_id`, which already rides the wire.

## Open questions

See [open-questions.md](open-questions.md). None blocks starting slice 1; they refine defaults and edge behavior.

## Drift check: architecture-notes.md vs current code (2026-07-07)

Verified against `services/runner/src`. The notes are accurate. Details:

- Confirmed: `runSandboxAgent` at `sandbox_agent.ts:321-1048`; the unconditional teardown `finally` at 1004-1047; the pause controller destroying the session (`pause.ts:24-29`, callback at `sandbox_agent.ts:737-747`); the prompt/pause race at 899-912; `shouldSuppressPausedToolCallUpdate` at 180; the `onResolveInteraction` hook at 850; `cancelStaleInteractions` at `server.ts:275`; session-owned runs surviving disconnect at `server.ts:237-246`; the SIGTERM handler and `destroyInFlightSandboxes`.
- Confirmed: `sandbox-agent` is 0.4.2. `Session.prompt`, `Session.onEvent` (returns `() => void`), `Session.onPermissionRequest` (returns `() => void`), `Session.respondPermission`, and the daemon's private `pendingPermissionRequests` all exist in the package types. `resumeSession` exists and is the lossy text-replay one (consistent with the report's Q4).
- Confirmed: `request.sessionId` at `protocol.ts:385`, resolved by `resolveRunSessionId` at 561.

Minor items to note (not blockers):

1. **Citation nudge.** The notes cite `sessions/alive.ts:32-36` for the `owner:session` affinity keys. Those lines are the `REPLICA_ID` constant. The affinity key is described in the file's header comment (lines 10-11, 30-31) and is driven by `REPLICA_ID`. The claim is correct; the line span points at the const, not the key literal.
2. **Load-bearing nuance for the risk estimate.** The notes say the listeners are "re-attachable ... detach the previous turn's" as if the seam is ready. The package supports it (both listeners return an unsubscribe function), but the current runner code discards those return values (`sandbox_agent.ts:749`, `acp-interactions.ts:51`). So capturing and calling the unsubscribe functions is net-new work, and it is the crux of the slice-1 risk. This is reflected in plan.md Q2. No correction to the notes is needed; it is an emphasis for whoever implements.

## Next steps

1. Mahmoud reviews the plan and the open questions.
2. Run spike E5 (two prompts, one session) before slice 1.
3. Run spike E6 (hold a permission request, then respond) before slice 2.
4. Implement slice 1 behind the flag. Verify flag-off is byte-identical.
