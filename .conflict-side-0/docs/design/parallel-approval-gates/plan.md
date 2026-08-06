# Implementation plan

Phased so each slice lands green on its own. Phase 1 is Option A (IMPLEMENTED in this
PR, together with three companions the review pass pulled in: the FIFO decision store,
the honest replay transcript, and the FE neutral rendering); Phases 2-3 are Option B
layered on top (follow-up). Recommendation and rationale: [options.md](options.md).

## Phase 1: deterministic settle for latch losers (Option A) — IMPLEMENTED

### Code (as landed)

1. `services/runner/src/tracing/otel.ts`
   - `settleOpenToolCalls(isExcluded: (id: string) => boolean, message: string)` on the
     run handle. It sweeps the open-tool-call map (`toolSpans`, which holds exactly the
     announced calls with no terminal result), skips excluded ids, ends each open span
     with error status, and records
     `{type: "tool_result", id, isError: true, output: message}` through the shared
     `record()` choke point (live sink + batch log). Idempotent: a settled id leaves the
     map, so a second sweep is a no-op for it.
   - The message is the exported constant `TOOL_NOT_EXECUTED_PAUSED =
     "DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still
     required."`. The stable `DEFERRED_NOT_EXECUTED:` prefix is the structured sentinel
     the frontend keys its muted rendering on (shape, not tool name), and the sentence
     doubles as the model-visible retry instruction on replay.
2. `services/runner/src/engines/sandbox_agent.ts`
   - The pause controller's destroy callback calls
     `run.settleOpenToolCalls((id) => pause.isPausedToolCall(id), TOOL_NOT_EXECUTED_PAUSED)`
     first, before `mcpAbort.abort()` and `destroySession`. The paused-id set stays
     private in `PendingApprovalPauseController`; the sweep receives only the existing
     narrow membership predicate (`isPausedToolCall`), per the review note that the
     mutable set must not leak.
   - Ordering (verified in the live-sink test): `interaction_request` first (it is
     emitted before `pause()` runs), then the sibling's `tool_result` from the sweep,
     then `done`. The client always holds the sibling's terminal state before the turn
     finishes.
3. `services/runner/src/responder.ts` (companion fix, was a review finding)
   - `extractApprovalDecisions` and `ConversationDecisions.take()` now keep a FIFO list
     per `approvedCallKey`, mirroring the client-tool output store next to them. Two
     IDENTICAL gated calls (same tool, same canonical args) no longer collapse to one
     stored decision; each re-raised gate consumes the next decision in order.
4. `services/runner/src/engines/sandbox_agent/transcript.ts` (companion fix, from
   [phantom-execution-findings.md](phantom-execution-findings.md))
   - `messageTranscript` renders an `{approved: boolean}` envelope honestly:
     approved-but-not-executed calls replay as "user APPROVED <tool>; the call has NOT
     run yet. Call the tool again..." instead of `returned: {"approved":true}`, so the
     model re-issues instead of claiming phantom success. Shape detection reuses the
     now-exported `approvalDecisionOf` from `responder.ts`.

