# Pi approval parking: open questions

Each question states a working default so the plan can proceed. The first two gate slice
order; the rest refine details.

1. **The live daemon confidence run (slice 0).** The spike proved the hop against `pi-acp`
   directly; the runner ships through the sandbox-agent daemon. Source says the daemon leg is
   a passthrough (`acp-http-client@0.4.2`, fail-closed), but it has not been run live.
   Working default: run slice 0 first; if the daemon leg drops or mangles the request, fall
   back to the parkable-gates design's Option B and stop.

2. **Approval-card rendering for the envelope identity.** The `interaction_request` payload
   today carries the harness's `toolCall` object. For a Pi dialog gate that object is the
   synthetic `pi-ui-<uuid>` dialog call whose `rawInput` is `{method, title, message}`; naive
   pass-through would render envelope JSON in the approval card. The plan synthesizes the
   card payload from the envelope (real tool name via the existing `resolvedName` stamp, real
   arguments as `rawInput`). Working default: synthesize; confirm with a frontend check in
   slice 4 that the card renders the same as a relay-gate card does today. If the frontend
   keys on anything else in `toolCall`, that is a slice-1 finding, not a wire change.

3. **Where the dialog-allow is recorded for the double-gate.** The plan writes a consumed
   dialog-allow into the turn's stored-decisions structure so the relay watcher's
   defense-in-depth check passes (plan.md, slice 2). The alternative was skipping relay
   enforcement under the flag. Working default: write-through; confirm during slice 2 that
   the stored-decisions object is reachable from the responder scope without a layering
   violation (both are built in `runTurn`; research.md §3).

4. **Flag coupling.** `AGENTA_RUNNER_PI_DIALOG_GATE` works without keep-alive but produces a
   half-state (better gates, no parking). Working default: independent flags, documented
   advice to enable DG only where KA is on. Alternative: make DG imply nothing without KA by
   checking KA runner-side. Decide at slice 2 review.

5. **Deny-warm semantics.** On a warm deny the hook returns `blockReason` and Pi continues
   its loop on the live session (the model sees the block and may try something else). That
   differs from Claude's deny (reply `reject`, harness continues similarly). Confirm during
   slice 4 that continuing live after a deny is the wanted UX, or whether a deny should also
   end the turn. Working default: continue live; it matches what Pi does today when a deny
   arrives within the poll window.

6. **The `agenta-approval` title as pre-filter.** A user extension could theoretically raise
   its own `confirm` titled `agenta-approval` with garbage. Parsing is strict (wrong kind or
   version falls through to the fail-closed spec-less path), so the worst case is a paused
   turn, not a wrong allow. Working default: accept; revisit if user-authored Pi extensions
   ever ship.
