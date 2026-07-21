# Plan: multiple simultaneous approval requests in one turn

Read [README.md](README.md) first for the shared vocabulary. Every domain word used below
(runner, harness, gate, approval card, park, latch, cold path, warm path, force-settle) is
defined there.

## Summary

When an agent tries to call several gated tools at the same moment in one turn, for example
"read these three files" where each read needs approval, the runtime shows the human only
the first approval card. It cancels the other gated calls, marks them "not executed, paused",
and lets the model ask for them again on later turns. The user sees the agent stall, approve
one thing, then loop back and ask for the next, turn after turn. GitHub issue #5373 reports
exactly this.

The cause is a deliberate one-approval-per-turn guard in the runner (the latch). Every layer
above the runner already handles more than one pending approval: the wire carries one event
per gate, the SDK emits one frame per event, and the frontend already waits for every pending
card to be answered before it resumes. Only the runner caps the count at one, and only the
warm resume path lacks a place to store more than one parked gate.

This plan removes the cap and pluralizes the two singular runner data structures, so each
gate emits its own approval card and each card is settled by its own tool-call id. It then
verifies with tests that the frontend and SDK, which are already written for the plural case,
actually work on both the cold and warm resume paths. No wire contract changes shape. The
work is runner-only for behavior, plus new tests on the frontend and SDK.

## What the user sees today

An agent turn can call more than one tool at once. Claude does this routinely: asked to read
three files, it emits three `read_file` tool calls in a single assistant turn. If those tools
are gated, the harness raises three approval gates in that one turn.

The runner handles the first gate normally: it shows the approval card and parks the turn.
For the second and third gates it does something different. It counts them, but it does not
show their cards. It force-settles them as "not executed, paused" so they do not hang as open
calls. The turn ends with one card visible.

The human approves the one card. The run resumes. The model, seeing the first tool now done
and the other two never executed, asks for them again. The runtime shows the next card. The
human approves again. This repeats once per remaining gate.

The observable result, quoting #5373: "the interaction takes additional turns and does not
behave correctly." It still finishes, but every extra gate costs a full extra round of model
call, pause, and human click.

### Where each piece of that behavior lives

All runner paths below are current on `origin/main` (verified 2026-07-18; line numbers may
drift slightly as the file changes).

- **The one-per-turn cap (the latch).** `PendingApprovalLatch`
  (`services/runner/src/permission-plan.ts:173-185`) returns `true` on its first
  `tryAcquire()` call and `false` on every later call. The runner constructs one latch per
  turn (`services/runner/src/engines/sandbox_agent/run-turn.ts:256`).
- **The card emit is guarded by the latch.** `pauseUserApproval`
  (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:152-183`) fires its
  `onUserApprovalGate` signal first (line 161), then runs `if (!latch.tryAcquire()) return;`
  (line 169) before emitting the `interaction_request` card (lines 173-183). So the second
  gate's signal is recorded but its card is never emitted.
- **The siblings are force-settled.** When the turn pauses, open gated calls that did not get
  a card are settled as `TOOL_NOT_EXECUTED_PAUSED`
  (`run-turn.ts:231-236`, and a post-drain re-sweep at `run-turn.ts:487-492`).
- **Only the first gate is remembered for a live resume.** The parked-gate record is written
  only when `env.approvalGateCount === 1` (`run-turn.ts:350-368`, the `env.parkedApproval =
  {...}` at 353-366). The record type `ParkedApproval` holds a single `permissionId`,
  `toolCallId`, and `toolName` (`runtime-contracts.ts:112-127`).
- **The warm resume path refuses multi-gate turns outright.** The keep-alive dispatch
  (`server.ts:419-437`) declines to live-park when more than one gate is pending:
  `if ((env.approvalGateCount ?? 0) > 1) { klog("multi-gate-no-park ..."); return false; }`
  (`server.ts:428-431`). Multi-gate turns fall back to the cold path.

## Why the layers above the runner are not the problem

The research trace (Question 2 of the ground-truth document) confirmed, and this plan
re-verified against `origin/main`, that everything above the runner already handles more than
one pending approval:

- **The wire already carries one event per gate.** There is no batched multi-approval frame
  and none is needed. Each gate is its own `interaction_request` with a distinct `toolCallId`.
- **The SDK already emits one approval frame per event.** In the browser-facing egress,
  `_interaction_parts` yields exactly one `tool-approval-request` chunk per `user_approval`
  event (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:708-712`). Feed it three
  events and it emits three frames.
