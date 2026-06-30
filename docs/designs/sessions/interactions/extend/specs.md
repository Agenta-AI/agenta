# Extend interactions: make the domain functional and testable end to end

## Problem

The interactions API is fully built but nothing produces interactions, so the domain is
untestable. When a session-owned (HITL) turn hits a permission gate, the runner `park`s
the turn and emits an `interaction_request` only on the messages plane
(`services/agent/src/engines/sandbox_agent.ts`, `responder.ts`). It never calls the
interactions API, so the `session_interactions` table stays empty and the inspector's
Interactions tab is always empty. The respond / query / transition endpoints have no data
to act on.

## Goal

Whenever a human-in-the-loop interaction is raised, do BOTH: emit the messages-plane
`interaction_request` event AND create a row via the interactions API. Headless `/invoke`
keeps its inline policy answer (auto / allow / deny) and does NOT create a row (no human,
nothing to resolve). Then make the inspector usable: a Refresh button on all five tabs,
and an Interactions tab that shows the full interaction and can respond with the correct
shape.

Kinds are `user_approval`, `user_input`, `client_tool`. This is a SINGLE vocabulary used
end to end: the runner emits `interaction_request` events with these kinds (renamed from
the old egress wire vocab `permission`/`input`), the interactions domain persists them, and
each output adapter maps them to ITS wire at the edge (the Vercel egress projects
`user_approval -> tool-approval-request`, `user_input -> data-input-request`). Vercel's
naming is quarantined in the Vercel adapter; nothing else speaks it. (`tool_call` was also
renamed to `client_tool`; a possible later rename to "callback tool" is deferred to the
big-agents agent-template audit.) Permission is the only kind the harness raises today, so
`user_approval` is the only live producer now; `user_input` / `client_tool` producers are
stubbed against the same helper and light up when those harness kinds land.

## Key constraint, and the resolution (IMPLEMENTED)

`create_interaction` / `transition_interaction` were originally **admin-only**
(`request.state.admin`, `project_id` in the body), on a `/admin/sessions/interactions`
router. The runner authenticates AS the invoke caller (a run credential, not admin), so it
could not call them — it would 403.

The session admin endpoints were a relic of an early assumption that the runner would use
admin auth. It does not (records-ingest and streams-heartbeat already use credential auth).
So the decision was: **drop ALL session admin routers** (streams, records, interactions —
the streams/records ones were already dead with zero routes) and make the interaction
write endpoints credential-authed, mirroring `ingest_record_event`:

- `create_interaction` and `transition_interaction` live on the public `router`
  (`/sessions/interactions/`), gate on `Permission.RUN_SESSIONS`, resolve
  `project_id`/`user_id` from `request.state`.
- The wire request models carry NO `project_id` (the auth middleware always sets it on
  state for a credentialed call, so the body never needs it). The internal DTOs keep
  `project_id` required; the handler fills it from state before constructing them.
- `create_interaction` is idempotent on `(project_id, session_id, token)` at the DAO layer
  (catches the unique-constraint violation, returns the existing row).
- There is NO separate `ingest_interaction` endpoint. `create_interaction` IS the
  runner-callable endpoint now.

### Respond is always a detached message invoke — the answer is one message in `inputs.messages`

Resolving an interaction is NOT a status transition. Agent invoke is always
messages-based and always detached: `respond_interaction` enqueues onto
`worker-interactions` (the `respond_task`), which fires `invoke_workflow` detached. The
dispatcher (`interactions_dispatcher.py`) does `inputs = answer` (when answer is a dict)
and invokes with `WorkflowServiceRequestData(inputs=inputs)`. So the answer the inspector
sends must be shaped as the workflow's `inputs`, and for an agent that means a single
message in `inputs.messages`:

```text
answer = { "messages": [ <one UIMessage> ] }
```

A bare `{decision: "allow"}` or `{input: "..."}` is WRONG — it lands as `inputs` with no
`messages`, so the detached agent invoke has nothing to run on. The current
InteractionsTab sends the bare dict and must be corrected.

