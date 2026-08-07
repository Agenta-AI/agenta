# Mobile approvals + steering — design & plan

**Status:** PLANNED · **Date:** 2026-07-27 · **Branch:** `feat/agenta-mobile-wave-1`
**Goal:** from a phone, on a session whose agent runs in the cloud: (1) see that a turn is
running and an approval is pending with enough context to decide, (2) approve/deny and have the
agent proceed, (3) stop, and steer where feasible — all WITHOUT being the SSE stream holder.
Raw-UI ethos applies (flows/logic, no polish). All findings below are code-trace verified
(file:line); nothing was executed live.

---

## 1. Grounded findings

### 1.1 There is no server-side session SSE to "watch" — the stream is the invoke response

The live token stream is the HTTP response of the invoke request itself: browser →
agent service (`{serviceUrl}/invoke`, SDK-served, vercel UI-message projection —
`sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`) → runner `POST /stream` NDJSON
(`services/runner/src/server.ts:908-1044`). Exactly one HTTP client per turn gets tokens.
`/sessions/*` is a coordination plane (Redis locks + Postgres rows) plus a durable
records/interactions plane; no event data flows through it live.

**The "single watcher" constraint precisely:** `ATTACH` (`POST /sessions/streams/`, no inputs +
`force` — command matrix at `api/oss/src/core/sessions/streams/service.py:90-99`) mints a
`watcher_id` and **steals** the attach lock unconditionally (`steal_attached`,
`api/oss/src/dbs/redis/sessions/locks.py:178-196`, 60s TTL), publishing on a `displaced:`
pub/sub channel that **nothing subscribes to** (verified absence). The attach lock carries **no
data** — an "attached" watcher still reads content by polling records. Two clients today:
a second SEND gets **409 `SessionTurnInUse`** (router.py:148-155); a second "watcher" silently
steals bookkeeping and neither gets the other's tokens. So "stream takeover" of live tokens is
not a thing that exists to take over.

### 1.2 Unwatched runs make progress and persist everything

For session-owned runs, client disconnect does NOT abort (`server.ts:929-947` — only sets
`clientDisconnected`; non-session runs do abort). Every stream event is persisted
producer-side regardless of listeners: `buildPersistingEmitter` POSTs each event to
`POST /sessions/records/ingest` (`services/runner/src/sessions/persist.ts:1-130`, wired
`server.ts:996-1017`) → Redis stream `streams:records`
(`api/oss/src/core/sessions/records/streaming.py:52+`) → `RecordsWorker` → Postgres. An alive
watchdog heartbeats `POST /sessions/streams/heartbeat` every 30s (`sessions/alive.ts:60-223`).

### 1.3 The approval round-trip, end to end