- **The SDK ingress already keys each answer by tool-call id.** Each `approval-responded` part
  the browser sends back becomes a `tool_result` block keyed by `toolCallId`
  (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:176-206`). Many answers become
  many blocks.
- **The runner's cold-path decision store is already plural.** `extractApprovalDecisions`
  returns a `Map<string, unknown[]>`, a list of decisions per key
  (`services/runner/src/responder.ts:358-373`), and `ConversationDecisions.take` consumes one
  per key in order (`responder.ts:256-266`). The map holds many; the cold path answers them
  one gate per replayed turn.
- **The frontend already waits for every pending card.** `agentShouldResumeAfterApproval`
  finds the last freshly-answered card and then requires
  `toolParts.every(isSettledToolPart)` before it resumes
  (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:131-165`,
  the all-settled check at 163-164). A second still-pending card keeps the run paused until
  the human answers it too.
- **The parallel-park pattern already exists in the runner.** Browser-fulfilled "client"
  tools already park more than one widget in one turn. `buildClientToolRelay` deliberately
  ignores the latch and emits one widget per pending call
  (`services/runner/src/engines/sandbox_agent/client-tools.ts:176-266`). It marks each parked
  call (`markPausedToolCall`) so the force-settle sweep skips it, and it pauses the turn once
  through an idempotent `pause()`. This is the exact shape the approval path should copy.

The conclusion: the approval path is the only place that caps the count, and the warm resume
path is the only place missing a plural data structure. The frontend and SDK need no behavior
change; they need tests that prove the plural case works end to end.

## The design

Four steps. Steps 1 to 3 change the runner. Step 4 adds tests to the frontend and SDK. The
approved direction from Mahmoud is exactly these; this section elaborates them.

### Step 1: remove the one-approval-per-turn cap so each gate emits its own card

Make the approval path behave like the existing client-tool path: no latch, one card per
gate, one idempotent pause for the turn, and each parked call marked so the force-settle
sweep leaves it alone.

- In `pauseUserApproval` (`acp-interactions.ts`), delete the `if (!latch.tryAcquire())
  return;` guard (line 169). The `onPausedToolCall?.(toolCallId)` call that already runs
  (line 172) is the equivalent of the client path's `markPausedToolCall`; it keeps this gate
  out of the force-settle sweep. The pause that ends the turn is already idempotent, so N
  gates end the turn once.
- Decide what to do with `pauseClientTool`'s own latch use
  (`acp-interactions.ts:195`). This is a separate, less-used path: the ACP-gate variant of a
  client tool. Two options, decided in step 1's implementation: (a) remove its latch too, so
  it matches the primary client-tool path, or (b) leave it, because the primary client
  delivery does not go through it. Recommendation: remove it for consistency, since after
  step 1 the latch guards nothing that should be capped. See open question 1.
- The `PendingApprovalLatch` class itself (`permission-plan.ts:173-185`) becomes unused for
  approvals. Keep the class only if `pauseClientTool` still uses it; otherwise delete the
  class, its construction in `run-turn.ts:256`, and the `latch` field threaded through
  `acp-interactions.ts` and the `LatchLike` surface in `client-tools.ts:164-181`. Removing
  dead code is preferred once no caller remains.

**Contract after step 1:** the runner emits one `interaction_request` (`kind:
"user_approval"`) per ask gate in a turn, each with a distinct `toolCallId`. The turn ends
once. No force-settle happens for a gate that got a card.

### Step 2: store every parked gate, not just the first

Turn the singular parked-gate record into a collection keyed by tool-call id, so a live
resume can answer each gate.

- In `runtime-contracts.ts`, add a plural field to `SessionEnvironment`. The record type
  `ParkedApproval` (lines 112-127) stays as the per-gate shape. Change the environment to
  hold `parkedApprovals` as a `Map<string, ParkedApproval>` keyed by `toolCallId` (or an
  array; a map is preferred because resume answers arrive keyed by `toolCallId`). Keep a
  derived singular accessor only if a caller genuinely needs "the first gate" for logging.
- In `run-turn.ts` (the `onUserApprovalGate` handler, lines 350-368), record every gate into
  the map instead of only when `env.approvalGateCount === 1`. Keep `approvalGateCount` as the
  count; it now equals `parkedApprovals.size`.