Use the NEUTRAL agenta message format, not the Vercel UIMessage shape. The respond path
(`interactions_dispatcher.py`) passes `inputs = answer` straight to `invoke_workflow`
without negotiating a wire format, and the runner's neutral `ChatMessage` carries
`content` as string or `ContentBlock[]` (`services/agent/src/protocol.ts`). The Vercel
`parts` / `tool-approval-response` shape only applies when an invoke negotiates the Vercel
adapter, which this path does not. So send agenta-neutral messages; the runner reads them
directly.

The single message's shape depends on kind:

- `user_input`: an ordinary user message — `{role: "user", content: <typed text>}`.
- `user_approval`: NOT free text. The runner resolves a parked approval from a
  `tool_result` content block keyed by the gated `toolCallId` carrying `{approved: bool}`
  (`responder.ts` `extractApprovalDecisions`). In neutral form that is
  `{role: "user", content: [{type: "tool_result", toolCallId: <token>, output: {approved}}]}`,
  with `token` = the interaction token (= the gated tool-call id). NOT `{decision: ...}`,
  and NOT a Vercel `parts` envelope.

This is the corrected respond contract, IMPLEMENTED in InteractionsTab:
`approvalAnswer(token, approved)` builds the neutral `tool_result` message and
`inputAnswer(text)` builds the neutral user text message. The earlier `{decision}`/`{input}`
shapes were replaced. (If a future invoke path negotiates Vercel, translate at that
boundary — the inspector still speaks neutral.)

## Behavior

### Runner

- New module `services/agent/src/sessions/interactions.ts`, mirroring `persist.ts`:
  fire-and-forget POST with bounded retry (3 attempts, linear backoff, log and swallow on
  final failure), authenticated via the run credential closure (same `auth()` pattern as
  `persist.ts` / `alive.ts`). Never blocks or fails the turn.
- `createInteraction(sessionId, turnId, kind, data, auth)` POSTs to
  `POST /sessions/interactions` with body `{interaction: {session_id, turn_id, token,
  kind, data, flags}}`.
- `token` = the harness tool-call id (the same stable per-call key the responder already
  uses in `permissionRequestKeys`). Makes creation idempotent per gate and gives the
  respond/transition path its correlation key.
- Hook point: the `onPark` callback in `sandbox_agent.ts` (fires exactly when the
  HITLResponder returns `"park"`, i.e. a real human-surface gate with no stored decision).
  On park, call `createInteraction(kind=user_approval, data.request={tool name + args})`
  in addition to the existing messages-plane emission. Headless and stored-decision paths
  do not create (they never park).
- `data.flags.delivered_in_band = true` (the messages plane also carried the event).

### API

- `create_interaction`: credential-auth + `RUN_SESSIONS` + project/user from
  `request.state` (see constraint above). Idempotent on `(project_id, session_id, token)`
  so a retry or a cold-replay re-raise does not create a duplicate row — return the
  existing interaction if the token already exists for the session.

### Inspector (web/oss/src/components/SessionInspector)

