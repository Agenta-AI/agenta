# F-040 fix plan: make a HITL park END the `/run` turn gracefully

## The bug (confirmed, live)

On the `/messages` (HITL) path, when the responder returns `park`
(`engines/sandbox_agent/permissions.ts`), the runner sends NO `respondPermission` and
relies on `session.prompt()` resolving. Claude-over-ACP does NOT end the turn on an
unanswered permission gate, so `session.prompt()` (`sandbox_agent.ts:~428`) blocks
forever. Consequences:

1. The parked turn never terminates → its temp sandbox leaks (the `finally` never runs).
2. The egress (`vercel/stream.py`) never sees the run iterator end → no `finish` frame →
   the SSE stream hangs.
3. The AI-SDK resume fires while the old stream is still open → errors → "agent run
   failed" (Deny) / 5-min hang then `ERR_ABORTED` (Approve).

## The fix (one move, runner-side)

When the responder returns `park`, **end the current `/run` turn gracefully** instead of
holding the ACP connection open:

- `permissions.ts` reports the park back to the orchestration loop (a callback / signal).
- `sandbox_agent.ts` races `session.prompt()` against a "parked" signal. On park it calls
  `sandbox.destroySession(session.id)`, which (verified in the `sandbox-agent` package):
  - `cancelPendingPermissionsForSession` resolves the pending permission RPC with
    `{outcome: "cancelled"}` (NOT a reject → no F-024 clobber), and
  - sends the managed `session/cancel`, so the in-flight `prompt()` resolves with
    `StopReason::Cancelled`.
- The runner then returns a terminal result with `stopReason: "paused"` (a park terminal,
  distinct from a model `cancelled`), so:
  - the egress loop ends and emits a proper `finish` frame (`finishReason` maps to
    `unknown`/omitted — fine; the FE re-runs on resume),
  - the `finally` disposes the sandbox (NO leak).

The resume then cold-replays as a fresh turn: `extractApprovalDecisions` resolves the
stored decision via the name+args anchor (already built, #4854), Approve → tool runs →
completes; Deny → clean denial (`#4859` FE path already maps deny → tool-error, model
continues).

### Why `destroySession`, not a raw `session/cancel`

The `sandbox-agent` package blocks a manual `session/cancel` via `rawSend`
(`MANUAL_CANCEL_ERROR`); only `destroySession` is allowed to send the managed cancel.
`destroySession` is exactly the right call: it cancels the pending permission cleanly AND
the in-flight prompt, then marks the session destroyed (we dispose the sandbox anyway).

## FE resume contract (point 4) — already built, just verified

`vercel/messages.py` `_tool_part_blocks` already converts an inline
`state:"approval-responded"` tool part into the `{approved}` envelope, and
`agentApprovalResume.ts` ensures the FE includes the responded tool part on resume. No FE
change needed; covered by existing tests.

## Slices

1. **Runner park-terminal** (`permissions.ts` + `sandbox_agent.ts`): park signal →
   `destroySession` → terminal `stopReason:"paused"`; the `finally` disposes (no leak).
2. **Tests**: park emits a terminal result (stopReason paused, prompt unblocked); no
   sandbox leak on park (destroySession + destroySandbox both called); the resume
   cold-replay still resolves (existing test stays green).

## Acceptance

- Unit: a parked run RETURNS (does not hang), `stopReason:"paused"`, `destroySession`
  called once, sandbox disposed once.
- Live: Claude + haiku + gated github tool + Ask rule → Approve completes with the real
  result (no hang); Deny → clean denial (no "agent run failed"); NO leaked runner temp
  sandbox after a parked→resumed turn. Reproduce 2-3x.