1. **Origination (runner):** harness permission reverse-RPC → `pauseUserApproval`
   (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:166-200`) emits stream event
   `{type:"interaction_request", kind:"user_approval", payload:{toolCallId, toolCall,
   availableReplies, options}}`, creates a durable **interactions row** (kind `user_approval`,
   status `pending`, `data.request={tool,args}` + stored workflow `references` + the turn's
   **effective config** `data.parameters` —
   `services/runner/src/sessions/interactions.ts` `buildInteractionData` →
   `POST /sessions/interactions/`), and
   the turn ends `stopReason:"paused"`. The sandbox **parks warm** in the in-process
   `SessionPool` (`awaiting_approval`, TTL `approvalTtlMs` = **5 min**,
   `session-identity.ts:31,34`; `server.ts:427-455`). After TTL: sandbox evicted, the pending
   row stays actionable for **7 days** (`interactions/dao.py:31`, 209-214).
   > **`data.parameters` (effective-turn-config plan, 2026-07-29).** The row now carries the
   > post-hydration config the gated turn was RUNNING, stamped by the SDK onto the `/run` wire
   > as `effectiveParameters` and echoed here opaquely by the runner. An out-of-band answer
   > replays it as the resume's `data.parameters`, which suppresses reference hydration and
   > reproduces the turn — without it a references-only resume runs the referenced variant's
   > HEAD revision, which for a dirty run means the wrong model, instructions and **tool
   > permissions**. A row written before this landed (or one whose config was over the 64 KB
   > stamp cap) has no `parameters` and is still answerable — it just degrades to hydration.
2. **Durable visibility (twice over):** the `interaction_request` event is a session record
   (replayable), and the interactions row is queryable via `POST /sessions/interactions/query`
   `{query:{session_id?, actionable_only:true}}` — `session_id` is OPTIONAL
   (`api/oss/src/core/sessions/interactions/dtos.py:74-81`, dao.py:185-214), so **one
   project-wide query returns every pending approval** — the list-badge primitive.
3. **Client display:** live = `approval-requested` tool part on the invoke SSE; cold =
   records replay reconstructs the same part (`@agenta/chat` `assets/transcriptToMessages.ts:196-224`
   sets `state:"approval-requested"`, `approval:{id}`) → `useApprovalDock`
   (`hooks/useApprovalDock.ts`) shows tool name + exact payload.
4. **Response (desktop today):** NOT a side-channel POST. `handleApprovalResponse` →
   AI SDK `addToolApprovalResponse` → `sendAutomaticallyWhen`
   (`agentShouldResumeAfterApproval`, approve AND deny both resume) → a **fresh
   `POST {serviceUrl}/invoke`** with the full history carrying the `{approved: boolean,
   interactionToken?}` tool_result envelope (`@agenta/chat` `hooks/useAgentConversation.ts:203-233,
   372-378`; envelope match `services/runner/src/session-identity.ts:274-291`).
5. **Runner resume:** parked match → `respondPermission("once"|"reject")` resumes the SAME warm
   sandbox (`server.ts:667-795`, `acp-interactions.ts:242-280`); no parked match (TTL expired,
   restart) → **cold replay** of the transcript where `extractApprovalDecisions` consumes the
   stored envelopes (`services/runner/src/responder.ts:368-541`). Runner then marks the row
   `resolved` via `POST /sessions/interactions/transition` (`interactions.ts:100-124`).
6. **Consequence (the load-bearing fact):** answering an approval is a plain HTTP POST that any
   authenticated client can make; the OLD stream is irrelevant (it already ended at the pause).
   Desktop proves this daily: a reload-restored `approval-requested` tail answered cold
   genuinely resumes (`useAgentConversation.ts:369-371`). **Whoever answers becomes the new
   stream holder** — the resume tokens come back as that POST's response.

### 1.4 The out-of-band respond endpoint exists but has no producer

`POST /sessions/interactions/{interaction_id}/respond` `{answer:{...}}` (router.py:767-860):
CAS `pending → responded` (exactly-once), then a taskiq worker rebuilds a
`WorkflowServiceRequest` from the row's stored `references`/`selector` with
`data.inputs = answer` and fires a **detached** invoke — nobody holds the stream
(`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:31-76`;
detached start: `api/oss/src/core/workflows/service.py:593-665`). This is purpose-built for the
mobile case. **Gap:** no call site composes `answer` anywhere; the payload contract (what
`inputs` must contain for the agent service to produce messages the runner's decision map
recognizes) is UNVERIFIED — the one true unknown in this plan.

### 1.5 A lite resume request is feasible without the workflowMolecule

`buildAgentRequest` needs the hydrated molecule (invocationUrl, draft-aware config, isDirty —
`@agenta/playground` `state/execution/agentRequest.ts:300-412`) — that's why mobile live-send was
scoped out (flows-lite fact 9). But the resolver hydrates config **server-side** when an invoke
carries `references` and NO `data.parameters`
(`sdks/python/agenta/sdk/middlewares/running/resolver.py:575-596`). Session rows already carry
the latest turn's references (WP0 R3), and the invoke URL is `{revision.data.url|uri}/invoke`
(`@agenta/entities` `workflow/state/runnableSetup.ts:246-261`) — one Fern revision fetch. So a
mobile resume can send `{session_id, references, data:{inputs:{messages}}}` and skip molecule
hydration entirely. Caveat: a run started from a DIRTY desktop draft resumes with the
committed revision's config, not the draft (references-only hydration).

### 1.6 Auth, stop, steer

- **Auth:** the invoke routing middleware accepts the `sAccessToken` **cookie** (forwarded to
  `/api/access/permissions/check` — `sdks/python/agenta/sdk/middlewares/routing/auth.py:98-116`),
  and reads `project_id` from query params. Mobile's cookie-lite auth works on `/invoke`;
  desktop's Bearer JWT is not required.
- **Stop (cancel-steer worktree, committed unmerged, 4 commits on `feat/agent-cancel-steer`):**
  warm Stop = `POST /sessions/streams/` `{session_id}` (no inputs/force ⇒ `cancel` mode:
  drop alive/running locks, `service.py:140-156`); the runner notices `is_current_turn:false`
  on its next heartbeat (≤30s worst case) → cooperative abort with `stopReason:"cancelled"`
  and `INTERRUPTED_BY_USER` on open tool calls (worktree `run-turn.ts:98-101, 751-845`,
  `tracing/otel.ts:71-76`). Plain HTTP, already wrapped as `commandSessionStream` in
  `@agenta/entities/session` (api.ts:398-421) — **directly mobile-reusable**. Without that
  branch landed, cancel still aborts the run via the pre-existing heartbeat path but settles as
  an errored turn instead of a clean "cancelled". Hard kill = `DELETE /sessions/streams/`.
- **Steer:** there is NO mid-turn message injection anywhere (verified grep, api + runner). The
  control-plane `steer` command = force-cancel the running turn + start a new one
  (`service.py:121-138`). The worktree's "Steer" is FE-only: **deny an approval with a redirect
  instruction** — deny via `addToolApprovalResponse`, then queue the note as the next prompt
  (worktree `ApprovalDock.tsx:167-244`, `AgentConversation.tsx:1073-1088`), OSS-app-only (not in
  `@agenta/chat`), flag-gated OFF (`NEXT_PUBLIC_AGENT_CHAT_STEER`) because the harness has no
  reject-with-feedback channel and the model flails on a bare deny (#5444 is the runner-level
  fix). "Steer while running" on desktop is just the client-side queue (`useAgentChatQueue`).
- **Polling precedent:** desktop's dot poll is ONE project-scoped
  `querySessionStreams({isAlive:true})`, low-priority, 15s while anything is alive, stops when
  idle, refetch-on-focus (`web/oss/src/components/AgentChatSlice/state/liveness.ts:29-45`).
  Records queries: staleTime 15s, IDB-persisted, guaranteed revalidation
  (`@agenta/entities` `session/state/records.ts:21-50`).

---

## 2. Options analysis

### A. Poll-based approval surface (no BE changes)

Mobile polls the coordination + durable planes; answers ride the same resume-invoke desktop
uses (verified non-stream). What it gives:

- **Detect:** project-wide streams poll (running badge, 1 req/15s while alive, 0 when idle —
  the desktop pattern verbatim) + project-wide `interactions/query {actionable_only:true}`
  (pending-approval badge, 1 req/poll). Open-session transcript: existing records
  revalidation. Latency to SEE an approval: one poll interval (records persist at pause time,
  so ~5-30s depending on cadence). Battery/network: two small POSTs per interval, only while
  something is alive — negligible next to one SSE held open.
- **Act:** approve/deny = records → messages (`loadSessionMessages`) + append the response +
  lite resume-invoke (§1.5). Approve→agent-proceeds latency: immediate (warm park) — the
  runner resumes the same sandbox if within 5 min; else cold replay (slower start, same
  result). Mobile receives the resume stream as the POST response — it can render it live via
  `@agenta/chat`'s own `useChat` machinery or fire-and-forget and fall back to record polling.
- **Stop:** `commandSessionStream` cancel — plain POST (≤30s cooperative latency).
- **Steer-lite:** deny-with-redirect (mirror the worktree behavior) and/or queue a message for
  after settle. Same flag caveat as desktop.
- **What breaks / rough edges:** desktop, if open, does not live-update when mobile answers —
  its reconciler adopts server transcripts only on open/revalidate and only when strictly ahead
  (`useAgentConversation.ts:303-324`); it catches up on next open or records refetch. The
  5-min warm-park TTL means most phone answers (picked up later) hit the cold-replay path —
  works, just slower.

### B. "Stream takeover"

**Not viable as imagined — there is no transferable stream** (§1.1). The attach command only
moves a 60s bookkeeping lock; it delivers zero tokens, and the displaced channel has no
subscribers, so desktop wouldn't even find out. What remains of B is already inside A: any turn
mobile INITIATES (send, approval resume) makes mobile the stream holder with live tokens for
free. Forcing takeover of a turn desktop holds would require the `steer` command = force-cancel
the running turn — destructive, not a watcher feature. Real takeover of live tokens ≈ building
C. Verdict: fold B into A ("you get live tokens for turns you start"), don't build an attach UI.

### C. Multi-watcher fan-out (the right later fix)

The producer side already exists: every event is teed through `POST /sessions/records/ingest`
which publishes to Redis (`records/streaming.py`). Honest scope:

1. **API:** publish each ingested event on a per-session channel (one addition in the ingest
   path), plus a new `GET /sessions/streams/watch?session_id=&cursor=` SSE endpoint: replay
   records from cursor (uuid7 record id = natural resume token), then follow the channel. N
   watchers, no runner changes, no lock semantics changes.
2. **Client:** an incremental records→UIMessage reducer (today `transcriptToMessages` is
   whole-log; incremental application is new FE work in `@agenta/chat`).
3. **Auth/infra:** SSE auth (cookie fine), Traefik idle-timeout sanity, heartbeat comments.

A few days of BE+FE work; also fixes desktop multi-tab and desktop-catching-up-live (§A's
rough edge). Not needed for the mobile MVP because approvals/stop/steer are all plain HTTP.

### Push notifications (future, leave a seam)

The single choke point where "approval pending" becomes durable is interaction-row creation
(`POST /sessions/interactions/` handler, router.py:597). A web-push dispatch hooks there
(row → subscription lookup → push). Do not build now; keep the mobile approval screen
deep-linkable (`/m/w/{ws}/p/{proj}/sessions/{id}`, already in the gate URL map) so a
notification later just carries a URL.

### Recommendation

**A now (two phases: read-only surface, then act), C later, B never as such.** A's polling is
the desktop's own proven pattern, its answer path is the exact POST desktop already exercises
daily, and the WP0/WP3a work already delivered every primitive it needs. Phase 2's
interactions-respond wiring (§1.4) is the only genuinely new BE work worth doing before C, and
it's small.

---

## 3. Phased task list

Raw-UI ethos throughout: plain buttons/text, no new shadcn installs, no motion. Constraints
from flows-lite apply (no OSS/EE app edits; packages allowed; operator steps written down, not
run).

### Phase M0 — see it (FE only, no BE changes)

- **M0.1** `web/mobile/src/features/sessions/useLivenessPoll.ts`: mirror
  `liveness.ts:29-45` — project-scoped `querySessionStreams({isAlive:true})`, 15s-while-alive,
  stop-when-idle, refetch-on-focus. Raw "running" text badge on `SessionRow` (flags already on
  the rows).
- **M0.2** `useActionableInteractions.ts`: project-wide
  `queryInteractions({actionableOnly:true})` (already exported from `@agenta/entities/session`,
  api/api.ts:104-129) on the same poll cadence; map `session_id → count`; raw "needs approval"
  badge on rows + a count chip on the sessions screen header.
- **M0.3** Chat screen: pending-approval card renders already via records replay
  (`buildTurnViewModels` — verify the `approval-requested` part surfaces in the raw TurnRow;
  add a raw highlighted "Approval pending" block with tool name + `JSON.stringify(input)`).
  While pending/running: poll records at 5-10s (drop to the default 15s staleTime otherwise).
  Buttons disabled with "Answer on desktop for now" until M1 lands.

### Phase M1 — act on it (FE + package work, still no BE changes)

- **M1.1** (package) `@agenta/playground` or `@agenta/chat`: `buildAgentResumeRequest({
  invocationUrl, references, sessionId, messages})` — the lite builder (§1.5): references-only
  body, no `data.parameters`, cookie-auth headers (`Accept: text/event-stream`,
  `x-ag-messages-format: vercel`), `project_id` on the query string (the middleware reads it —
  auth.py:106-116; do NOT copy desktop's Authorization-gated omission). Unit tests against the
  invariant that no `parameters` key is emitted.
- **M1.2** (package) small helper to resolve `invocationUrl` from a revision id via Fern
  (mirror `getSessionsClient` accessor pattern) + the `data.url|uri → /invoke` rule
  (runnableSetup.ts:246-261). Input: `references[0].id` off the session row / interactions row.
- **M1.3** (mobile) approve/deny actions: load fresh records → messages, stamp the
  `approval-responded` part (reuse the shape `transcriptToMessages` produces), POST the resume
  via M1.1. v1 delivery decision (open question 2): fire-and-forget + tighten the records poll
  to ~3-5s until the turn settles, OR consume the response stream with `useChat`. Raw UI: two
  buttons + "Resuming…" line. Approve-all = iterate gates (mirror `useApprovalDock.approveAll`
  semantics; all responses ride ONE resume POST since they're all parts of the same tail).
- **M1.4** (mobile) Stop button on a running session: `commandSessionStream({sessionId,
  projectId})` (cancel mode). Show "Stopping… (can take up to 30s)" and let the liveness poll
  confirm. **Dependency flag:** clean `"cancelled"` settle needs `feat/agent-cancel-steer`
  landed; before that the turn ends as an error record — acceptable raw-UI interim, note in UI
  copy.
- **M1.5** (mobile) Steer-lite, flag-gated with the SAME env flag name as desktop
  (`NEXT_PUBLIC_AGENT_CHAT_STEER`): deny-with-redirect (deny + prepend the instruction to the
  next send) — mirror the worktree's envelope exactly so the two implementations converge.
  **Dependency flag:** UX blocked on the same harness limitation; do not enable by default
  until #5444 (runner reject-with-feedback) exists.

### Phase M2 — BE: wire the out-of-band respond path (small, separable)

- **M2.1** (BE) Define + implement the `answer` contract for
  `POST /sessions/interactions/{id}/respond` (§1.4): the dispatcher must produce
  `data.inputs` such that the agent service composes a message history carrying the
  `{approved, interactionToken}` tool_result for the gated `toolCallId` (what the decision map
  reads — `session-identity.ts:274-291`). Likely: the dispatcher (not the client) loads the
  session records server-side and appends the response — keeping the client payload to
  `{approved: boolean, tool_call_id, message?}`. Add a pytest that runs the CAS + dispatch and
  asserts the runner-visible envelope. Coordinate with the sessions feature owner (JP) — the
  plumbing was built then deprioritized.
- **M2.2** (FE) Switch mobile M1.3 to `respondInteraction` (already in
  `@agenta/entities/session`, api.ts:176-199): no transcript reconstruction, no revision fetch,
  detached (nobody holds the stream — the battery-optimal path). Keep M1.3 as fallback.
- **M2.3** (BE, optional) `respond` accepts a `message` for deny-with-redirect so steer-lite
  also goes out-of-band.

### Phase M3 — BE: multi-watcher live relay (per §C; separate design doc when scheduled)

Per-session live channel published from records ingest + `watch` SSE endpoint with
record-id cursor; FE incremental records reducer in `@agenta/chat`. Benefits both mobile and
desktop multi-tab. Not gating anything above.

### Phase M4 seam — push notifications

Web-push dispatch at interaction creation; deep link to the session URL. Requires M2's respond
path for the "approve from the notification" dream, else it just opens the chat screen.

---

## 4. Open questions for Arda

1. **Stream ownership on mobile answer (v1):** answering from the phone makes the phone the new
   stream holder; an open desktop won't live-update the resumed turn (it catches up on
   reopen/refetch). Acceptable until M3? (The alternative is blocking mobile approvals on M3.)
2. **Fire-and-forget vs live-consume on approve:** consume the resume SSE on the phone (live
   tokens; dies if the phone locks — run continues regardless) or fire-and-forget + 3-5s
   records polling until settle? F&F is simpler and battery-friendlier; live feels better.
3. **Polling cadence:** desktop-mirror (15s) for list badges + 5s only while a chat screen with
   a running/pending turn is foregrounded — OK, or stricter?
4. **Steer v1 semantics:** is deny-with-redirect (behind the same off-by-default flag as
   desktop) worth shipping on mobile before the runner's reject-with-feedback (#5444), or skip
   steer entirely in v1 and ship only queue-next-message?
5. **Warm-park TTL:** most phone answers will land after the 5-min `approvalTtlMs` → cold
   replay (slower resume). Bump the TTL when a pending interaction exists, or accept?
6. **M2 ownership:** the interactions respond contract touches JP's deferred design — should M2
   be proposed to him now (it is the clean mobile path AND the push-notification prerequisite),
   or do we ship M1's resume-invoke path and wait?
7. **Always-allow:** desktop's "always allow this tool" is an app-layer config write-through —
   out of scope for mobile v1? (Approve-all within a turn IS in scope, M1.3.)

## 4b. Decisions (Arda, 2026-07-27)

1. **Stream ownership on mobile answer: ACCEPTED for v1.** ⚠️ **FOLLOW-UP (do not forget):
   M3 live relay** is the durable fix — an open desktop must eventually live-update a turn
   the phone resumed.
2. **Fire-and-forget on approve** — no live SSE consumption on the phone; poll/records
   refresh the transcript until settle.
3. **Steer-lite: WAIT** — do not ship deny-with-redirect now; wait for the runner's
   reject-with-feedback (#5444). ⚠️ **FOLLOW-UP (do not forget): Arda may ask for this
   implementation next**; the M1.5 task stays specced and unbuilt.
4. **Warm-park TTL: BUMP** when a pending interaction exists (phone-latency answers should
   warm-resume, not cold-replay).
5. **M2: build it in this workstream** ("finish this yourself") — do not hand to JP.
6. **Always-allow: out of scope** for v1 (approve-all within a turn IS in scope).

Execution scope now: M0 + M1 (minus M1.5 steer) + TTL bump + M2.

## 5. Dependencies and conflicts

- **`feat/agent-cancel-steer` (unmerged):** M1.4's clean cancel and M1.5's flag/envelope mirror
  depend on it landing; nothing here edits the same files (mobile + packages only), so no
  conflict — but land it first or accept error-shaped cancels in the interim.
- **Stale FOLLOWUP comment:** `@agenta/entities` session api.ts:392-396 ("cancel/steer would be
  a no-op stub") predates the cancel-steer branch — update when that branch lands.
- **Flows-lite T1-T6** (packages wired into mobile, sessions list, read-only replay) are the
  substrate for everything above; M0 assumes they are merged.
- **Records-poll cost:** the records query is the heavy one (~200KB on long sessions, backend
  noted slow). The M0.3/M1.3 tightened cadence must be foreground-only + only while
  running/pending; back off on `visibilitychange`.

## 6. Tracked residual: parked-session lock ambiguity (found 2026-07-28)

Live QA of approvals surfaced a dead liveness mirror in `SessionStreamsService.heartbeat`
(fixed: b0281c5788, 6761727847, 2174162d80, 5d2ed61e9f, 076dc41b7e — see the memory entry
for the full chain, incl. 1181 phantom `is_running` rows and a project sitting at 984/1000
`CONCURRENCY_LIMIT`). Two defects the review chain caught before they could bite are fixed;
ONE residual correctness gap remains and is **deliberately not hotfixed** because closing it
needs a lock-contract change mirrored on the runner side:

**The gap.** `alive` outlives its turn (`release_alive` has no callers) and a parked turn
clears `running`, so the state "`alive` held by another turn + no `running`" is genuinely
ambiguous between (a) a lapsed previous turn — the common case, which MUST be treated as a
legitimate handover or every follow-up turn aborts — and (b) a live-but-parked or
just-starting turn. We resolve it as (a). Consequence: a zombie beat from an older turn can
take the nest of a session parked awaiting approval, and the user's approval resume then
reports `is_current_turn=False` and aborts. Narrow today (`_start_turn` is off the product
path; cross-container zombies are blocked by the non-stealing `claim_owner` affinity key),
but real.

**Fix options (pick when the send/steer path gets wired):** store `alive` as
`{turn_id, state}` or add a sibling `parked:` key so a parked/starting holder is
distinguishable from a lapsed one; or give `release_alive` an actual caller so `alive` stops
outliving its turn (the root cause). Either way the runner's `startAliveWatchdog` must be
updated in lockstep.

**Also worth knowing:** `updated_at` is bumped by non-heartbeat writers (attach/detach,
rename), so watcher churn can hold an orphan's sweep clock open — now a 30-minute window for
alive-but-idle rows rather than 5.