- A Refresh button available on all five tabs (Records, States, Streams, Interactions,
  Mounts). Streams already has one; lift the affordance so every tab can re-run its own
  query. Same control, per-tab behavior (invalidates that tab's query key). Placement can
  be a single button in the drawer header that invalidates the active tab's query, or a
  per-tab button — either is acceptable; the requirement is every tab is refreshable.
- Interactions tab shows the full interaction: kind, status, token, turn_id, created_at,
  the `data.request` payload, and (when present) `data.resolution`. Keep it readable
  (monospace ids, JSON block for request/resolution).
- Respond control invokes `respondInteraction` with the correct shape. The respond body
  is `{answer: {...}}` (a JSON object, per `SessionInteractionRespondRequest.answer:
  Dict[str, Any]`). For a `user_approval` give explicit Approve / Deny buttons that send a
  decision-shaped answer (e.g. `{decision: "allow"}` / `{decision: "deny"}`); for
  `user_input` keep a text/JSON answer field. Disable respond when the interaction is not
  `pending`. After a successful respond, invalidate the interactions query so status
  flips.

## Status is a lifecycle state machine, not a verdict

The interaction `status` tracks lifecycle ONLY. The verdict (approve/deny) is content and
lives in the `answer` (the `{approved}` tool_result), never in the status:

- `pending` — created, awaiting a reaction (the runner creates it here when the harness
  raises the gate).
- `responded` — answered via the interactions API plane. The `respond_interaction`
  endpoint sets this at the API, before/as it dispatches the detached invoke. Only
  scenario 1. WIRED.
- `resolved` — the runner consumed the answer and forwarded it to the harness. The runner
  sets this (calls the transition endpoint) from the non-park branch of the permission
  responder, where it applies a stored decision. Reachable from `responded` (scenario 1:
  the answer came via /interactions) or directly from `pending` (scenario 2: the answer
  came inline via a messages reply, never touching the interactions endpoint). WIRED.
- `cancelled` — the gate is orphaned; no one will answer the token. TWO producers, both
  WIRED:
  - kill: `delete_session_stream` calls `cancel_session_pending` (no `except_turn_id`) →
    cancels ALL the session's pending gates after `streams.kill()`.
  - new turn supersedes: at each session-owned turn start the runner POSTs
    `/sessions/interactions/cancel-stale` (`{session_id, turn_id}`) →
    `cancel_session_pending(except_turn_id=turn_id)` → cancels prior turns' pending gates,
    sparing the current turn's own. This is the "user sent a new message instead of
    answering" case.

State machine:

```text
pending ──responded-via-/interactions──→ responded ──runner-closes──→ resolved
pending ──answered-via-messages──────────────────────────────────────→ resolved
pending ──kill / superseded-by-new-turn──────────────────────────────→ cancelled
```

`denied` was REMOVED — it mixed the verdict (content, already in `answer`) with the state
machine. A denied approval is a `responded`/`resolved` interaction whose answer carries
`{approved: false}`.

The transition DAO guards on a non-terminal source (`pending` or `responded`); `resolved`
and `cancelled` are terminal. `respond_interaction`'s `pending → responded` is a no-op if
a concurrent reaction already moved the row off `pending` (caught `InteractionNotFound`).
The bulk `cancel_session_pending` touches only `pending` rows, so an already-`responded`
interaction is never retroactively cancelled by a later turn.

## Tests

- Runner unit (`services/agent/tests/unit/`, mirror `session-persist.test.ts`): POST body
  shape (session_id / turn_id / token / kind / data), auth header carries the run
  credential, retry-then-give-up, and a create failure does NOT abort the turn.
- API acceptance: a credentialed (non-admin) caller can create an interaction;
  project/user come from the credential; a second create with the same `(session_id,
  token)` returns the same row (idempotent). The admin path regression: existing
  admin-authored flows still work if retained, else updated.
- Inspector: manual QA below.

## What to QA

- Start a session-owned run in the agent chat playground that triggers a tool requiring
  approval. The turn pauses. Open the inspector Interactions tab: one `pending`
  `user_approval` row with the tool name + args in `data.request`.
- Click Approve (or Deny). The row flips to `responded`; the answer carries
  `{approved: true|false}`. Refresh shows the new status.
- Cancel-on-supersede: with a `pending` gate open, send a NEW chat message instead of
  answering. The prior gate's row flips to `cancelled` (the new turn's cancel-stale call).
- Cancel-on-kill: with a `pending` gate open, Kill the session from the Streams tab. The
  pending interaction flips to `cancelled`.
- Hit Refresh on each of the five tabs; each re-fetches its own data.
- Regression: a headless `/invoke` over the same gate auto-answers via policy and creates
  NO interaction row. The messages-plane `interaction_request` event still fires on the
  HITL path.

## Out of scope (deferred to the big-agents agent-template audit)

- Rename "client tool" -> "callback tool".
- The "runner interactions" umbrella naming (user approvals / user inputs / callback
  tools as the three kinds).
- The full dual-plane "whoever-reacts-first" resolver that also feeds the API respond
  back into a parked runner gate. This branch creates the record and lets the inspector
  respond; closing the loop back into a live parked turn from the API plane is the
  follow-up.
