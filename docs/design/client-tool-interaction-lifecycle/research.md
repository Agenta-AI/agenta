# Research: how interaction cards actually behave today

Terms are defined in [README.md](README.md#glossary-shared-by-every-file-here).

## 1. The diagnosed mechanisms of this bug class (all live-evidenced 2026-08-10)

Each of these was reproduced on the release stack with database rows, network logs, or
runner logs. Together they explain every symptom in [context.md](context.md); none of
them alone explains all of it, which is why symptom-by-symptom fixing kept missing.

### 1a. Replay resurrects terminal interactions as live

`transcriptToMessages` rebuilds a conversation from the records. A parked interaction
leaves an `interaction_request` record; the replay branch rebuilds the card from that
record alone. A later real answer leaves a `tool_result` record that settles the part,
but a server-side cancellation leaves NO record, so a cancelled interaction replays as a
blank, interactive, forever-pending card. Clicking it is a client-side no-op (verified:
zero network calls, row untouched), so the user sees a card that lies twice.
Fix landed: PR #5912 joins replay against the interaction rows' terminal statuses
(cancelled renders inert). Open question for section 2: whether every ANSWERED
interaction reliably leaves the settling record, for all three kinds (form answers,
connect completions, declines), or whether more terminal states need the same join.

### 1b. Adoption clobbers a just-settled answer

Answering a card settles the part locally, then the resume dispatch fires a beat later.
The records relay can tick inside that beat; the refresh adopted the server transcript,
which predates the answer, and silently discarded it: the resume never dispatched, the
row stayed pending, the model never saw the answer. Verified live with zero-network
evidence. Fix landed in PR #5909 (guard at entry and re-checked at the adoption moment).
This was the "my response was ignored" symptom.

### 1c. The "awaiting" status only counted the last message

The session's published status derived "awaiting" from a pending card in the LAST
assistant message only. The moment a new turn began streaming, a still-pending card in an
earlier message stopped counting, status collapsed, the settle stamp landed, and the
running-elsewhere strip fired in the owning tab (strip logic: settled locally + running
remotely = someone else's run). Fix landed: PR #5913 scans the whole transcript.

### 1d. Server-side transitions are silent (to the desktop web app)

Server transitions change an interaction's truth without the desktop client learning it.
The full map is in section 3; the headline corrections from that inventory:

- There is NO one-interaction-per-turn force-cancel (an earlier working theory). Multiple
  gates per turn are supported by design. What exists instead is a routing decision: a
  browser-fulfilled client tool makes the whole turn non-parkable (cold path), invisibly.
- There is NO 10-minute interaction TTL. The 10-minute timer is the warm sandbox's
  approval park; its expiry destroys the sandbox and leaves the row pending, silently.
- A cancellation signal PARTIALLY exists: cancels publish a watch frame, but it carries
  no token, no kind, no reason, says "resolved" for a cancellation, and the desktop web
  app does not subscribe to it at all (only mobile listens).

### 1e. The runner loses an answered gate's result when a sibling is carried

When one turn raises two approval gates and the resume answers one, the carried sibling's
re-park fired synchronously before the answered call's completion could be observed; the
answered call's result was replaced with a synthetic "result unknown" sentinel, and the
carried gate was re-parked but suppressed, so the client was never re-told it owes an
answer (the row lingers pending). Fix for the ordering: PR #5910 (proven red/green). The
suppressed re-announcement remains open and belongs to this project's plan.

### 1f. Interaction settlement never records success (the deepest finding)

The reconstruction in section 4 proves: a `request_connection` interaction row NEVER
reaches a success terminal state. Whether the user completes the connection, declines it,
or abandons it, the row always ends `cancelled`, set by the generic stale-interaction
sweep at the top of the next turn, with no resolution payload. Verified across three
sessions, two harnesses (codex and pi_core), and two projects. Consequences:

- "Settled because it succeeded" and "settled because it went stale" are the same fact at
  the row level. Any UI that renders from the row (including the 1a fix, which renders
  cancelled interactions as inert-cancelled) will mislabel a successful connection as a
  cancelled one.
- The model learns the real outcome through a side channel: it re-reads live config or
  discovers tools, which reflect `gateway_connections` state. In the fresh-code session
  it correctly said "the Telegram connection is active" with zero interaction-response
  records in its context. Outcome knowledge and interaction settlement are fully
  decoupled today.
- The side channel can lie: in the pre-fix session, the model declared "Telegram is
  connected" while the only existing connection row was expired and invalid, then created
  a schedule on top of it. The model trusts a connected-flag read without the validity
  check.

## 2. Frontend render inventory (every path that can show a card)

Two widgets (the questionnaire form, the connect card), six mount sites, and two
independent dispatch sites that can settle the same call. The full file:line inventory
lives in the exploration report; the facts the plan builds on:

### The render predicate

A REGISTERED client tool renders its card in every message position and every state
(that is what makes settled chips work), while an unregistered one arms only on the last
message after streaming stops and then auto-settles itself as "not handled". Dispatch
prefers the render kind over the tool name and does NOT fall through: a present-but-
unknown render kind silently becomes the auto-settling "not handled" card.

### The dead-card mechanism (the "cannot even click Not now" symptom)

The connect card's ACTIONS live in a dock that only scans the LAST message; the inline
card in the transcript is a passive marker saying "waiting for your response below".
When a parked connect interaction ends up in a non-last message (a new turn started),
three last-message-only readers disagree with the whole-transcript scan that now feeds
the session status: the dock does not render (no actions anywhere), the queue stops
holding, and the passive marker keeps pointing "below" at nothing. A visible,
unanswerable card with no working buttons is the designed outcome of that geometry.

### The reload regression (answers structurally cannot survive adoption)

On reload the localStorage seed paints the CORRECT answered state first. Hydration then
adopts the server replay whenever the server's record count exceeds the local watermark.
The records CAN carry the answer (the resume turn writes a tool_result, which is why
0.108 reloads were correct); what cannot carry it is the interaction ROW, and the
0.112-era replay reads the row. When the answer's tool_result has not landed yet, or the
row join mislabels, the correct local copy is replaced by a wrong server copy. Worse, the replay join that
marks cancelled interactions inert matches ANSWERED interactions too (their rows are
always cancelled, section 5): an accepted questionnaire replays as "Dismissed the
request." and a successful connection replays as "Connection not completed" with a
Retry button. When that join is cold (best-effort, 15-second staleness), the same part
replays as a fully live, answerable form instead. The rendered truth after reload is
non-deterministic by cache warmth.

### Adoption while a card is parked

While a card is parked, the tab reads as not-busy and no resume is pending, so both the
poll and the records relay will adopt the server transcript, remounting widgets and
destroying typed form state (only the per-card localStorage draft survives). The
settle-to-resume guard from PR #5909 protects only the answer window, not the parked
window.

### Divergence flags recorded for the plan (abbreviated)

Two settle sites per call guarded by per-instance flags; the client-tool name list
duplicated across a package boundary (a tool added to one list only either never
resumes or never renders); sentinel matching differs between the two transcript-replay
copies; the questionnaire draft key is never pruned for cancelled parts; the connect
success payload tells the model only `{connected, integration, slug}`, and the model's
awareness of newly available tools depends on the next run's tool-list resolution,
unannounced.

## 3. Server-side lifecycle inventory (every state transition)

Full file:line detail lives in the inventory report; this section keeps the facts the
plan builds on.

Vocabulary: kinds `user_approval | user_input | client_tool` (nothing ever creates
`user_input`; `request_input` and `request_connection` ride as `client_tool`). Statuses
`pending | responded | resolved | cancelled`; `resolved` and `cancelled` are terminal,
enforced by a guarded compare-and-set (a late transition 404s). A `resolution` payload is
REJECTED with 409 for any kind except `user_approval` — the schema itself forbids
client-tool outcomes today.

### The defining defect: fulfillment never resolves the row

The relay path that delivers `request_input`/`request_connection` returns the browser's
output to the harness and NEVER touches the interaction row (no resolve call exists on
that path; the only client-tool resolve lives on a different, ACP-gated path). The row is
still `pending` when the resume turn starts, and the turn-start stale sweep cancels it,
because the sweep's exemption list is built only from warm-parked APPROVAL gates. A
successfully answered form or connection is therefore recorded, durably and always, as an
abandonment. This single mechanism produces the entire kind-by-outcome table in section 5
and explains what the janitor did to Mahmoud's answered questionnaire.

### Cancellation paths (exactly three, plus hard delete)

1. Turn-start stale sweep: every session run cancels the session's pending rows from
   other turns, minus warm-parked approvals. Fire-and-forget.
2. Records-worker orphan reconciliation: a turn that ends without parking cancels its own
   leftover gates, before the watch tee wakes clients.
3. Session kill: cancels ALL pending rows, including one the user is looking at.
Hard delete: session deletion removes rows outright.

### What the model actually receives

- Approval answered: a tool result `{approved, interactionToken}`. On a warm resume, the
  harness gets a bare allow/reject enum: a deny cannot say WHY (human refusal vs policy
  vs error), and a deny-with-note travels as a separate user turn (undeliverable on the
  warm mobile path).
- Client tool answered: the browser's raw output verbatim as the tool's return value.
- Connection success: only `{connected, integration, slug}`. Nothing tells the model
  which tools the connection made available; that depends on the next run re-resolving
  the tool list, unannounced.
- `interaction_request`/`interaction_response` records are audit/replay only; the
  reconstruction that builds the model's conversation context drops both.

### Records each path leaves

Client tool: `tool_call` + `interaction_request`, then (next turn) `tool_result`.
Approval: those plus sometimes `interaction_response` (only user_approval, only when a
verdict reached the harness). A CANCELLED interaction leaves no closing record of any
kind, which is why replay needs a separate REST join to know, and that join today queries
`client_tool` rows only (a cancelled approval is never reconciled on any surface).

### Latent traps recorded for the plan

- Interaction creation silently drops after 3 failed retries: the live card renders with
  no durable row; out-of-band answering 404s.
- The stale sweep cannot reach a row with a NULL turn id (SQL null-inequality); current
  producers always set one, so this is latent, not live.
- Two answer planes exist (message-borne for desktop, interactions-API for mobile) with
  different ordering and different capabilities; any settlement contract must serve both.

## 4. Live evidence: what actually happened after the successful connection

Reconstruction from the newest session on Mahmoud's project (ca534199, harness codex),
plus two corroborating sessions. Read-only: database rows, tracing records, runner logs.

The successful connection: `gateway_connections` row 019fec52-0932, slug
`telegram-main`, created 15:37:07, flags `is_valid: true, is_active: true` (independently
confirmed distinct from the expired 14:58 attempt).

1. The connect interaction that produced it (token 8b31fd6e, args request oauth mode and
   slug telegram-main) ended **status=cancelled** at 15:38:04, no resolution payload, via
   the stale sweep at the next turn's start. The runner ingested ZERO interaction-response
   records for the whole session. Nothing distinguishes this row from an abandoned one.
2. The model nonetheless learned the truth: the next turn's records carry "The Telegram
   connection is active" (record 3) and "Telegram is connected, but the message-sending
   action isn't available in this runtime" (record 17, final). It learned via re-reading
   live config/tool discovery, not via settlement.
3. No literal model re-ask exists in this session's records. The "asked me to connect
   again" experience is therefore attributed to the client rendering the cancelled-row
   card again (mechanism 1a/1f interplay: the row's terminal state cannot say
   "succeeded", so the card cannot either).
4. Corroboration: the earlier session e627d80a (pre-fix code) shows the same
   always-cancelled signature AND the false-positive shape: the model declared
   "connected" with only an expired connection row in existence, then created a schedule
   on top of it. A controlled test session (3975e362, pi_core, different project) shows
   the same always-cancelled-after-genuine-success signature.

Two adjacent findings for the record, out of this project's scope but worth their own
tracking: (a) after a genuinely valid connection, the codex harness could not locate an
executable Telegram send action (a read_config error mid-turn), so the poem was never
sent; (b) the model's connected-check does not verify connection validity (the false
positive above).

## 5. Settlement by interaction kind (the kind-by-outcome table)

Mined from all of today's `session_interactions` rows plus row-level detail from
controlled tests. One example row exists for every cell; ids are in the source data.

| Kind | Proper completion | Explicit decline | Abandonment |
|---|---|---|---|
| `user_approval` (all gated tools) | `resolved` + `resolution.verdict: approved` + a wire event (`interaction_response`) then the real `tool_result` | `resolved` + `resolution.verdict: denied` | `pending`, or `cancelled` without resolution via the sweep |
| `client_tool` / `request_input` | `cancelled`, no resolution, no wire event (byte-identical to decline) | `cancelled`, no resolution | `pending` until the sweep flips it to `cancelled` |
| `client_tool` / `request_connection` | `cancelled`, no resolution (verified against a connection that genuinely succeeded) | `pending`, never touched at all (the pre-fix decline never reached the server) | `pending`, identical to decline |

Facts the table pins:

- `client_tool` rows carry exactly two top-level keys, ever: `request` and `references`.
  There is no success field to read; the schema cannot express an outcome.
- `user_approval` has the full contract this project wants: a distinct terminal status, a
  verdict payload, and a wire event marking the settlement moment. The sweep still exists
  for genuinely abandoned gates, and it is distinguishable from settlement.
- The model receives client-tool outcomes only as ordinary conversational content in the
  next turn's history (a submitted form's values appear in the model's next message
  context; zero `interaction_response` events exist for client tools anywhere in today's
  runner logs).

