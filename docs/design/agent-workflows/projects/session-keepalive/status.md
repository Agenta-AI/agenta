# Session keep-alive: status

Source of truth for progress. Keep this current.

## Current state (2026-07-08)

- Phase: implementation. Mahmoud approved the plan subject to the Codex xhigh review findings; all seven findings are folded into plan.md and architecture-notes.md (see the review changelog at the top of plan.md).
- Slice 1 (`feat/session-keepalive-pool`) and slice 2 (`feat/session-keepalive-approvals`, stacked on slice 1) are being implemented as draft PRs based on `big-agents`.
- Research: [architecture-notes.md](architecture-notes.md) verified against the current runner code. See "Drift check" below.

## Decisions made

- Build order: keep-alive slice 1, then slice 2, then session-resume slice A. Keep-alive before session resume (see plan.md Q6).
- Local only first; Daytona (slice 3) only after slices 1 and 2 have run in real use with no problems (plan.md Q8).
- Flag-gated, default off. Flag off is byte-identical behavior.
- Pool key is `<projectId>:<session_id>` (project-scoped; the conversation id already rides the wire). Parks carry a credential epoch and evict on expiry or rotation.
- Slice 2 v1 parks Claude ACP permission gates only; Pi relay gates, Pi builtin gates, and client-tool MCP pauses stay cold (plan.md Q7 scope table), asserted by tests.
- Listeners attach once per session and demux into the active turn's sink; no per-turn detach/attach (drop/cancel window).
- The pool owns a complete idempotent destroy() per session, built incrementally in acquireEnvironment; the shutdown path drains the pool through it (`inFlightSandboxes` alone only destroys the sandbox).
- A resumed approval executes with the original turn's baked environment; the new turn owns streaming and tracing.
- The debug-local-deployment live loop (implement-feature Phase 3) is EXPLICITLY DEFERRED by Mahmoud; it is the recorded next step after PR review.

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

1. Land slice 1 (`feat/session-keepalive-pool`) and slice 2 (`feat/session-keepalive-approvals`) as draft PRs; Mahmoud does the final review on the PRs.
2. After review: run the deferred live-deployment loop (debug-local-deployment) with the flag on and off against a real playground conversation, confirming flag-off is byte-identical and watching the [HITL]/pool log lines.
3. Then consider Daytona (slice 3) and session resume (option 3) per the recorded order.
