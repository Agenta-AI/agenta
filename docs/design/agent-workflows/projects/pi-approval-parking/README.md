# Pi approval parking (Option C): planning workspace

Make both Pi approval gates parkable: within the keep-alive approval TTL, a human's answer
resumes the exact original tool call on the live session, the same guarantee the Claude ACP
gate got in keep-alive slice 2. The mechanism is the proven Option C of the parkable-gates
design: the gate rides `ctx.ui.confirm` with a JSON envelope through the `pi-acp` bridge and
arrives as a real ACP permission request the existing park machinery holds.

## Files

- [context.md](context.md): why this exists, the invariant, goals, non-goals, coordination
  constraints (JP's backend warm-session move), reading order.
- [research.md](research.md): the verified mechanics with current file:line anchors. How the
  two Pi gates pause today, the slice-2 park machinery being reused, where classification
  happens, what the spike proved, extension delivery and flags.
- [plan.md](plan.md): the envelope contract, five slices (0: live daemon confidence run,
  1: envelope + classification, 2: extension switch, 3: park + resume, 4: QA), the
  removed/kept/added delta table, the full warm/cold behavior matrix, rollout and
  compatibility, follow-ups, test inventory.
- [open-questions.md](open-questions.md): six questions with working defaults; #1 and #2
  gate slice order.
- [status.md](status.md): progress source of truth.

## Related

- The design this implements: [../session-keepalive/followups/parkable-gates/](../session-keepalive/followups/parkable-gates/)
  (options, trade-offs, the spike evidence under `spike-option-c/`).
- The parent feature: [../session-keepalive/](../session-keepalive/) (the pool, TTLs, the
  slice-2 approval park for Claude).
- The complementary tier: [../harness-session-resume/](../harness-session-resume/)
  (faithful continuation after the process dies; experiments under `experiments/`).
