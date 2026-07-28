# Implementation plan

Five ordered steps. Each step is independently landable and independently testable. Read
`context.md` for why, and `research.md` for the evidence behind every mechanic referenced
here. Line numbers refer to the current workspace working tree; on the individual branches
the same regions exist at nearby lines (verified in research.md R8).

Conventions that apply to every step:

- All version control goes through GitButler (`but`), never raw git branch/commit
  commands. The repository root `AGENTS.md` documents the commands and the
  one-lane-at-a-time isolation procedure. Because this project and JP's rebase lanes share
  files (research.md R8), you MUST: assign exactly one lane's files at a time, commit with
  `but commit <lane> --only`, then verify with `git show --stat --name-only <lane>` AND
  `git diff --name-only <base>..<lane>` (base is the branch below the lane) before
  starting the next lane. If a file from another lane appears, stop and fix before
  continuing.
- Code comments explain why and invariants in one or two sentences. No session narration.
- Runner checks before every push: `pnpm test` and `pnpm run typecheck` from
  `services/runner`. API checks: `ruff format` then `ruff check --fix` from `api`, then
  the API unit tests via `cd api && py-run-tests` where a step says so. Web checks:
  `pnpm lint-fix` from `web`.
- Do not merge anything. Each step ends at green tests plus a pushed lane; merging is
  Mahmoud's action.

## Step 1: session-turns counter fix and 409 mapping

Purpose: `session_turns` appends currently 500 on every warm turn because the turn index is
computed once per environment acquire instead of once per turn, and the API treats the
resulting unique-key violation as an unknown error. After this step the index is a true
conversation-turn counter and a duplicate append reads as a 409 Conflict.