- In `run-turn.ts`, adjust the force-settle early-return
  (`if (opts.approvalParkMode && env.parkedApproval) return;`, near line 178) to check "this
  tool call is in `parkedApprovals`" rather than "any single park exists".

**Contract after step 2:** the runner remembers every parked gate for the current turn,
addressable by `toolCallId`. Nothing is emitted differently; this is internal state that the
warm resume in step 3 reads.

### Step 3: let the warm resume path park a multi-gate turn and answer every gate

The warm path (keep-alive) keeps the harness process alive across the pause and delivers the
human's answer live. Today it refuses any multi-gate turn and drops to the cold path. Relax
that, and answer each parked gate by its id.

- In `server.ts` (`approvalToPark`, lines 419-437), remove the hard `approvalGateCount > 1`
  refusal (lines 428-431). Replace it with a check that the turn is fully parkable: every
  pending gate has a recorded `ParkedApproval` (a `permissionId` the harness can answer). If
  any pending gate is non-parkable, for example a client-tool MCP pause that carries no
  `permissionId`, keep the whole turn on the cold path, because the cold path is the only one
  that can multiplex a mixed set today. The existing `non-parkable-gate-no-park` branch
  (lines 424-426) already handles "no park at all"; the new check generalizes it to "not all
  gates parkable".
- The warm-park bookkeeping that reads `env.parkedApproval?.promptPromise`
  (`server.ts:448,475,510`) needs a representative promise for the parked set. Use any one
  gate's `promptPromise` for the watchdog, or gate the watchdog on "all parked promises
  settled". Decide in implementation; the simplest correct choice is to watch the set and
  evict when any parked prompt rejects. See open question 2.
- In `runtime-contracts.ts`, generalize the resume input. `ResumeApprovalInput` (lines
  129-138) answers one gate. Change the warm resume to carry a list, for example
  `ResumeApprovalInput[]` or a `{ decisions: ResumeApprovalInput[] }` batch. The server builds
  this list from the inbound responded parts, which the SDK already keyed by `toolCallId`, and
  which `extractApprovalDecisions` already returns as a map.
- In `run-turn.ts` (the live resume, `env.session.respondPermission(...)` at lines 454-457),
  iterate the parked gates. For each, look up the human's decision by `toolCallId`, and call
  `respondPermission(permissionId, reply)` once per gate. This assumes the harness holds
  several pending permission requests concurrently and answers each independently. Confirm
  this against the Claude ACP adapter during implementation and in the live test. See open
  question 3.

**Contract after step 3:** a warm resume can carry more than one decision and settle each
parked gate on the live harness session by its `permissionId`. If any gate in the turn cannot
be parked, the whole turn uses the cold path, exactly as a single non-parkable gate does
today.

### Step 4: prove the frontend and SDK handle the plural case

The frontend and SDK already read as plural. This step adds tests, and a small check that two
cards render sensibly, so the plural case is pinned and cannot regress.

- **Frontend unit test.** Feed `agentShouldResumeAfterApproval` a turn with two
  `approval-requested` parts. Assert it does not resume until both are answered, then resumes
  once both are settled. This exercises the all-settled check
  (`agentApprovalResume.ts:163-164`) with more than one card.
- **Frontend rendering check.** In the playground, confirm two approval cards in one turn
  render as two distinct, independently answerable widgets, correctly attached to their own
  tool bubbles by `toolCallId`. This is a manual live check plus, if feasible, a component
  test. It also checks the interaction with issue #5078 (see composition below).
- **SDK unit tests.** Egress: feed `_interaction_parts` two `user_approval` events, assert two
  `tool-approval-request` frames. Ingress: feed `messages.py` two `approval-responded` parts,
  assert two `tool_result` blocks keyed by their two `toolCallId`s. These pin
  `stream.py:708-712` and `messages.py:176-206` for the plural case.

## File-level change list

Behavior changes (runner):

