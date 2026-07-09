# Pi approval parking: status

Source of truth for progress. Keep this current.

## Current state (2026-07-09)

- Phase: planned, not started. This workspace was created from the parkable-gates design
  (`../session-keepalive/followups/parkable-gates/`) after its Option C was proven by the
  live spike the same day; it ships in PR #5153 alongside that design.
- The plan is implementation-ready pending two gates: the slice-0 live daemon confidence run
  (open-questions.md #1) and a coordination check with the backend warm-session move
  (context.md, constraints).

## Decisions inherited (do not relitigate here)

- Mechanism: Option C, the ACP permission plane via `ctx.ui.confirm` plus the JSON envelope.
  Options and trade-offs live in the parkable-gates design; the evidence lives in its
  `spike-option-c/` folder. Option B (park the relay wait) is the recorded fallback if
  slice 0 fails.
- Judged by the call-sequence invariant; warm parking is the only byte-exact tier
  (kill-and-resume experiments, `../harness-session-resume/experiments/report.md`).
- Approval TTL default 5 minutes; resume validation checks decision + history + mount expiry
  (slice-2 realities, parkable-gates design "How this composes").

## Provenance

- 2026-07-09: workspace created (context, research with current code anchors, plan with four
  slices plus the slice-0 gate, open questions, this file). Research verified against
  `services/runner/src` post #5178/#5183. Two implementation-relevant findings made during
  planning, folded into plan.md: the reply-option mismatch (`decisionToReply` falls back to
  `once`/`reject`; the Pi dialog offers `yes`/`no` and needs kind-based selection), and the
  double-gate (a dialog-allowed custom tool still hits the relay watcher's
  `permissions.decide`; bridged by writing the consumed allow into the turn's stored
  decisions).

## Next steps

1. Slice 0: the live daemon confidence run (reuse the committed spike assets).
2. Coordination check with JP on where the pool/park machinery lives before slice 3.
3. Slices 1-4 per plan.md.
