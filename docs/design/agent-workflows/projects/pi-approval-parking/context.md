# Pi approval parking: context

## Why this exists

The runner's approval story is judged by one invariant: whether a human answers an approval in
ten seconds or after hours, the sequence of LLM API calls should be identical. Call N ends with
the model returning a tool call; call N+1 appends the real result for that same call; nothing
is regenerated in between. Both production approval failures (argument drift, task restart)
came from breaking it: the runner destroyed the session on pause, replayed flattened text into
a fresh agent, and the model re-issued a new call whose arguments drifted from the stored
decision.

Keep-alive slice 2 (merged, #5158) fixed this for one gate: the Claude ACP permission gate.
The runner parks the live session with the permission request held open and answers it when
the human clicks, so the original call runs with its original arguments. Pi has no such path.
Both Pi gates (the custom-tool relay gate and the builtin permission gate) destroy the session
the moment an ask fires, and every Pi approval resumes through cold replay with the drift risk
that implies.

The parkable-gates design
([../session-keepalive/followups/parkable-gates/design.md](../session-keepalive/followups/parkable-gates/design.md))
evaluated the options and a live spike on 2026-07-09 proved the chosen one, Option C: raise
the Pi gate as a real ACP permission request through the extension-UI dialog plane that the
`pi-acp` bridge already has, and let the existing slice-2 park machinery hold it. The spike
held a gate open for three minutes and resumed the original call with its original arguments
([../session-keepalive/followups/parkable-gates/spike-option-c/report.md](../session-keepalive/followups/parkable-gates/spike-option-c/report.md)).

This project is the implementation of that decision.

## Goal

Both Pi approval gates become parkable: inside the keep-alive approval TTL, a human's answer
resumes the exact original tool call on the live session (the byte-exact tier). Outside it,
everything degrades to today's cold decision-map path, unchanged.

Concretely:

- The in-sandbox extension raises the gate as `ctx.ui.confirm` carrying a JSON envelope with
  the real gate identity, instead of blocking on the file-relay poll.
- The runner classifies that request by parsing the envelope, decides allow/deny instantly
  from the existing permission plan, and parks only a genuine ask.
- The parked session resumes through the existing approval-resume dispatch; the answer
  resolves the held dialog and the original call proceeds inside the original `prompt()`.
- Fail-closed everywhere: any cancellation, timeout, eviction, or transport failure blocks the
  tool; nothing ever runs unapproved.

## Non-goals

- The client-tool MCP pause (Gate 3 of the parkable-gates design). Different transport,
  separate work, gated on an unmeasured Claude client timeout.
- Harness session resume (`session/load`). Owned by the harness-session-resume project; it is
  tier 2 of the same invariant and composes with this work rather than replacing it.
- The durable interactions plane resolver (answers from other surfaces, hours later). The
  durable rows this feature writes are unchanged.
- Changing `pi-acp` upstream. The JSON envelope makes the current bridge sufficient; the
  upstream structured-metadata field is a recorded cleanup, not a dependency.
- Daytona keep-alive. The session pool does not park Daytona sandboxes today (keep-alive
  slice 3 is deferred); this feature inherits that boundary and must degrade cleanly there.

## Constraints and coordination

- **JP owns the backend warm-session move and harness session resume.** Those efforts reshape
  the same pause, park, and resume code. This implementation lands on top of, or inside, that
  work; the park record lives wherever the pool lands. Do not build against the runner-local
  pool without checking the current state of that migration first.
- **Flag-off must be byte-identical to today.** The same rule keep-alive itself follows.
- **The wire contract does not change.** The `interaction_request` event and the `/run`
  request shapes stay as they are; if any field must change, the golden-fixture procedure in
  `services/runner/CLAUDE.md` applies.

## Reading order for an implementer

1. This file, then [research.md](research.md) (the verified mechanics and every code anchor).
2. [plan.md](plan.md) (slices, deltas, the warm/cold matrix, tests).
3. The parkable-gates design and the spike report, linked above, for the full option analysis
   and raw evidence.
4. [open-questions.md](open-questions.md) before starting: two items gate slice order.
