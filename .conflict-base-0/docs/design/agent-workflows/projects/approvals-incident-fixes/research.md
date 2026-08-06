# Research findings (R1 through R8)

Every claim below was verified against the working tree on 2026-07-19 unless marked
otherwise. Paths are repo-relative. Line numbers refer to the current workspace working
tree, which has both PR stacks applied; where a file differs on an individual branch, the
difference is called out. Open risks are collected at the end and also flagged inline.

## R1. The records ingest path for a new event type

Question: can a new `interaction_response` event flow from the runner into the durable
record store and back out to the frontend without any hop rejecting it?

Answer: yes, with exactly two required code changes (one runner type, one frontend switch
case) and one recommended runner change (a stable record id). No API change is needed.

The path, hop by hop:

1. **Runner event type.** The runner's event union `AgentEvent`
   (`services/runner/src/protocol.ts:325-383`) has an `interaction_request` member
   (lines 362-367) and no answer member. A new member must be added here; TypeScript narrows
   on `type`, so nothing else in the runner needs it. The cross-language wire contract does
   NOT pin event union members: the golden fixtures pin request and result top-level keys
   only (`services/runner/tests/unit/wire-contract.test.ts`), and the Python mirror's event
   model is deliberately open ("keeps the whole event verbatim and drops a typeless event",
   `sdks/python/agenta/sdk/agents/wire_models.py:370-384`). The docstring at
   `wire_models.py:381` lists the known types for readers; add `interaction_response` to
   that list when implementing (documentation only, not enforcement).
2. **Runner emission choke point.** Events emitted via `run.emitEvent` go through the single
   `record()` choke point (`services/runner/src/tracing/otel.ts:1141-1150`), which appends to
   the batch log and forwards to the live sink. The sink on session-owned runs is the
   persisting emitter.
3. **Runner persistence.** `buildPersistingEmitter`
   (`services/runner/src/sessions/persist.ts:160-352`) posts every event to
   `POST /sessions/records/ingest` with `record_type: event.type` and the whole event as
   `attributes` (`persist.ts:59-73`). An unknown type takes the generic persist branch at
   `persist.ts:316-326` untouched. One change is recommended: the stable-id branch at
   `persist.ts:297-313` gives `tool_result` and `interaction_request` a deterministic uuid5
   record id (`stableRecordId`, `services/runner/src/sessions/record-id.ts:40-47`, keyed on
   session id, event id, and record type) so a re-sent event upserts one row instead of
   appending duplicates. `interaction_response` should be added to that branch so a retried
   resume cannot double-record an answer. Note the id is keyed by record type, so a request
   and its answer land on two distinct rows even though they share the event id.