Consequence for the plan: the settlement contract does not need inventing. It needs
EXTENDING from `user_approval` to `client_tool`, with outcome payloads per kind
(submitted values for forms; connection result for connects) and the same wire event, so
the row, the card, and the model all read the same fact.

## 6. When each piece was born (blame timeline, verified against v0.108.1)

Baseline fact that reframes the project: `client-tools.ts` (the relay delivery path) is
byte-identical between v0.108.1 and today, and a resolve call has NEVER existed in it in
the repo's entire history. The interactions table, the stale sweep, the relay, both
request tools, and both widgets all shipped together in v0.105.0 with the settlement
asymmetry (resolution payloads for approvals only) already in place. On 0.108, answered
client-tool rows were ALREADY always swept to cancelled; nothing rendered the lie
because replay ignored client-tool interaction rows entirely and rebuilt cards from
tool_call/tool_result records, which did carry the answers.

- v0.105.0 (07-14): interactions plane (PR #4916), stale sweep (PR #4937), relay without
  settlement (PR #4985), request_connection (PR #4920), request_input (PR #5155),
  widgets. The root defect is born complete. (Dating refinement from review: the
  resolution payload and its approval-only guard arrived July 19, shortly after the
  plane itself.)
- v0.106.1/2 (07-30..08-01): InteractionDock with its last-message-only scan (PR #5521);
  watermark adoption + the running-elsewhere strip (PR #5608).
- v0.108 (08-03/04): the "it worked" baseline. Working = the broken rows were unread.
- v0.109-v0.110: no changes to any mechanism here.
- v0.111.0 (08-09): the inflection. PR #5690 adds the live records-watch relay, orphan
  reconciliation, and the watch publish; adoption can now fire mid-turn (mechanism 1b's
  precondition). PR #5682 adds the second replay copy.
- 0.112 train (08-10): PR #5859 makes replay read client-tool interaction rows for the
  first time (resurrection becomes possible) and introduces a registry-dispatch hazard
  (an unknown render kind no longer falls through to the tool name; a one-line fix).
  PR #5912 adds the row join that then mislabels answered rows.

Consequences adopted into the plan: W1+W2 are genuine contract work with no revert
alternative (nothing was lost; it was never written). W3 and the registry item are
regression repair against v0.111/PR #5859 code, on their own schedule. A restore-0.108
option exists (exempt client_tool from the sweep or stop reading rows in replay, plus
block mid-turn adoption) and is REJECTED: 0.108's correctness was a happy-path illusion
with its own defects (unanswered client tools replayed as live never-resolvable cards;
request_input replayed as the auto-settling "not handled" card).