| File | Change | Contract effect |
| --- | --- | --- |
| `services/runner/src/engines/sandbox_agent/acp-interactions.ts` | Remove the latch guard in `pauseUserApproval` (line 169); decide the same for `pauseClientTool` (line 195). | One approval card per gate; turn ends once. |
| `services/runner/src/permission-plan.ts` | Remove `PendingApprovalLatch` (lines 173-185) once no caller remains. | Dead code removed; no behavior of its own. |
| `services/runner/src/engines/sandbox_agent/run-turn.ts` | Record every gate into `parkedApprovals`; drop the `approvalGateCount === 1` condition (lines 350-368); adjust the force-settle early-return (near 178); iterate gates in the live resume (454-457). | Every parked gate remembered and answerable. |
| `services/runner/src/engines/sandbox_agent/runtime-contracts.ts` | Add `parkedApprovals: Map<string, ParkedApproval>` to `SessionEnvironment`; make the warm resume input a list. | Internal runtime contract goes plural; wire unchanged. |
| `services/runner/src/engines/sandbox_agent/server.ts` | Replace the `approvalGateCount > 1` refusal (428-431) with an "all gates parkable" check; adapt the parked-prompt watchdog to the set. | Warm path can live-park a multi-gate turn; mixed sets still fall to cold. |

Test-only changes:

| File | Change |
| --- | --- |
| `services/runner/tests/unit/...` (new or extended) | Two-gates-one-turn on the cold path and the warm path; force-settle no longer fires for a second gate; multi-answer warm resume. |
| `web/packages/agenta-playground/src/state/execution/agentApprovalResume.test.ts` | Two pending cards: no resume until both settled. |
| `sdks/python/oss/tests/pytest/unit/agents/...` | Egress two frames; ingress two keyed blocks. |
| Release gate journey spec (see test plan) | New scenario: agent calls two gated tools in one turn. |

Client-tool client-tool paths (`client-tools.ts`, `responder.ts` cold store, `transcript.ts`
resume frames) need no change. They are already plural; the plan reuses their pattern.

## What changes on the wire and in the frontend, and what stays

**Stays the same:**

- The wire event shape. One `interaction_request` with `kind: "user_approval"` per gate, each
  with its own `toolCallId`, exactly as today. We remove an artificial per-turn cap on how
  many flow; we do not add a field or a batched frame.
- The SDK frame shape. One `tool-approval-request` per event; one `tool_result` block per
  answer, keyed by `toolCallId`.
- The frontend resume rule. Wait until every pending card is answered, then resume once.
- The approve/deny envelope (`{ approved: boolean }` keyed by `toolCallId`) that the cold and
  warm paths both consume.

**Changes:**

- Runner-internal contracts only: the parked-gate record goes from one to a map, and the warm
  resume input goes from one decision to a list. These types are internal to the runner and
  its keep-alive server; they never cross the browser boundary.
- Observable behavior: a turn can now show two or three cards at once, and the warm path can
  answer them in one resume instead of forcing one gate per replayed turn.

Because the wire shape is unchanged, an older frontend paired with the new runner still works:
it renders each card as it arrives and answers each, since it already did that for the
single-card case. The improvement is that the runner now sends all the cards at once instead
of trickling them across turns.

## Test plan

**Runner unit tests.**

- Two gated tool calls in one turn: assert two `interaction_request` events emitted, the turn
  ends once, and neither gate is force-settled as `TOOL_NOT_EXECUTED_PAUSED`.
- Cold resume of a two-gate turn: assert both decisions are read from the replayed history and
  both tools run without a second re-ask.
- Warm resume of a two-gate turn: assert the dispatch live-parks (does not log
  `multi-gate-no-park`), the resume input carries two decisions, and `respondPermission` is
  called once per parked gate.
- Mixed set: one approval gate plus one non-parkable client-tool pause in one turn stays on
  the cold path (the "all gates parkable" check fails), matching today's single non-parkable
  behavior.

**SDK unit tests.** Egress emits two frames for two events; ingress emits two keyed blocks
for two answers. Add these to the existing vercel adapter test files.

**Frontend unit test.** `agentApprovalResume` does not resume with a second card pending;
resumes once both settle.

**Live playground scenario (the headline manual test).** Configure an agent whose tools are
gated with an ask rule. Prompt it to do something that calls two gated tools at once, for
example "read file A and file B" where `read_file` is gated. Confirm: two approval cards
appear together in the one turn; each is independently approvable and denyable; approving both
runs both tools and the agent continues in one resume, with no extra re-ask turns. Run this on
the cold path first, then repeat with the warm (keep-alive) path enabled, since the warm path
is the least-tested corner.

**Warm-path variant checks.** With keep-alive on: approve both cards, confirm one resume
settles both on the live session. Then a deny variant: deny one and approve the other in the
same turn, confirm the denied tool reports a decline and the approved one runs. Then a partial
answer: answer one card and leave the other pending, confirm the run stays paused (the
frontend all-settled rule holds).

