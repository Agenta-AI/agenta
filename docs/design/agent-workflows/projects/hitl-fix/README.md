# HITL approval fix (QA finding F-024)

> Superseded: the permission/approval model described here was redesigned in [projects/approval-boundary/](../approval-boundary/) (2026-07). Kept as a dated record.

Human-in-the-loop (HITL) tool approval is the headline interactive feature of the agent
playground: when a tool needs a human yes/no, the run should pause, the playground should
show an inline **Run this tool? Approve / Deny** prompt, and the user's answer should resume
the run. Today that round-trip is broken end to end. The Claude permission gate fires, but
the playground never shows the prompt; the tool resolves straight to an ERROR
("User refused permission to run tool") and the run is auto-denied. Pi cannot do HITL at all,
because its only permission options are `auto` and `deny` — there is no `ask`.

This is a design-only workspace. It analyzes the full HITL path across the runner, the
protocol/stream egress, the frontend, and the Pi permission model, then proposes the
smallest-correct fix and a test plan.

## Files

- [context.md](context.md) — why this work exists, the symptom, scope, goals/non-goals.
- [research.md](research.md) — the read-only trace of all four layers, with the exact
  root cause and file/line citations.
- [plan.md](plan.md) — the proposed fix, layer by layer, with the smallest change and a
  test plan (FE + SDK + runner).
- [status.md](status.md) — current state and the open decision(s) for the user.

## TL;DR

- **Root cause (runner):** when an `ask` rule matches, the runner emits the
  `interaction_request` event AND immediately replies `reject` to the harness to "park" the
  turn. Claude turns that `reject` into a **failed tool call** ("User refused permission"),
  which the egress projects as `tool-output-error`. That error part overwrites the
  `approval-requested` part on the same `toolCallId`, so the FE shows ERROR instead of
  Approve/Deny. The park reply (`reject`) and the surface signal (`approval-requested`) are
  in conflict on the wire.
- **Fix (runner):** park WITHOUT poisoning the tool. End the turn on the parked permission
  without sending `reject` to the harness for that gate (or suppress the resulting failed
  `tool_result` so it never reaches the egress), so the last word on that `toolCallId` is the
  `approval-requested` part. Then the existing FE + egress + cross-turn resume machinery
  (already built and unit-tested) works as designed.
- **Pi HITL:** Pi declares `permissions: false` and never raises an ACP permission gate, so
  there is no `ask` to expose. Decide whether to (a) keep Pi HITL out of scope and grey out
  `ask` for Pi in the form (honest), or (b) enforce `ask` runner-side for Pi's resolved
  tools via the relay (a real but larger build, tracked separately in open-issues S5.2).
  Recommendation: (a) now, (b) as a tracked follow-up.