No SDK or wire change. The egress already maps `tool_result{isError}` to
`tool-output-error` (`stream.py:376-381`), and a settled part never enters the FE's
parked-unknown path (`meta.ts:64`). The frontend change in this PR (see "Frontend
neutral settle" below) is presentation-only.

### Frontend neutral settle (pulled into this PR per Mahmoud's options.md comment)

- `web/oss/src/components/AgentChatSlice/components/clientTools/UnhandledClientTool.tsx`:
  a genuinely unhandled client tool now settles with a neutral output
  (`{status: "not_handled", ...}`), not a fabricated error, and renders informational.
- `web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx`: two settled
  shapes render muted/informational instead of red "failed": an `output-error` whose
  `errorText` starts with the `DEFERRED_NOT_EXECUTED:` sentinel ("waiting on another
  approval", clock icon), and an `output-available` whose output is the
  `{status: "not_handled"}` shape. Both branch on structured shape; there is no
  tool-name list anywhere (the hard constraint holds).

### Tests (as landed)

- `sandbox-agent-orchestration.test.ts`: the primary serialized-write regression (two
  announced calls, one gate, pause -> exactly one `interaction_request` for the winner
  and one deterministic `tool_result` for the sibling, none for the winner); the
  read-only concurrent-gates race (both gates arrive, latch drops one, sweep settles
  it); the live-sink ordering test (sibling result before `done`).
- `stream-events.test.ts`: `settleOpenToolCalls` exclusion + idempotency at the otel
  level.
- `responder.test.ts`: duplicate identical approvals stay FIFO (two takes succeed, the
  third returns undefined).
- `transcript.test.ts`: approval envelopes render as APPROVED/DENIED + not-run text;
  genuine tool results keep the original rendering.
- Run `pnpm test` and `pnpm run typecheck` in `services/runner`; `pnpm lint-fix` in
  `web`.

### Verification on the live stack

Reproduce the incident: agent playground, harness `claude`, prompt that calls
`commit_revision` and `create_subscription` in one turn (the incident prompt works).
Expect: gate for A, muted "waiting on another approval" state on B, no "can't handle"
text anywhere, second gate after approving A, both tools run AND their side effects
actually exist server-side (the phantom-execution check). Use the `[HITL]` log lines to
confirm gate B arrived and was dropped post-settle.

## Phase 2: synthetic sibling gates (Option B, no drain)

### Code

1. `services/runner/src/engines/sandbox_agent.ts` (or a new
   `engines/sandbox_agent/pause-batch.ts`): at pause time, before the Phase 1 settle,
   walk unresolved sibling `tool_call`s and for each:
   - build a `GateDescriptor` (share the derivation with
     `buildGateDescriptor`, `acp-interactions.ts:238-275`; export it or lift it to a
     shared module),
   - if `decide()` (`permission-plan.ts:138-151`) returns `pendingApproval` AND the
     recorded input passes the trust check (non-empty object; refreshed at least once
     via `tool_call_update`, which Phase 2 must start tracking on the run handle),
     emit the synthetic `interaction_request` (payload shape of
     `sandbox_agent.ts:777-792`, `availableReplies: ["once","reject"]`,
     `resolvedName` stamped), `pause.markPausedToolCall(id)`, and
     `recordPendingInteraction(...)`,
   - otherwise leave it for the Phase 1 settle sweep.
2. Keep the latch semantics for harness-raised gates untouched; the batch emission
   runs once inside the pause path, guarded by the controller's `pendingApproval`
   flag (`pause.ts:22-27`).

### Tests

- Orchestration test: two announced gated calls with real args -> two
  `interaction_request` events, no synthetic `tool_result` for the second call; with
  empty args on the second call -> one `interaction_request` plus the deferred
  `tool_result` (fallback).
- `responder.test.ts` already covers multi-key decision extraction; add a case with
  two `{approved}` envelopes bound via `buildCallShapeIndex`.
- Frontend: `web/packages/agenta-playground/tests/unit/agentApprovalResume.test.ts`
  gets a two-pending-gates case (approve one -> no resume; approve both -> resume).
  The dock queue and Approve all need a manual pass (no FE code change expected).
- A replay regression test per the `agent-replay-test` skill: capture the real
  two-gate run once Phase 2 works end to end, redact, and pin it under the QA runs
  convention (`docs/design/agent-workflows/qa/runs/`).

### Verification on the live stack

Same repro. Expect: dock shows "1 of 2", Approve all leads to ONE resume and both
tools execute, deny-one/approve-one leads to one resume where the denied tool returns
the denial and the approved one runs.

## Phase 3 (optional, data-driven): pre-teardown drain

Only if Phase 2 telemetry shows the sibling args refresh frequently loses the race
(watch `[HITL] egress approval-request ... input_keys` vs the runner's recorded args):
delay `destroySession` by a bounded drain window (~100-250ms) that keeps consuming ACP
events so the full-message `tool_call_update` lands. Must be bounded and must not
delay teardown when the daemon is already gone. Skip if Phase 2 data says the race is
rare.

## Phase 4: docs sync

Per the `keep-docs-in-sync` skill, in the same PRs:

- Update the F-040 pause contract notes (`pause.ts` header comment and the
  agent-workflows documentation pages that describe pause/park) with the settle sweep
  and, after Phase 2, the batch semantics.
- Update `docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md`
  issue-2 section to point here.
- QA matrix: add the two-gate cell to the `agent-workflows-qa` matrix.

## Open questions

1. **Copy for the deferred state.** The settle text is model-visible AND user-visible.
   Proposed: "Not executed: the turn paused for approval of another tool call. Call
   the tool again if it is still needed." Good enough for the model; is it good
   enough as user-facing chip copy, or should the FE render `tool-output-error` with
   this exact constant differently? (Rendering by error TEXT is close to the
   name-list smell; probably accept plain error styling.)
2. **Pi relay parity.** The relayed-tool path returns `PAUSED` to the loser without
   checking `emitted` (`relay.ts:255-263`), unlike the builtin path
   (`relay.ts:433-446`). Pi self-announces calls through its extension, so the orphan
   shape differs. Verify whether Pi turns show the same phantom and whether the
   Phase 1 sweep (which is engine-level) already covers it.
3. **Approve all ordering.** `addToolApprovalResponse` runs per part through the job
   executor; the dock fires them in order. Confirm no double-resume when the two
   settles interleave with a slow render (the predicate should make the first call a
   no-op; verify in the FE unit test).
4. **Deny semantics in a batch.** Deny A + approve B: replay answers gate A with
   `reject`; Claude emits a failed tool_result for A and should continue to B. Confirm
   the F-024 clobber does not resurface on the replayed turn (the stored-decision
   reply path replies `reject` on a LIVE gate, which is allowed; only unanswered
   human gates must never be replied to).
5. **Read-only parallel gates.** Two `readOnlyHint: true` gated tools can raise
   truly concurrent gates (research.md §3). The latch still picks one; Phase 2's
   batch covers the other via the same sweep. No extra work expected; note it in the
   orchestration test matrix.