**Release-gate journey spec.** Add a scenario to the agent release gate harness (the
`agent-release-gate` skill's wire-level QA harness) that drives the product endpoint with an
agent that calls two gated tools in one turn, and asserts on the SSE frame stream: two
`tool-approval-request` frames in the turn, both tool results present after the resume, and no
duplicate or re-asked approval frames in a later turn. This asserts on frames and side
effects, not model prose, so it runs against any deployment. Consider pinning the run as an
`agent-replay-test` once green.

## How this composes with in-flight work

Three pull requests touch the same files or the same wire area. This plan is written to sit
cleanly next to all three.

- **Deny-frame egress, PR #5381 (branch `feat/deny-frame-egress`).** It added a structural
  `denied` marker on the runner `tool_result` event and a `tool-output-denied` egress frame,
  so a decline renders differently from a tool breakage. It touches `acp-interactions.ts`,
  `run-turn.ts`, `protocol.ts`, `tracing/otel.ts`, and `stream.py`. This plan touches
  `acp-interactions.ts` and `run-turn.ts` too, but in different concerns: #5381 marks a
  gate's deny outcome, this plan changes how many gates emit and park. The deny marker is
  per-`toolCallId`, so it composes naturally with per-gate approval: each of two cards can be
  approved or denied, and each denied gate gets its own `tool-output-denied` frame. The
  implementer should land after #5381 or rebase onto it, and add a warm-path test that mixes
  approve and deny across two gates in one turn (listed in the warm-path variant checks above).
- **Sessions turns/streams runner, PR #5376 (branch `sessions-rebase/runner`), JP's work.**
  It rewrites the keep-alive machinery: `server.ts` (the alive watchdog becomes awaited and
  gains an `onInterrupted` abort callback, plus `streamId` threading), `run-turn.ts` (turn
  completion becomes `appendSessionTurn`), `runtime-contracts.ts`, and `protocol.ts`. This is
  the warm/keep-alive path, which is exactly where this plan's step 3 lives. The two changes
  overlap in `server.ts`, `run-turn.ts`, and `runtime-contracts.ts`. Because the warm resume
  is built on the sessions machinery, this plan's warm-path step should stack on top of the
  sessions PRs, not race them. See the rebase story below.
- **Client tools on Daytona (being planned in parallel, projects
  [daytona-gate-delivery](../daytona-gate-delivery/) and
  [mcp-client-tool-continuation](../mcp-client-tool-continuation/)).** That work adds a new
  park/resume channel so browser-fulfilled client tools can round-trip on Claude-in-Daytona.
  It shares this plan's interest in parking more than one interaction per turn, but on a
  different channel (the MCP client-tool path, not the ACP approval path). The two do not
  conflict in files. The shared invariant both must keep: the frontend all-settled rule and
  the "every pending interaction is its own widget, keyed by tool-call id" model. State that
  invariant in both plans so neither regresses it.

## Rebase story

The warm-path step (step 3) overlaps JP's sessions runner PR #5376 in `server.ts`,
`run-turn.ts`, and `runtime-contracts.ts`. Sequence the work to avoid a three-way tangle:

1. Land the cold-path-safe part of this plan first if it helps: steps 1 and 2 (remove the
   latch, pluralize the parked record) plus their tests are almost independent of the sessions
   rewrite. They change `acp-interactions.ts`, `permission-plan.ts`, and the record type. This
   can go on its own lane based on `main`, or stacked under the deny-frame lane if that lands
   first.
2. Base step 3 (the warm resume) on JP's sessions runner once it merges, or stack the
   concurrent-approvals warm lane on top of `sessions-rebase/runner` if the timing forces
   parallel work. Do not edit JP's branch. Re-home this plan's `server.ts` and `run-turn.ts`
   edits onto whatever those files look like after the sessions rewrite, since the sessions PR
   renames and moves the very functions step 3 changes (`startAliveWatchdog`, the turn
   completion path).
3. If the deny-frame PR #5381 has not merged when step 3 lands, rebase onto it too, because it
   also edits `run-turn.ts` and `acp-interactions.ts`. The concerns are disjoint, so the
   rebase is mechanical, but the two must be reconciled in one working tree before pushing.

Order to prefer: deny-frame (#5381) and sessions (#5375/#5376) land, then concurrent-approvals
steps 1 to 2, then step 3 on top of the sessions machinery. If steps 1 to 2 are ready before
sessions lands, they can go first since they do not touch the keep-alive files, and step 3
follows.

## Rollout and rollback

- **Rollout.** Steps 1 and 2 change cold-path and shared behavior and should ship together so
  a multi-gate turn shows all its cards at once even on the cold path. Step 3 improves the warm
  path and can ship in the same change or immediately after, gated behind the same keep-alive
  configuration that already controls warm resume. No new flag is required for the card-count
  change; the wire is unchanged and the frontend already handles it.
- **Rollback.** Reverting steps 1 to 2 restores the latch and the single-card-per-turn
  behavior; the frontend and SDK tolerate this because it is today's behavior. Reverting step 3
  restores the `multi-gate-no-park` refusal, so multi-gate turns fall back to the cold path,
  which still works, just with the extra re-ask turns. Each step is independently revertible.
- **Risk.** The warm resume answering several concurrent permission requests is the least
  proven behavior. The live warm-path variant checks are the gate on shipping step 3. If the
  Claude ACP adapter turns out to serialize gates rather than hold them concurrently (open
  question 3), step 3's benefit shrinks to the cold path, which steps 1 and 2 already fix.

## Non-goals

- **No relay-executed ask parking.** Giving the runner-side relay loop a way to park a
  resolved code or gateway tool that carries an ask rule is a separate, larger build tracked
  as S5.2 in [../../scratch/open-issues.md](../../scratch/open-issues.md). This plan only
  covers harness-raised ACP approval gates, which already have a park mechanism.
- **No cross-surface approval records.** Making an approval raised on one surface answerable
  from another (for example a run started by an API client and approved in the playground) is
  the multi-surface roadmap, not this plan.
- **No new client-tool channel.** Client tools on Claude-in-Daytona are the parallel
  daytona-gate-delivery work.
- **No trace-join or usage-summing change.** Issue #5097's trace continuity work is assessed,
  not owned, here (see composition and issue links).

## Open questions for review

1. **The `pauseClientTool` latch (`acp-interactions.ts:195`).** After step 1 the latch caps
   nothing that should be capped. Remove it there too for consistency, or leave that ACP-gate
   client-tool corner alone because the primary client delivery does not use it? Recommendation:
   remove, and delete the now-dead `PendingApprovalLatch` class.
2. **The warm parked-prompt watchdog with a set of gates.** The keep-alive eviction watches
   one gate's `promptPromise` today (`server.ts:448`). With several parked gates, watch any one,
   or watch the whole set and evict when any parked prompt rejects? The set is safer; confirm it
   does not over-evict.
3. **Does the Claude harness hold several permission requests concurrently in one turn?** Step
   3 assumes the ACP adapter raises multiple gates that each await their own `respondPermission`.
   Issue #5373 (parallel file reads) strongly implies yes, but this must be confirmed against the
   Claude ACP adapter and in the live test before step 3 is trusted. If Claude serializes gates
   instead, the cold-path fix (steps 1 to 2) still resolves #5373, and step 3 becomes a smaller
   optimization.
4. **Issue #5078 (approved tools appear multiple times).** Its root cause is a cold-replay
   re-mint of the `toolCallId` on resume, addressed on the frontend in PR #5058 by deduplicating
   on tool identity. Removing the multi-turn re-ask (this plan) reduces how often that resume
   re-mint happens for the multi-gate case, so it should reduce #5078 occurrences, but it does
   not replace the frontend dedup. Confirm during the live rendering check that two cards plus
   the dedup do not interact badly. Treat #5078 as assessed and likely reduced, not owned.

## Issue links

- **Plans #5373** ("HITL breaks on multi-file approval flow"). This is exactly the multi-gate
  breakage: several gated tool calls in one turn, capped to one card, re-asked across turns. The
  implementation pull request that follows this plan will close it.
- **Assesses #5078** ("Approved tools appear multiple times in chat"). Related. Root cause is a
  cold-replay `toolCallId` re-mint fixed on the frontend in #5058; this plan reduces the re-ask
  turns that trigger it but does not own the fix.
- **Assesses #5097** ("Join a turn's approval-resume requests into one trace"). Related. Fewer
  resume requests per turn touch the problem, but #5097's client-side trace replay is orthogonal
  and still needed; this plan does not subsume it.