Lanes: the runner half lands on `sessions-rebase/runner` (PR #5376); the backend half lands
on `sessions-rebase/backend` (PR #5375). Both are amendments to JP's open rebase PRs, so
each half is committed to its lane and the PR bodies get a short addendum (text below).

### 1a. Runner: compute the turn index per turn

Files: `services/runner/src/engines/sandbox_agent/environment.ts`,
`services/runner/src/engines/sandbox_agent/run-turn.ts`,
`services/runner/tests/unit/session-continuity-durable.test.ts` (or a sibling unit file if
a dispatch-level test fits better there).

Contract:

- Delete the acquire-time assignment `environment.continuityTurnIndex = ...` at
  `environment.ts:962-964`. The durable hydrate call just above it (lines 941-949) stays:
  it seeds the shared store after a runner restart and must keep running at acquire.
- At the start of `runTurn` (`run-turn.ts`, alongside the per-turn resets at lines 88-95),
  set `env.continuityTurnIndex` by calling `nextTurnIndex(env.sessionId, store)` where
  `store` is `deps.sessionContinuityStore ?? sessionContinuityStore` (the same fallback the
  record call at line 572 uses). When `env.sessionId` is empty, set it to `undefined`,
  matching the old acquire-time behavior for sessionless runs.
- Add this code comment at the new computation, stating the invariant and the assumption
  (required verbatim in substance, wording may be tightened):
  "`turn_index` is a true conversation-turn counter for this session, not an acquire
  counter: it must advance once per COMPLETED turn, shared across every environment that
  serves the session. The store only advances on `record()` (a paused turn records
  nothing), so a park-and-resume cycle spanning several runner turns consumes one index.
  Computed at turn start, not at environment acquire, because a warm pooled environment
  serves many turns."
- Everything downstream is unchanged: the completed-turn record and the durable append
  (`run-turn.ts:566-597`) keep reading `env.continuityTurnIndex`.

Behavior that must hold (and be pinned by tests):

- A fresh session's first completed turn appends index 0; each later completed turn served
  by the SAME warm environment appends 1, 2, 3 in order.
- Two environments serving one session (one approval-parked, one idle, the `poolSize=2`
  shape) interleave completed turns with strictly increasing indexes, because both read
  the shared process-wide store at turn start.
- A turn that ends paused appends nothing; the resume turn that completes the same
  conversation turn appends the index the paused turn would have used.

Tests: extend `tests/unit/session-continuity-durable.test.ts` (or the orchestration test
if the seam fits better) with the three behaviors above; the two-environment case is the
one named in the 500 report's open questions. Run `pnpm test` and `pnpm run typecheck`
from `services/runner`.

### 1b. Backend: map the duplicate append to 409

Files: `api/oss/src/dbs/postgres/sessions/turns/dao.py`, plus a unit or integration test in
the API test tree if one covers the turns DAO (add a narrow one if none exists).

Contract:

- In `SessionTurnsDAO.append` (`dao.py:33-50`), wrap the add-and-commit in
  `try/except IntegrityError`. On a violation of
  `ix_session_turns_project_id_session_id_turn_index`, roll back and raise
  `EntityCreationConflict` (from `api/oss/src/core/shared/exceptions.py`) with
  `entity="Session turn"`, a message naming the session and turn index, and a `conflict`
  dict carrying `session_id` and `turn_index`. Re-raise any other IntegrityError. Copy the
  established pattern from `api/oss/src/dbs/postgres/sessions/streams/dao.py:51-61` (same
  domain) or `api/oss/src/dbs/postgres/gateway/connections/dao.py:70-83`.
- No router change: `append_turn` is already wrapped in `@intercept_exceptions()`
  (`api/oss/src/apis/fastapi/sessions/router.py:1070`), which converts
  `EntityCreationConflict` to HTTP 409 (`api/oss/src/utils/exceptions.py:132-144`).

Acceptance: POSTing the same `(session_id, turn_index)` twice returns 200 then 409, and
the API error log shows no traceback for the second call. The runner side needs no change
for this: its append helper already logs non-OK statuses as `append HTTP <status>`
(`session-continuity-durable.ts:190-192`), which becomes diagnosable on sight.

Run `ruff format`, `ruff check --fix`, and the API tests from `api`.

### 1c. Operational: wipe the wrongly numbered dev rows

Every `session_turns` row written while the bug was live carries an acquire-counter index,
so the dev table is wiped, not repaired. On the dev stack's EE database (database
`agenta_ee_core`, credentials `username:password` per the root `AGENTS.md`):

```sql
-- Inspect first: every row predating the fix is suspect.
SELECT count(*) FROM session_turns;
-- Wipe.
DELETE FROM session_turns;
```

Run this AFTER the runner fix is deployed to the dev stack, so no old runner re-inserts
wrong indexes. Effect: the next turn of any existing session cold-replays once (the
continuity lookup finds no row) and then rebuilds correct rows going forward. That is the
table's designed degradation, not data loss.

### 1d. The note for JP

Append to the PR #5376 description (and reference from #5375):

> Two amendments landed on these lanes after live QA. First, the runner computed
> `turn_index` once per environment acquire, so every warm turn re-inserted the same index
> and the append 500ed (`ix_session_turns_project_id_session_id_turn_index`); the index is
> now computed at turn start from the shared continuity store, which also fixes the
> two-pooled-environments case. We confirmed the intended semantics: `turn_index` is a true
> conversation-turn counter, and the code now carries that invariant as a comment. Second,
> the turns DAO now maps the duplicate-key IntegrityError to `EntityCreationConflict`, so a
> duplicate append reads as 409 instead of an anonymous 500. The dev database's
> `session_turns` table was wiped because every row written while the bug was live carried
> acquire-counter indexes; sessions rebuild their rows on their next completed turn.

## Step 2: stop the pause cleanup from inventing tool results

Purpose: after this step, the post-pause sweep can only settle calls that never executed
and hold no approval; an approved, executing call keeps its real result; and a
cancellation-closure `completed` frame for a never-started call is recorded as deferred,
never as success. This removes incident defects 2 and 3 and, with them, the false
"retry the same call" invitation on commands that actually ran.

Lane: `plan/concurrent-approvals` (PR #5382).

Files: `services/runner/src/engines/sandbox_agent/run-turn.ts`,
`services/runner/src/engines/sandbox_agent/pause.ts`,
`services/runner/src/engines/sandbox_agent/runtime-policy.ts`,
`services/runner/src/engines/sandbox_agent/acp-interactions.ts`,
`services/runner/src/tracing/otel.ts`, `services/runner/src/responder.ts`,
`services/runner/tests/unit/sandbox-agent-orchestration.test.ts`,
`services/runner/tests/unit/session-keepalive-approval.test.ts`,
`services/runner/tests/unit/responder.test.ts`,
`services/runner/tests/unit/pending-approval-pause.test.ts`.

### 2a. Track allowed executions by tool-call id

Add a per-turn id set of calls whose execution this turn legitimately allowed. Suggested
home: the pause controller (`pause.ts`), next to `pausedToolCallIds`, as
`allowedExecutionToolCallIds` with `markAllowedExecution(toolCallId)` and
`isAllowedExecution(toolCallId)`. Populate it from both allow paths:

- The warm-resume loop: for each `decision.reply === "once"`, mark
  `decision.toolCallId` (`run-turn.ts:463-465`, where the execution grant is already
  recorded).
- The in-turn allow path: `replyPermission` in `acp-interactions.ts:228-252` receives the
  decision and the tool-call id; on `decision === "allow"`, invoke a new optional callback
  (wired from `run-turn.ts` the same way `onPausedToolCall` is) that marks the id. This
  covers auto-allowed and stored-decision-allowed calls, which can also be mid-execution
  when a sibling gate pauses the turn.

### 2b. Exclude allowed executions from both sweeps

Both `settleOpenToolCalls` call sites currently exclude only paused gates. Change the
predicate at `run-turn.ts:232-237` (the in-band re-sweep) and `run-turn.ts:505-511` (the
post-drain sweep) to exclude a call when `pause.isPausedToolCall(id) ||
pause.isAllowedExecution(id)`.

### 2c. Let an allowed execution's real terminal frame land

Two changes:

- `shouldSuppressPausedToolCallUpdate` (`runtime-policy.ts:31-60`) currently suppresses
  every `failed` frame while the pause is active. Exempt allowed-execution ids: their real
  failure is genuine evidence and must stream through. (Their `completed` frames already
  pass.) The function needs access to the allowed set; pass the pause controller as today
  and read the new method.
- After the post-drain point (`run-turn.ts:505-511`), before the sweep runs, wait for every
  id in the allowed set that is STILL OPEN in the tracer to reach its own terminal frame.
  Expose the open-call ids from the tracer (a new `openToolCallIds(): string[]` on
  `SandboxAgentOtel`, reading `toolSpans` keys, `otel.ts:1128-1131`) and await closure with
  a bounded wait: per call, at most the configured per-tool-call limit from
  `run-limits.ts` (read the same config value; do NOT re-arm the run-limits deadlines,
  which `notePaused` retired at `run-turn.ts:188` because a human pause is legitimate).
  The turn's sink is still active during this wait, so the arriving result flows through
  `handleUpdate` and `maybeCloseTool` normally and is never dropped as a between-turns
  event.
- If the bound expires for a call, settle THAT call with a new sentinel exported next to
  the existing one in `otel.ts`:
  `APPROVED_EXECUTION_RESULT_UNKNOWN: the approved call started but its result was not
  observed before the pause ended the turn; do not assume it failed and do not retry a
  side-effecting call.` Record it as `isError: true`. It must NOT begin with the
  `DEFERRED_NOT_EXECUTED` prefix (that prefix means "never executed, retry is safe").
- Exclude the new sentinel from the client-output store the same way the deferred one is
  excluded (`responder.ts:398-401` and `491-496`): a sibling settled with either sentinel
  must never fulfill a later identical call.

### 2d. Record a never-started call as deferred, not success

While the pause is active, a `completed` frame can be a cancellation-closure artifact for a
call that never ran (incident defect 3: a `"(no output)"` success for a command that was
never approved). Classify by fail-closed policy evidence:

- Buffer `completed` frames that arrive while `pause.active` for calls that are not paused
  gates and not allowed executions, instead of letting `maybeCloseTool` record them
  immediately. Suggested seam: in `run-turn.ts`'s `handleUpdate` (lines 196-239), before
  `run.handleUpdate(update)`.
- When `pause.waitForEventDrain()` resolves (the same point the sweep runs today), settle
  each buffered frame: if its call became a paused gate during the drain, drop the frame
  (the gate's card is the last word for that call this turn); if its call became an
  allowed execution, deliver the frame (real result); otherwise, if the call's effective
  permission is `ask` or `deny` (resolve it the same way the gate descriptor does, via the
  turn's `permissionsFromRequest` plan and `toolSpecsByName`, both already in scope in
  `runTurn`), record the deferred sentinel `TOOL_NOT_EXECUTED_PAUSED` for it, because a
  fail-closed gate that was never answered allow cannot have executed; if the effective
  permission is `allow`, deliver the frame (an auto-allowed sibling that legitimately
  finished).
- Carry a code comment stating the invariant: "Execution of an ask-policy call requires an
  answered allow; both harness gate paths fail closed. A completed frame during a pause
  for an unanswered ask-policy call is therefore a cancellation-closure artifact, not
  evidence of execution."

### 2e. Model-transcript guarantee

Add one assertion-level check (a debug log is enough, a throw is not wanted): at
terminalization of a paused turn, after the sweep, the tracer holds no open calls except
paused gates. Combined with 2c and 2d this preserves the requirement that every tool call
the model ever sees eventually carries some result on the replay-fallback path, and the
warm and cold-native paths never consume runner-side records (research.md R5).

### Acceptance criteria for step 2

- Existing tests still pass, specifically `sandbox-agent-orchestration.test.ts:1753` (two
  racing gates both card, neither settled), the non-gated-sibling settle test around
  line 1690, and `responder.test.ts:679`.
- New unit tests pin: (1) an allowed-execution call is never stamped with
  `TOOL_NOT_EXECUTED_PAUSED` by either sweep; (2) its real `completed` frame arriving after
  the pause but before terminalization is recorded as its result; (3) its real `failed`
  frame is not suppressed; (4) the bounded wait expiring records the
  `APPROVED_EXECUTION_RESULT_UNKNOWN` sentinel and neither sentinel enters the
  client-output store; (5) a `completed` frame during a pause for an unanswered ask-policy
  call is recorded as `TOOL_NOT_EXECUTED_PAUSED`, while the same frame for an allow-policy
  call keeps its real result.
- Test commands: `cd services/runner && pnpm test && pnpm run typecheck`.

## Step 3: persist the answer half of every gate

Purpose: after this step, every resolved gate leaves two durable traces: an
`interaction_response` event in the session records stream, and the allow/deny verdict in
the interaction row's `resolution` field. Frontend hydration overlays answers onto
requests, so a rebuilt conversation renders answered cards as answered. This removes
incident defect 4 and the rebuild half of defect 1.

Lane: `plan/concurrent-approvals` (PR #5382). Note that `protocol.ts`, `persist.ts`, and
`api/oss/src/core/sessions/interactions/dtos.py` are also touched by JP's lanes in the
other stack; the regions edited here are identical on both stacks (research.md R8), but
follow the isolation commit procedure strictly.

### 3a. Runner: the new event and its emission

Files: `services/runner/src/protocol.ts`, `services/runner/src/sessions/persist.ts`,
`services/runner/src/engines/sandbox_agent/run-turn.ts`,
`services/runner/src/engines/sandbox_agent/acp-interactions.ts`,
`services/runner/src/sessions/interactions.ts`.

Contract:

- Add to the `AgentEvent` union (`protocol.ts`, next to `interaction_request` at
  lines 362-367):

  ```ts
  // The durable answer half of an interaction_request, emitted when the runner forwards
  // a human decision to the harness. `id` equals the matching request's id. Hydration
  // overlays it so a rebuilt conversation shows the gate as answered.
  | {
      type: "interaction_response";
      id: string;
      kind: "user_approval";
      payload?: unknown;
    }
  ```

  Payload for `user_approval`: `{toolCallId: string, approved: boolean}`. No actor field
  (audit actor identity is queued work; the record row's credential-derived metadata is the
  interim signal). Also add `interaction_response` to the documented known-types list in
  `sdks/python/agenta/sdk/agents/wire_models.py:381` (a docstring, not enforcement; the
  Python event model is an open union and needs no code change).
- Emit it at the ONE convergence point both answer paths share. In `run-turn.ts`,
  `resolveInteractionToken` (lines 287-296) is called by the warm-resume loop (line 479)
  and wired as `onResolveInteraction` into the gate handler (line 323), which fires it
  from `replyPermission`/`replyClientTool` after a successful harness reply
  (`acp-interactions.ts:223-226, 251, 271`). Extend the signature to carry the verdict and
  the tool-call id: `resolveInteractionToken(token, {approved, toolCallId})`. Callers:
  the resume loop derives `approved` from `decision.reply === "once"` and has
  `decision.toolCallId`; `replyPermission` has `decision` and `toolCallId`;
  `replyClientTool` resolves client-tool interactions, which have no allow/deny verdict,
  so it passes no verdict and 3a emits nothing for it (client tools get their answer
  recorded as the tool result itself). Inside the function, alongside the existing
  `resolveInteraction` POST, call `run.emitEvent({type: "interaction_response", id: token,
  kind: "user_approval", payload: {toolCallId, approved}})`. `run` is in scope in
  `runTurn`; pass it in or close over it.
- Give the event a stable record id so a retried resume upserts one row: extend the
  stable-id branch in `persist.ts` (lines 297-313) to include `interaction_response`
  (keyed by the event's `id`, which is the interaction token, and the record type, via
  the existing `stableRecordId`).
- The live stream also carries the event; the Python Vercel egress ignores unknown types
  by construction (no `else` in its ladder) and the web ignores unknown record types
  outside the hydration switch, so no egress change is needed.

### 3b. Backend: the verdict on the interaction row

Files: `api/oss/src/core/sessions/interactions/dtos.py`,
`api/oss/src/apis/fastapi/sessions/models.py`,
`api/oss/src/apis/fastapi/sessions/router.py`,
`api/oss/src/dbs/postgres/sessions/interactions/dao.py`, plus the interactions service and
interface files if they type the transition.

Contract:

- `SessionInteractionTransition` (`dtos.py:66-70`) gains
  `resolution: Optional[Dict[str, Any]] = None`. Field classification: `resolution` is
  data (the answer content), `status` stays lifecycle metadata, `token`/`session_id` stay
  protocol context. The transition request model in `models.py` gains the same field, and
  `transition_interaction` (`router.py:625-655`) passes it through.
- The DAO's transition UPDATE (`dao.py:91-119`) additionally writes the verdict into the
  row's `data.resolution` when the transition carries one, without clobbering the rest of
  `data` (use a JSONB set on the `resolution` key, or a read-modify-write inside the same
  guard; the guard `status IN ('pending','responded')` is unchanged). A transition without
  `resolution` behaves exactly as today.
- Resolution payload written by the runner:
  `{"verdict": "approved" | "denied", "tool_call_id": <id>}`. Full words, no
  abbreviations.
- Runner side: `resolveInteraction` (`services/runner/src/sessions/interactions.ts:97-119`)
  gains an optional `resolution` argument and includes it in the POST body when present.
  `resolveInteractionToken` (3a) passes it.

Acceptance: after an approval, `GET /sessions/interactions/{id}` returns the row with
`status: "resolved"` and `data.resolution == {"verdict": "approved", "tool_call_id": ...}`.
A transition without resolution leaves `data` untouched. Run the API formatters and tests.

### 3c. Frontend: the hydration overlay

Files: `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts`, plus a unit
test colocated per the web testing conventions, and optionally
`web/oss/src/components/AgentChatSlice/components/Inspector/timeline.ts` (add
`interaction_response` to `TimelineEventType`, `EVENT_META`, and `KNOWN` so the Inspector
shows it as a first-class row instead of an "other" chip).

Contract:

- Add `case "interaction_response"` to the switch (line 87). Resolve the target tool part
  with the same id-resolution the request case uses (lines 151-153): prefer
  `payload.toolCallId`, fall back to a part whose `approval.id` equals the event's `id`.
  When the part's `state` is `"approval-requested"`, set `state = "approval-responded"`
  and `approval = {id: <event id>, approved: <payload.approved>}`. When the part has
  already advanced past the request state (for example the executed call's
  `output-available` overwrote it), do nothing; execution states supersede answer states.
- The produced shape must be byte-identical in structure to what the live
  `addToolApprovalResponse` produces, so the dock, the activity list, and the resume
  predicate treat rebuilt and live states identically (research.md R2).
- The rebuilt answered card must not re-trigger any dispatch: dispatch fires only from live
  clicks (the `liveGateInteractionRef` marker in `AgentConversation.tsx:1034-1040` and the
  restored-tail guard at lines 1011-1016 stay authoritative). Add nothing that sends
  network requests from hydration.

Acceptance: a unit test feeds `transcriptToMessages` a record list containing a
`tool_call`, its `interaction_request`, and an `interaction_response` with
`approved: true`, and asserts the resulting part is `approval-responded` with
`approval.approved === true`; the negative case (no response record) stays
`approval-requested`; a response arriving after the call's `tool_result` leaves the
executed state untouched. Run `pnpm lint-fix` in `web` and the affected unit tests.

## Step 4: per-card dispatch and partial answer sets

Purpose: after this step, one click sends one answer. The frontend dispatches an approval
the moment the user answers a card, without waiting for sibling cards, and the runner
accepts a resume that answers a subset of the parked gates: it answers those, streams
their real results, and parks again on the rest. This removes incident defect 1's
dispatch half (the rebuild half fell to step 3).

Lane: `plan/concurrent-approvals` (PR #5382).

### 4a. Runner: accept a partial answer set

Files: `services/runner/src/server.ts`,
`services/runner/src/engines/sandbox_agent/run-turn.ts`,
`services/runner/src/engines/sandbox_agent/runtime-contracts.ts`,
`services/runner/tests/unit/session-keepalive-approval.test.ts`.

Contract (the mechanics are in research.md R4):

- Dispatch (`server.ts:663-740`): building `resumeDecisions`, a gate without a matching
  decision is no longer a mismatch. Split the parked set into `answered` (decisions built
  as today) and `carriedForward` (the untouched `ParkedApproval` records). Resume live
  when `answered` is non-empty; keep every other mismatch (unrecognized gate type, edited
  history, expired mount) and the zero-answers case exactly as today (evict to cold).
  Pass both sets to the engine:
  `opts.resume = {decisions, carriedForward}` (extend `RunTurnOptions` in
  `runtime-contracts.ts:141-167`).
- `inBandAnswerTokens` (`server.ts:849-872`): spare from the stale-interaction sweep the
  tokens of the ANSWERED gates only. Carried-forward gates stay pending on the
  interactions plane, and they now survive because the resume re-parks them (the comment
  block there describing the all-or-cold rule must be rewritten to match the new
  behavior).
- Resume turn (`run-turn.ts`): the turn-start clear (lines 88-95) currently empties
  `env.parkedApprovals`. On a resume with carried-forward gates, re-seed the map with them
  after the clear, restore `env.approvalGateCount` to the map's size, and call
  `pause.markPausedToolCall(gate.toolCallId)` for each so their frames stay suppressed
  (the harness will not re-raise these gates; they are still pending inside the live
  process). After the answer loop (lines 448-483) finishes and carried-forward gates
  remain, arm the pause (`pause.pause()`): the turn then ends parked once the answered
  calls' results have landed (the step 2 bounded wait governs that), and the existing
  re-park path (`reparkOrEvict` via `approvalToPark`, `server.ts:423-451, 517-559`)
  re-parks in `awaiting_approval` with a fresh approval TTL, and `watchParkedPrompt`
  re-attaches to the shared prompt promise (safe: identity-checked and idempotent).
- A new gate raised DURING the resume (the incident's exact shape: Pi serializes confirms,
  so gate 2 surfaces only after gate 1 is answered) needs no new handling: it fires
  `onUserApprovalGate` normally, joins `env.parkedApprovals` next to the carried-forward
  records, and pauses the turn itself.
- Verify the history fingerprint is insensitive to which approval envelopes ride the
  request (research.md open risk 1). Read `historyFingerprint` in
  `session-identity.ts` first; if it hashes tool-result blocks, adjust the park-side
  expected fingerprint so a partial answer still matches, and pin it in the dispatch
  test.

### 4b. Frontend: dispatch per card

Files: `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts`,
`web/packages/agenta-playground/tests/unit/agentApprovalResume.test.ts`, and
`web/oss/src/components/AgentChatSlice/AgentConversation.tsx` only if the guard wiring
needs it.

Contract:

- `agentShouldResumeAfterApproval` (`agentApprovalResume.ts:131-165`) currently requires
  EVERY tool part settled (`allSettled`, line 163). Replace that final condition: resume
  when there is at least one freshly answered approval (the existing
  "last freshly-resolved parked interaction" detection at lines 146-150) that no
  `step-start` part follows (the existing already-resumed guard at lines 158-161), even
  if sibling cards are still `approval-requested`. Client-tool results keep their
  existing all-settled requirement if relaxing it is unsafe for them; this project's
  scope is approval cards.
- The AI SDK evaluates this predicate on message updates and does not send while a stream
  is in flight, so an answer clicked during a streaming resume dispatches when that
  stream finishes. State this in a comment; it is the concurrency contract.
- The restored-tail guard stays: a rebuilt conversation whose answers came from
  `interaction_response` records must not auto-fire (step 3c). Only a live click flips
  `liveGateInteractionRef` and produces a "freshly" answered part.
- "Approve all" in the dock (`ApprovalDock.tsx:160-164`) loops the responses
  synchronously; the predicate then fires once with every card answered, which the runner
  handles as a full set. No dock change.

### Acceptance criteria for step 4

- Dispatch-seam test (rewrite `session-keepalive-approval.test.ts:579`): a two-gate park
  answered one card resumes live (never cold), answers exactly that gate's
  `permissionId`, re-parks in `awaiting_approval` with the second gate carried forward,
  and a second request answering the second card resumes live again and completes the
  turn. A request answering zero gates still evicts to cold.
- Engine-seam test: a resume with one answered and one carried-forward gate marks the
  carried-forward call paused (its frames suppressed), ends parked, and never settles it
  with any sentinel.
- Frontend unit test: the predicate fires with one answered card and one pending card;
  does not fire when a `step-start` follows the answer; does not fire on a rebuilt
  conversation with no live click.
- Test commands: `cd services/runner && pnpm test && pnpm run typecheck`; web package
  tests per `web/AGENTS.md` for `agenta-playground`; `pnpm lint-fix` in `web`.

## Step 5: the incident regression test, then live QA

Purpose: pin the exact incident shape end to end, then verify the deployed behavior by
hand.

Lane: `plan/concurrent-approvals` (PR #5382) for the tests; QA is not a code change.

### 5a. The incident regression test

File: `services/runner/tests/unit/session-keepalive-approval.test.ts` (engine seam, the
pausable fake harness of the describe block at line 1260, extended), or a new sibling
file if it grows large.

Script the exact db58551b shape:

1. Turn 1: the fake harness announces two ask-policy calls `tool-a` and `tool-b`
   (`sessionUpdate: "tool_call"` events), raises the permission request for `tool-a`
   ONLY, and hangs the prompt. Expect: one `interaction_request` for `tool-a`; `tool-b`
   is settled with `TOOL_NOT_EXECUTED_PAUSED` (announced, never gated, never started; it
   holds no approval, so the sweep may settle it); the turn parks with one gate.
2. If the fake emits a cancellation-closure `completed` frame for `tool-b` during the
   park (add this to the script), expect the deferred sentinel, NOT a success record.
   This pins defect 3.
3. Resume 1 (approve `tool-a`): the fake answers the `respondPermission`, emits an
   `in_progress` frame for `tool-a`, then raises the permission request for `tool-b`
   (the gate that surfaces DURING the warm resume), then emits `tool-a`'s real
   `completed` frame with distinctive output. Expect: `tool-a`'s real result recorded
   exactly once, no sentinel ever attached to it (defect 2 pinned); an
   `interaction_request` card for `tool-b`; an `interaction_response` event for `tool-a`
   with `approved: true` (step 3 pinned); the turn re-parks on `tool-b`.
4. Resume 2 (approve `tool-b`): the fake answers, emits `tool-b`'s real `completed`
   frame, and resolves the held prompt. Expect: `tool-b`'s real result exactly once, its
   `interaction_response`, and a completed turn.
5. Global assertions: each permission id received exactly one `respondPermission` (the
   "both side effects exactly once" proxy at this seam), and the final event log contains
   exactly one real result per call and no success record for any never-started state.

### 5b. The records and hydration regression test

As specified in step 3c's acceptance criteria, plus one round-trip-shaped case: build the
record list in the exact order the runner persists during the incident shape (user
message, tool_call a, interaction_request a, tool_result b deferred, interaction_response
a, tool_result a real, interaction_request b) and assert the rebuilt messages show call a
executed with its real output, call b's card pending, and no card flipped back to
waiting. This is the state-rebuild half of the incident.

### 5c. Live QA

Run the script in `qa.md` against the dev stack after all lanes are deployed, record the
MP4, and post it as a PR comment on #5382. Then re-run the release-gate approval cells
listed there.

## Landing order and dependencies

The steps are ordered by user-facing severity and by dependency:

1. Step 1 is independent of everything else and unblocks JP's PR stack; land first.
2. Step 2 is self-contained in the runner and makes results truthful; step 4's partial
   resume DEPENDS on its bounded wait for the "answered call finishes before the re-park"
   behavior, so land 2 before 4.
3. Step 3 is independent of 2 (different regions) and is what makes step 4's frontend
   guard sound after a rebuild; land 3 before 4.
4. Step 4 last among the code steps, then step 5's tests can pin the full behavior (its
   sub-assertions on sentinels and answer events need 2 and 3 in place).

Each step is a separate commit (or small commit series) on its lane so review can bisect.
