# Status

**Phase: DECIDED and IMPLEMENTED (this PR). Option A + companions are in; Option B is a
follow-up.**

Mahmoud reviewed the plan on PR #5089 ("lgtm see comments though") and set the scope:

- **In this PR (implemented):** Option A (the runner settles latch-loser siblings with a
  deterministic `tool_result` before pause teardown), the FIFO approval-decision store
  (duplicate identical gated calls no longer collapse), the honest replay transcript for
  `{approved}` envelopes (fixes the phantom-execution bug in
  [phantom-execution-findings.md](phantom-execution-findings.md)), and the frontend
  neutral settle: unhandled client tools settle informational, and deferred siblings
  render muted ("waiting on another approval"), never as a red failure. Mahmoud's UX bar
  from the review: the UI must not be confusing; the deferred chip must read clearly.
- **Follow-up (not in this PR):** Option B, synthetic sibling gates batched into one
  pause (plan.md Phases 2-3), plus the optional pre-teardown drain if telemetry shows
  the args refresh losing the race often.

- 2026-07-06: workspace created. All mechanics verified against source (runner,
  claude-agent-acp 0.23.1, Claude Agent SDK 0.2.83 cli.js, sandbox-agent 0.4.2,
  vercel adapter, AI SDK 6.0.0-beta.150, playground).
- 2026-07-06 (later): implementation landed on the same lane per the review. See
  plan.md "as landed" sections for the exact shape.

## Decisions taken

- No frontend tool-name special-casing (Mahmoud, hard constraint). The FE rendering
  keys on structured shape (the `DEFERRED_NOT_EXECUTED:` sentinel prefix and the
  `{status: "not_handled"}` output), never on a tool name.
- F-040 core rule stays: never reply to a harness gate that needs a human.
- Option A first, Option B follow-up (Mahmoud approved this sequencing on the PR).
- The FE unhandled-client-tool neutral settle, flagged as an independent follow-up in
  options.md, was pulled into this PR on Mahmoud's comment ("let's do that in this pr
  already").

## Key verified facts driving the design

- The Claude CLI serializes gated write tools; the second gate reaches the runner
  only in the teardown race. "Wait and collect gates" is impossible; batching must
  synthesize from the runner's own tool_call record.
- Everything downstream of the runner already supports N approvals per turn: wire
  parts, AI SDK client, ApprovalDock queue + Approve all, resume predicate, ingress
  folding, multi-key decision store (now FIFO per key), cold-replay matching.
- The losing call's args can be `{}` at pause time (refresh races teardown), so
  Option B needs an args-trust guard with Option A as its fallback.

## Hotfix round (2026-07-06)

Mahmoud's live testing hit an approval loop introduced by the honest-replay fix: the
model re-issued the approved call with an object arg re-serialized as a JSON string, the
exact-args key missed, a new gate fired, and stale "NOT run yet" envelopes compounded
each resume. Fixed on the same lane with (a) JSON-normalizing canonicalization in
`approvedCallKey` (string values that parse as objects/arrays are parsed before the
stable stringify, both on stored decisions and live gates; no name-only fallback) and
(b) history-aware envelope rendering in `buildTurnText` (executed-below when a later
real result exists, the nudge only on the last unresolved envelope per tool, neutral
"approved earlier" for older duplicates, deny unchanged). Verified live: one approval,
one re-issue, decision consumed, revision landed, no repeat nudge on the next turn. Full
detail in [phantom-execution-findings.md](phantom-execution-findings.md) §"Hotfix round".

## Blockers

None.

## Next

1. Option B (plan.md Phases 2-3) as a follow-up slice: synthetic sibling gates with
   the args-trust guard, then the drain only if data demands it.
2. A replay regression capture of the two-gate scenario once Option B lands
   (agent-replay-test), pinned under the QA runs convention.