4. **Live stream egress (not on the persistence path, but the same event reaches it).** The
   Python SDK's Vercel egress projects known event types through an `elif` ladder with no
   `else` branch (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:156-312` and
   `436-592`); an unknown type is silently skipped. So emitting `interaction_response` on
   the live stream is harmless: the live UI already knows the answer (the user just clicked
   it) and needs no projection.
5. **API ingest.** `POST /sessions/records/ingest`
   (`api/oss/src/apis/fastapi/sessions/router.py:506-536`) validates
   `SessionRecordIngestRequest` (`api/oss/src/apis/fastapi/sessions/models.py:198-211`),
   where `record_type` is `Optional[str]` and `attributes` is a free dict. It publishes to a
   Redis stream (`api/oss/src/core/sessions/records/streaming.py:51-97`, XADD at line 89);
   the records worker consumes it and calls `RecordsService.append_many`
   (`api/oss/src/tasks/asyncio/sessions/records_worker.py:149`). The DAO upserts on the
   composite primary key `(project_id, record_id)`
   (`api/oss/src/dbs/postgres/sessions/records/dao.py:86-97`); a client-supplied stable id
   is honored, otherwise a uuid4 is minted
   (`api/oss/src/dbs/postgres/sessions/records/mappings.py:17-28`). There is no enum,
   Literal, or DB constraint on the event type anywhere on this path: `record_type` is a
   nullable String column (`api/oss/src/dbs/postgres/sessions/records/dbas.py:55-58`) and
   `attributes` is unconstrained JSONB (`dbas.py:64-67`). The rows live in the `records`
   table in the tracing database (`api/oss/src/dbs/postgres/sessions/records/dbes.py:15`).
6. **API query.** The frontend hydrates from `POST /sessions/records/query`
   (`router.py:464-485`), which filters by project and session and orders by
   `created_at ASC, record_index ASC` (`records/dao.py:99-116`). No type filter.
7. **Frontend fetch and validation.** `querySessionRecords`
   (`web/packages/agenta-entities/src/session/api/api.ts:56-80`) calls the generated Fern
   client and validates with `sessionRecordsQueryResponseSchema`
   (`web/packages/agenta-entities/src/session/core/schema.ts:19-45`), where
   `record_type: z.string().nullish()` and `attributes` is an open record. An unknown event
   type passes validation unchanged.
8. **Frontend hydration.** `loadSession`
   (`web/oss/src/components/AgentChatSlice/assets/loadSession.ts:29-35`) passes rows
   straight to `transcriptToMessages`
   (`web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts`), whose
   `switch (type)` (line 87) has a silent `default: return` (lines 208-210). **This is the
   one place an `interaction_response` record is dropped today and the one required frontend
   change.**

Sweep of every other frontend narrowing over event types (none blocks the new event):

- `web/oss/src/components/AgentChatSlice/components/Inspector/timeline.ts:10-52`: a `KNOWN`
  allowlist maps unknown types to an `"other"` chip. Cosmetic only; adding
  `interaction_response` to `TimelineEventType`, `EVENT_META`, and `KNOWN` is optional.
- `Inspector/EventRow.tsx`, `Inspector/lenses/TimelineLens.tsx:26-27,114`,
  `Inspector/lenses/ContextLens.tsx:50-56`: if-chains that ignore unmatched types. No crash.
- `web/oss/src/components/AgentChatSlice/assets/AgentChatTransport.ts:74`: normalizes batch
  response blocks, not session records; unknown parts degrade to text. Not on this path.
- `web/packages/agenta-playground/`: zero matches for record event type literals. The
  playground operates on assembled message parts, not on record events.

No location was found where an unknown event type causes an error on any hop.

## R2. The frontend hydration overlay design

Question: where must answered state be injected so a rebuilt approval card renders as
answered, and how do live-session local state and rebuilt state converge?

How the two states work today:

- **Live state** is the AI SDK's `useChat` message array. `addToolApprovalResponse`
  (destructured at `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:575`,
  wrapped at lines 1034-1040) mutates the matching tool part in memory: `state` goes from
  `"approval-requested"` to `"approval-responded"` and `approval.approved` is set. Nothing
  persists this. The wrapper also sets `liveGateInteractionRef.current = true`, the marker
  that distinguishes a live click from restored state.
- **Rebuilt state** comes from `transcriptToMessages`, which constructs the card from
  `interaction_request` only (`transcriptToMessages.ts:144-176`): it finds or synthesizes
  the tool part for the gated call and stamps `state = "approval-requested"` and
  `approval = {id}` (lines 171-174). There are no answer records, so every rebuilt card is
  pending. This is the root of incident defect 4.

The decided shape: hydration must produce the SAME part shape the live path produces, so the
two states converge on identical data and every downstream consumer (dock, activity list,
resume predicate) works unchanged.

- The new event: `{type: "interaction_response", id: <interaction token>, kind:
  "user_approval", payload: {toolCallId, approved: boolean}}`. The `id` equals the matching
  `interaction_request`'s `id` (the interaction token minted at
  `services/runner/src/engines/sandbox_agent/acp-interactions.ts:587-589`), which is the
  linkage key. Field classification per the design-interfaces method: `approved` is the
  data (the verdict itself); `toolCallId` and `id` are protocol context (correlation);
  the record envelope's timestamp and credential-derived author are metadata and ride the
  record row, not the payload. No actor field is added; recording who approved is part of
  the queued audit-hardening work.
- The hydration change: a new `case "interaction_response"` in `transcriptToMessages.ts`
  that resolves the same tool part (by `payload.toolCallId`, falling back to matching
  `approval.id`) and, when the part is in `"approval-requested"`, sets
  `state = "approval-responded"` and `approval = {id, approved}`. Exactly the shape
  `addToolApprovalResponse` produces.
- Convergence rule: answered-by-record and answered-by-click are indistinguishable by shape.
  The dispatch trigger is the live click (the `liveGateInteractionRef` marker and the
  restored-tail guard at `AgentConversation.tsx:1011-1016`), never the state shape, so a
  rebuilt already-answered turn cannot re-fire a resume. A card that was answered locally
  but whose answer never reached the runner has no `interaction_response` record, so a
  rebuild correctly shows it pending again and the user can answer again; that is the
  correct recovery, since the decision existed only in lost browser memory.

The card state literals are inline AI SDK `ToolUIPart["state"]` strings, not a local union:
`"approval-requested"` is set at `transcriptToMessages.ts:172` and consumed in
`ApprovalDock.tsx:33-45`, `ToolActivity.tsx`, and `agentApprovalResume.ts`;
`"approval-responded"` is set by the SDK and consumed in the same files.

## R3. The interactions API verdict field

Question: how does the allow/deny verdict get onto the interaction row?

Today's state, verified:

- `SessionInteractionData` (`api/oss/src/core/sessions/interactions/dtos.py:24-28`) already
  has `resolution: Optional[Dict[str, Any]]` (line 28). A repo grep shows nothing ever
  writes it.
- `SessionInteractionTransition` (`dtos.py:66-70`) carries only `project_id`, `session_id`,
  `token`, `status`. The transition endpoint (`router.py:625-655`) passes it to the DAO,
  whose UPDATE sets only `status` and `updated_at`, guarded on
  `status IN ('pending','responded')`
  (`api/oss/src/dbs/postgres/sessions/interactions/dao.py:91-119`, SET at 108-111).
- The status enum (`dtos.py:16-21`) is lifecycle only: `pending`, `responded`, `resolved`,
  `cancelled`. The comment at line 17 states the verdict does not belong in it. That
  matches the design-interfaces classification: `status` is lifecycle metadata,
  `resolution` is data (the answer content), `token` and `session_id` are protocol context.
- The `data` column is JSONB and round-trips through
  `SessionInteractionData.model_validate(dbe.data)`
  (`.../interactions/mappings.py:34-36, 65`), so storing a verdict inside
  `data.resolution` needs no migration.

The specified addition (details in plan.md step 3): `SessionInteractionTransition` gains
`resolution: Optional[Dict[str, Any]]`; the transition endpoint and DAO write it into the
row's `data.resolution` when present; the runner's `resolveInteraction`
(`services/runner/src/sessions/interactions.ts:97-119`) gains the verdict payload
`{verdict: "approved" | "denied", tool_call_id}` and its callers pass the decision through
(the warm-resume loop at `services/runner/src/engines/sandbox_agent/run-turn.ts:479` and
the stored-decision path via `onResolveInteraction`,
`acp-interactions.ts:223-226` and `228-252`, where `replyPermission` already holds the
decision).

## R4. The partial-resume change

Question: what exactly must change so a resume request that answers only some parked gates
is accepted?

Today's all-or-cold rule, verified:

- The dispatch's approval branch (`services/runner/src/server.ts:663-740`) builds one resume
  decision per parked gate from the request
  (`approvalDecisionForToolCall`,
  `services/runner/src/engines/sandbox_agent/session-identity.ts:274-291`, strict tool-call
  id match on the `{approved}` envelope). Any gate without a matching decision sets
  `mismatch = "no-matching-approval"` (line 707) and the whole parked session is evicted to
  cold (lines 730-740).
- The stale-interaction sweep helper mirrors the same rule
  (`inBandAnswerTokens`, `server.ts:849-872`).
- The warm-resume turn answers every decision in a loop
  (`run-turn.ts:439-483`): seeds the trace with the parked call, grants execution for an
  approve, marks a deny, calls `respondPermission` per gate, and resolves each interaction
  row. All decisions share one held prompt promise (one prompt per turn).
- Per-turn park bookkeeping resets at every turn start (`run-turn.ts:88-95` clears
  `env.parkedApprovals`), and the re-park only happens when the pause controller fires again
  this turn (`run-turn.ts:516-520`, `server.ts:494-505` and `529-545` via `approvalToPark`,
  `server.ts:423-451`).

What "accept a partial answer set" must mean, given those mechanics:

1. **Dispatch**: a request that answers a non-empty subset of the parked gates resumes live
   with that subset. A request that answers none keeps today's behavior (evict to cold);
   changing that is the out-of-scope defect 6 work.
2. **Carried-forward gates**: the unanswered gates' `ParkedApproval` records
   (`runtime-contracts.ts:112-127`) must survive into the resume turn. The turn-start clear
   must not drop them, because the harness will NOT re-raise those permission requests: they
   are still pending inside the live process. The resume turn must re-mark their tool-call
   ids as paused (`pause.markPausedToolCall`,
   `services/runner/src/engines/sandbox_agent/pause.ts:54-57`) so their frames stay
   suppressed, and must arm the pause so the turn ends parked again after the answered
   calls' results land (the step 2 bounded wait governs when).
3. **Response stream**: the resume turn streams the answered calls' seeded `tool_call`
   frames, their real execution results, and then ends with `stopReason: "paused"`; the
   still-parked cards stay pending on the client. No eviction to cold happens.
4. **Re-park**: `reparkOrEvict` re-parks with state `awaiting_approval` because
   `env.parkedApprovals` is non-empty and the pause is active; the approval TTL re-arms
   fresh (default 5 minutes, `session-pool.ts` arms it in `park`/`repark`,
   `session-pool.ts:147-232`), and `watchParkedPrompt` (`server.ts:461-478`) re-attaches to
   the same held prompt promise; its catch-based eviction is identity-checked and idempotent,
   so re-attachment is safe.
5. **Races**: `checkoutApproval` removes the entry from the local pool
   (`session-pool.ts:126-134`), so a second answer arriving while a resume is in flight
   misses the pool and runs cold; the cold decision-map path re-raises unanswered gates and
   consumes carried envelopes, which is the safe degradation (pinned by the existing test
   "a second identical approval while the first resume is in flight",
   `tests/unit/session-keepalive-approval.test.ts:930`). The frontend dispatch (step 4)
   only fires when the chat transport is idle, so this race needs a second browser to occur.

One existing test pins the CURRENT all-or-cold behavior and must be rewritten by this
change: "keeps a partly-answered two-gate turn paused (only one card answered -> cold)"
(`tests/unit/session-keepalive-approval.test.ts:579`).

**Open question resolved during research**: the history-fingerprint check
(`server.ts:721-728`) also gates the resume. Today's full-answer resumes pass it, and a
partial-answer request differs from a full-answer request only in which `{approved}`
tool-result envelopes ride the tail. The fingerprint folds emitted tool-call ids
(`session-identity.ts:240-251`); whether it also hashes tool-result blocks was NOT
conclusively verified from `historyFingerprint`'s implementation. This is flagged as an
open risk: the implementer must confirm (or make) the fingerprint insensitive to the
presence or absence of approval envelopes, or partial resumes will spuriously evict to
cold. The dispatch-seam unit test in step 4 pins this.

## R5. The sweep replacement

Question: which open tool calls may the post-pause sweep still settle, which must it never
touch, and how is a cancellation-closure frame for a never-started call recorded?

The machinery, verified:

- The sentinel: `TOOL_NOT_EXECUTED_PAUSED` (`services/runner/src/tracing/otel.ts:66`) is
  `"DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still
  required."` The prefix is machine-read in two places: the responder keeps deferred
  results out of the client-output store (`responder.ts:491-496`, consumed at
  `responder.ts:398-401`), and the web renders deferred siblings distinctly.
- The sweep: `settleOpenToolCalls` (`otel.ts:1479-1492`) closes every tracked open call not
  excluded by the predicate and records `tool_result {isError: true}` with the sentinel.
  Two call sites, both excluding ONLY paused gates (`pause.isPausedToolCall`): the in-band
  re-sweep on every non-suppressed frame while paused (`run-turn.ts:232-237`) and the
  post-drain sweep (`run-turn.ts:505-511`).
- The result mapping: `maybeCloseTool` (`otel.ts:1446-1473`) records ANY
  `completed`/`failed` status frame as the call's result, with
  `isError: status === "failed"`. It has no notion of whether execution ever started. This
  is how the incident's never-started call got a successful `"(no output)"` result.
- Frame suppression during a pause (`shouldSuppressPausedToolCallUpdate`,
  `services/runner/src/engines/sandbox_agent/runtime-policy.ts:31-60`): paused-gate frames
  are dropped (line 44), `failed` frames for any other call are dropped as managed-cancel
  artifacts (lines 56-58), `completed` frames pass deliberately so a legitimately finishing
  auto-allowed sibling keeps its real result (comment at lines 48-55).
- Late events: once the turn's sink is cleared, between-turn events are logged and dropped
  (`services/runner/src/engines/sandbox_agent/session-events.ts:31-35`). This is what
  destroyed the incident's approved call's real result: it landed after the park.
- The drain: `pause.waitForEventDrain` is one `setImmediate` after the destroy callback
  settles (`pause.ts:27-47`), so "post-drain" is a single event-loop tick, not a bounded
  wait for results.
- The per-turn approval ledger that exists today is name-and-args keyed
  (`ApprovedExecutionGrants`, `responder.ts:85-105`), built for the relay execution guard,
  not id-keyed sweep protection. The warm-resume loop knows each approved gate's tool-call
  id (`run-turn.ts:448-483`), and the in-turn allow path knows it too
  (`replyPermission`, `acp-interactions.ts:228-252`, which receives the `toolCallId`).

The specified contract (mechanics in plan.md step 2):

- **The sweep may still settle**: a call that was announced but never started and holds no
  approval this turn; concretely, a call that is neither a paused gate nor in the new
  approved-or-allowed id set. For such a call the deferred sentinel is correct: it never
  executed, and inviting a retry is safe.
- **The sweep must never touch**: a call whose gate was answered allow this turn (warm
  resume or in-turn), or whose policy auto-allowed it. Terminalization of a paused turn
  must wait for those calls' own terminal frames, bounded per call by the existing
  per-tool-call time limit (the run-limits deadlines are retired at pause by
  `runLimits.notePaused()`, `run-turn.ts:188`, so this wait needs its own timer using the
  same configured value from `run-limits.ts`). If the bound expires, the call is settled
  with a NEW sentinel that must NOT invite a retry (execution started; a retry could double
  a side effect), and that sentinel must also be excluded from the client-output store the
  way the deferred one is (`responder.ts:398-401`).
- **Cancellation-closure detection**: while the pause is active, a `completed` frame for a
  call that required a gate (effective permission `ask` or `deny`) that was never answered
  allow CANNOT be a genuine completion, because both harness paths fail closed (Pi's
  in-process confirm allows execution only on an explicit `true`,
  `services/runner/src/extensions/agenta.ts`; Claude asks before executing). Such a frame
  is a cancellation-closure artifact and must be recorded as the deferred sentinel, not as
  success. A `completed` frame for an allow-policy call, or for a call in the
  approved-or-allowed set, keeps its real result. Buffering `completed` frames for
  unclassified calls until the drain settles (as the incident report sketches) makes the
  classification race-free against a gate that arrives in the same tick.
- **The model-transcript requirement**: every tool call the model ever sees must eventually
  carry SOME result. The design satisfies it on all three continuation paths. On a warm
  resume and on a cold native continue, the harness owns its own transcript and the
  runner's records never feed the model, so nothing is lost by holding the runner-side
  record open briefly. On the replay fallback (the only path that rebuilds the prompt from
  our records), every announced call ends the turn with exactly one of: its real result,
  the deferred sentinel (never executed), or the executed-but-unreported sentinel (bounded
  wait expired). The bounded wait plus the sweep guarantee the turn cannot end with an
  open call.

Tests that pin the current behavior and bound the change:

- `tests/unit/responder.test.ts:679` pins that a deferred sibling result never enters the
  client-output store (must keep passing; extend for the new sentinel).
- `tests/unit/sandbox-agent-orchestration.test.ts:1753` pins that two racing ask gates each
  emit a card and neither is force-settled (must keep passing).
- The test around `sandbox-agent-orchestration.test.ts:1690` pins that a non-gated sibling
  IS settled with the deferred sentinel (still correct under the new contract: that call
  held no approval).

## R6. The turn-counter fix

Question: where does the per-turn computation live, how does it behave with two pooled
environments serving one session, and how is the API-side conflict mapped?

The bug, verified end to end:

- `acquireEnvironment` computes `environment.continuityTurnIndex = nextTurnIndex(...)`
  exactly once, at acquire time
  (`services/runner/src/engines/sandbox_agent/environment.ts:962-964`).
- `nextTurnIndex` reads the process-wide `SessionContinuityStore` singleton: latest
  recorded turn plus one, or 0 for a fresh session
  (`services/runner/src/engines/sandbox_agent/session-continuity.ts:107-112`, store at
  24-99, singleton at 99).
- Warm turns bypass acquire entirely: the `hit-continue` branch calls
  `engine.runTurn(live.environment, ...)` directly (`server.ts:608-623`), and the approval
  resume branch does the same (`server.ts:742-766`), so the frozen index is re-used.
- At the end of every completed turn, `runTurn` records that index into the store and
  fires the durable append with it (`run-turn.ts:566-597`); `appendSessionTurn` POSTs
  `POST /sessions/turns/` (`session-continuity-durable.ts:157-198`).
- The API's `SessionTurnsDAO.append` is a bare add-and-commit with no IntegrityError
  handling (`api/oss/src/dbs/postgres/sessions/turns/dao.py:33-50`; the file does not even
  import `IntegrityError`), so the unique index
  `ix_session_turns_project_id_session_id_turn_index`
  (`api/oss/src/dbs/postgres/sessions/turns/dbes.py:37-43`, created by migration
  `oss000000014_add_session_turns.py:70-75`) surfaces as a 500 through
  `intercept_exceptions`.

Why moving the computation to turn start is correct, including the two-environment case:

- The store advances only on a successful `record()` (`session-continuity.ts:47-59`), and a
  paused turn deliberately never records (`run-turn.ts:567` guards on
  `stopReason !== "paused"`). So with a per-turn read, a park-and-resume cycle that spans
  several runner turns still consumes ONE conversation index, recorded once by the turn
  that completes. That is exactly the "true conversation-turn counter" semantics.
- Two pooled environments for one session (the `poolSize=2` shape from the 500 report: one
  approval-parked, one idle) both read the SAME process-wide store at their next turn
  start, so indexes stay monotonic per session, not per environment. The read-then-record
  window is not concurrent in practice: one Node process, and the local provider forbids a
  second replica serving the same session (`LocalSandboxNotOwnerError`,
  `session-continuity.ts:157-210`). A true cross-replica collision on a remote provider
  would now surface as a 409 the runner logs and drops, which is the accepted answer to the
  500 report's open retry question (retry is over-engineering today).
- Runner restarts stay correct: `acquireEnvironment` hydrates the store from the durable
  rows before the first turn (`environment.ts:941-949`,
  `hydrateHarnessSessionFromDurable`, `session-continuity-durable.ts:104-148`), and warm
  turns keep using the live in-process store.

The API-side mapping has an established in-repo pattern to copy: catch
`sqlalchemy.exc.IntegrityError`, match the constraint name, raise `EntityCreationConflict`
(`api/oss/src/core/shared/exceptions.py:4-25`), which `intercept_exceptions` converts to a
409 `ConflictException` (`api/oss/src/utils/exceptions.py:132-144`, default code 409 at
246-248). Copy targets: `api/oss/src/dbs/postgres/gateway/connections/dao.py:70-83`,
`api/oss/src/dbs/postgres/triggers/dao.py:84-108`, and the sibling
`api/oss/src/dbs/postgres/sessions/streams/dao.py:51-61`. The route is already wrapped in
`@intercept_exceptions()` (`router.py:1070`).

The dev-database wipe: every `session_turns` row written while the bug was live carries an
acquire-counter index, not a turn index, so the whole table on the dev stack is suspect and
is wiped rather than repaired. The exact operational step is in plan.md step 1.

## R7. The regression test plan

The existing orchestration harness (`tests/unit/sandbox-agent-orchestration.test.ts:35-303`)
fakes the whole stack: a scripted `session` whose `prompt()` replays `promptEvents`, raises
scripted permission requests through the registered handler, and can hang until
`destroySession` resolves it (the Claude pause shape); a fake `run` (otel) or the real
`createSandboxAgentOtel`; and a `deps` bag injected into `runSandboxAgent`/`runTurn`. The
keepalive tests add two more seams (`tests/unit/session-keepalive-approval.test.ts:1-134`):
a dispatch-level fake engine that scripts each turn's park state for `runWithKeepalive`,
and an engine-level pausable fake harness for real `runTurn` park-and-resume mechanics
(describe block at line 1260; the two-parallel-gates case at line 1537).

What is missing, and what the new tests must pin, is the real Pi shape: gates that are NOT
all known before the first pause. The shapes are specified in plan.md step 5; in summary:

- Engine seam: turn 1 announces two ask-policy calls, gates only the first, parks; the
  resume answers gate 1, the fake then emits an in-progress frame for call 1, raises gate 2
  (a second permission request DURING the resume turn), and delivers call 1's real
  `completed` frame; assertions: call 1's real result is recorded exactly once and no
  deferred sentinel ever attaches to it, gate 2 emits its own card, the turn re-parks; a
  second resume answers gate 2 and the held prompt completes; each gate received exactly
  one `respondPermission`.
- Dispatch seam: a two-gate park answered one card at a time resumes live twice and never
  degrades to cold (rewriting the all-or-cold test at
  `session-keepalive-approval.test.ts:579`).
- Records and hydration: a unit test that feeds `transcriptToMessages` a record list
  containing a `tool_call`, its `interaction_request`, and an `interaction_response`, and
  asserts the rebuilt part is `approval-responded` with the verdict; plus the negative
  case (request without response stays `approval-requested`).

## R8. Lane and PR mechanics (documentation only)

Branches, from `gh pr view`:

- PR #5382 `plan/concurrent-approvals`, GitHub base `release/v0.105.6`. In the GitButler
  workspace it is stacked on `feat/deny-frame-egress` (PR #5383's lane).
- PR #5375 `sessions-rebase/backend`, base `main`.
- PR #5376 `sessions-rebase/runner`, base `sessions-rebase/backend` (stacked on #5375's
  lane in the workspace).

File-overlap audit (from `gh pr diff --name-only` on all three PRs):

- The #5382 diff and the #5376 diff ALREADY share three files today:
  `services/runner/src/engines/sandbox_agent/run-turn.ts`,
  `services/runner/src/engines/sandbox_agent/runtime-contracts.ts`, and
  `services/runner/src/server.ts`. The two stacks are parallel (different bases), and the
  working tree holds both applied; their hunks do not conflict today.
- The planned steps keep each step's hunks on one lane, but they add more shared FILES
  across the two stacks: step 1 edits `run-turn.ts` (the turn-index region, lines 566-597)
  on the #5376 lane while steps 2 and 4 edit `run-turn.ts` (the pause and resume regions,
  lines 88-95, 163-260, 439-520) on the #5382 lane; step 3 edits
  `services/runner/src/protocol.ts` and `services/runner/src/sessions/persist.ts` (both in
  the #5376 diff) and `api/oss/src/core/sessions/interactions/dtos.py` (in the #5375 diff)
  on the #5382 stack.
- Verified feasibility of that file sharing: the regions step 3 edits are textually
  identical on both stacks (`git show plan/concurrent-approvals:...` confirms the
  `AgentEvent` union, the persist stable-id branch, and `resolveInteraction` exist
  unchanged there, at that branch's own line numbers), so the hunks route cleanly. The
  turn-index region that step 1 edits exists ONLY on the #5376 lane, so those hunks cannot
  land anywhere else.
- Because of the shared files, commits MUST follow the one-lane-at-a-time isolation
  procedure from the root `AGENTS.md` (assign exactly one lane's files, commit with
  `--only`, verify with `git show --stat` and per-lane `git diff --name-only <base>..
  <branch>` before touching the next lane). This is the top operational risk of the whole
  project and is restated in plan.md.

The note to JP (drafted in plan.md step 1) covers: what the two amendments on his lanes do,
why the dev `session_turns` rows were wiped, and the confirmed `turn_index` semantics.

## Open risks

1. **The history fingerprint under partial resumes (R4).** Not conclusively verified that
   `historyFingerprint` ignores approval tool-result envelopes; if it does not, a
   partial-answer resume would mismatch and evict to cold. The step 4 dispatch-seam test
   pins the intended behavior; the implementer must read
   `session-identity.ts`'s `historyFingerprint` before coding and adjust the park-side
   expected fingerprint if needed.
2. **Cross-stack file sharing (R8).** `run-turn.ts`, `protocol.ts`, `persist.ts`,
   `server.ts`, `runtime-contracts.ts`, and `interactions/dtos.py` are all touched by both
   this project and JP's rebase lanes. Hunk mis-routing here scrambles two open PR stacks
   at once. Mitigation is procedural (isolation commits plus per-lane diff verification),
   not structural.
3. **The cancellation-closure emitter (R5).** The exact upstream emitter of the turn-1
   closure frame (pi-acp's turn-cancellation path closing unstarted calls) is the one link
   the incident report could not pin to a line, and this research did not close it either.
   The fix does not depend on the emitter's identity (it classifies frames by policy
   evidence on the runner side), but a harness that legitimately completes an ask-policy
   call without any gate would be misrecorded as deferred. No such harness path exists
   today (both harnesses fail closed), so this is accepted and documented in the code
   comment the step 2 spec requires.
4. **`in_progress` frame coverage (R5).** The started-evidence signal (`in_progress`
   status frames) was not verified across both harnesses' real streams; the specified
   classification therefore rests on permission policy (fail-closed), with startedness as
   a reinforcing signal only. Live QA (qa.md) covers the real-stream behavior.
