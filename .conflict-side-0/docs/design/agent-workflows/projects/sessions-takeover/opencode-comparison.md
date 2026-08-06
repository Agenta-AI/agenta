# Comparison of session storage and approvals in OpenCode and Agenta

This report examines how OpenCode solves the problems our sessions-takeover week was about:
where conversations live, how a session continues after a restart, how a human approves a
tool call, what happens on cancel or a mid-turn message, and how several clients follow one
session. It is the sibling of the Zed study
(`docs/design/agent-workflows/scratch/zed-acp-approvals-comparison.md`) and reads against
our architecture document
(`docs/design/agent-workflows/projects/sessions-takeover/architecture.md`) and the
db58551b incident report
(`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md`).

OpenCode citations are paths inside a clone of `https://github.com/sst/opencode` at commit
`cb562b2c6289` (2026-07-21). Agenta citations are paths in this repository.

## 1. Orientation: what OpenCode is and how its division of labor differs from ours

OpenCode is the open-source coding agent built by SST, written in TypeScript. It runs as a
local server process. The terminal UI, the web app, and the desktop app are all clients of
that server over HTTP plus one server-sent-events stream (SSE, a one-way HTTP stream of
JSON events). The server package is `packages/opencode`; the newer core is
`packages/core`; the wire schemas live in `packages/schema`; the SolidJS client that
powers web and desktop is `packages/app`.

The architectural difference from Agenta that explains almost everything else in this
report: **OpenCode owns the whole agent loop in one process.** The server calls the model
provider itself through its own LLM layer, executes tools itself on the host filesystem,
and writes every step of the conversation into its own store. There is no harness. There
is no sandbox. There is no second copy of the conversation anywhere.

Agenta drives external harnesses (Pi, Claude Code) over ACP inside sandboxes. The harness
owns the model-facing conversation in its own native session file; our platform keeps a
separate display transcript (records), a mapping ledger (turns), a liveness plane
(streams plus Redis), and a durable approval plane (interactions), spread across two
databases, Redis, and an object store. OpenCode has one SQLite file.

One reading note: OpenCode currently contains two generations of internals. The shipped
path is the "v1" loop (`packages/opencode/src/session/prompt.ts`, the `SessionPrompt`
monolith). A "v2" rewrite lives in `packages/core/src/session/` with its own runner and
event family; its spec says the `session.next.*` schemas "remain experimental and
unshipped" (`specs/v2/session.md:173`). Both generations write through the same durable
event log described next, so the storage story below covers both; where behavior differs I
say which generation I am describing.

## 2. Session storage

### One SQLite file, written through an event log

Everything durable lives in a single SQLite database at
`~/.local/share/opencode/opencode.db` (`packages/core/src/database/database.ts:46-54`,
data directory from `packages/core/src/global.ts:11`). An earlier generation stored
sessions as JSON files under a `storage/` directory with keys like
`session/<projectID>/<sessionID>.json` and `part/<messageID>/<partID>.json`; that module
still exists with the migrations that folded those files into the new layout
(`packages/opencode/src/storage/storage.ts:81-211`), but the tables are now the truth.

The write path is event sourcing. An **aggregate** is the unit that owns an ordered event
history; here the aggregate is the session. Two tables implement it: `EventTable` holds
one row per durable event (id, aggregate id, per-aggregate sequence number, versioned
type, JSON payload) and `EventSequenceTable` holds the latest sequence per aggregate
(`packages/core/src/event/sql.ts`). Publishing a durable event runs one SQLite
transaction that: reads the latest sequence, assigns `seq = latest + 1`, runs every
registered **projector** (a function that updates a read-model table from the event)
inside that same transaction, and inserts the event row
(`packages/core/src/event.ts:236-353`). The projection can never disagree with the log
because they commit together.

The same machinery gives them idempotent replay. Re-committing an event whose sequence
already exists succeeds silently if id, type, and payload match the stored row, and dies
with "Replay diverged" if they do not (`event.ts:262-290`). Sequences must be gapless
(`event.ts:294-302`), and an aggregate can carry an owner id so only one workspace may
extend a replicated history (`event.ts:254-260, 291-293`). This is the foundation of
their cross-machine sync: a client ships serialized events to another node, which replays
them into its own log (`packages/opencode/src/server/routes/instance/httpapi/handlers/sync.ts:35-60`).

### What is durable and what is live-only

The event family draws a deliberate line. Boundary events are durable and carry the full
value; streaming fragments are transient bus traffic. The schema says it in a comment:
"Stream fragments are live-only; Text.Ended is the replayable full-value boundary"
(`packages/schema/src/session-event.ts:208-218`). So `text.started`, `text.ended` (with
the complete text), `tool.called` (with full input), `tool.success`, `tool.failed`,
`step.started`, `step.ended`, `compaction.ended` are durable rows; `text.delta`,
`reasoning.delta`, `tool.input.delta` are published to live subscribers only and never
touch the log. The shipped v1 events follow the same split: `message.updated` and
`message.part.updated` are durable (`packages/schema/src/v1/session.ts:502-507`), while
`message.part.delta` is not (`v1/session.ts:632-641`). Our runner reaches the same shape
operationally by coalescing delta families before persisting
(`services/runner/src/sessions/persist.ts:160-329`); OpenCode makes it a schema-level
contract instead of a persistence-time optimization.

### The projections

The projectors maintain the read model (`packages/core/src/session/projector.ts`):

- `session`: one row per session with title, slug, project id, parent id (subagent
  sessions are child sessions), directory, agent, model, share URL, revert state, a
  per-session permission ruleset override, archived timestamp, and running cost and token
  totals that projectors increment as usage events land
  (`packages/core/src/session/sql.ts:22-66`, `projector.ts:90-110`).
- `message` and `part` (v1): one row per message and per part, each a JSON blob keyed by
  ULID-style ascending ids (`sql.ts:68-98`).
- `session_message` (v2): one row per message with a **unique `(session_id, seq)`
  index**, so the projected conversation carries its durable event order
  (`sql.ts:119-138`).
- `session_input` (v2): the prompt inbox, covered in section 4.

There is no session-list JSON and no separate title store; the session row is the header,
and a `title` agent renames it asynchronously after the first turn
(`packages/opencode/src/session/prompt.ts:193-253`).

### One store serves both the display and the model

This is the answer to our "is the model-facing conversation a second store" question: no.
The same `message` and `part` rows the UI renders are translated into provider messages
right before each model call by `MessageV2.toModelMessages`
(`packages/opencode/src/session/message-v2.ts:290-374`). The translation handles the
awkward cases inline: a completed tool part becomes a tool result with truncated output; a
tool part still marked `pending` or `running` (which after a crash means the process died
mid-call) becomes a tool error reading "[Tool execution was interrupted]" so no dangling
`tool_use` block ever reaches Anthropic (`message-v2.ts:349-360`); reasoning survives only
while the model matches the one that produced it. Provider-native context caching is
handled by prompt-cache keys, not by preserving a native transcript.

### Continuation after a restart

Because the store is the conversation, restart continuation is trivial: there is nothing
to resume. Liveness is purely in-memory (`SessionStatus` is a Map,
`packages/opencode/src/session/status.ts:26-48`; the v2 coordinator's active set "is
runtime state and is empty after a process restart", `specs/v2/session.md:169`). The next
prompt reads projected history and runs. The only restart work is reconciliation of
half-open state: the v2 runner, before assembling a request, durably fails any tool still
projected as `running` from a previous process with "Tool execution interrupted"
(`packages/core/src/session/runner/llm.ts:119-139`, spec `specs/v2/session.md:50`), and
the v1 translation layer produces the interrupted-tool error shown above. Compare our
three-tier ladder (warm pool, cold native `session/load` via the turns ledger, transcript
replay, `architecture.md` section 3): their entire ladder collapses to "read your own
rows" because no external process holds a better copy.

Two features fall out of owning the store that we do not have at all. **Fork** copies a
session's messages and parts up to a message id into a fresh session with new ids
(`packages/opencode/src/session/session.ts:693-734`). **Revert** stages a boundary
message, and committing it deletes every projected message and inbox row past that
boundary and resets the context epoch (`projector.ts:415-453`), giving "rewind the
conversation" as a first-class verb.

## 3. The approval flow end to end

### Rules first, humans second

A **permission ruleset** is an ordered list of rules `{permission, pattern, action}` with
actions `allow`, `deny`, or `ask`; last matching rule wins and the default is `ask`
(`packages/opencode/src/permission/index.ts:28-38`). Rules come from the agent's config,
from a per-session override stored on the session row, and from rules approved earlier in
the instance. A tool that wants to act calls `ctx.ask` with the permission name, the
concrete patterns, and an `always` list of generalized patterns
(`packages/opencode/src/session/tools.ts:81-89`). The bash tool derives those generalized
patterns with a hand-built arity dictionary that knows `git checkout main` generalizes to
`git checkout *` but `npm run dev` generalizes to `npm run dev` and not `npm *`
(`packages/opencode/src/tool/shell.ts:270-286, 408-409`,
`packages/opencode/src/permission/arity.ts`).

If every pattern evaluates to `allow`, the tool proceeds with no human involved. If any
evaluates to `deny`, the tool fails immediately with a denied error. Only `ask` reaches a
human (`permission/index.ts:67-107`).

### The pending map and the one-shot answer

An ask creates an in-memory entry: the request object plus an Effect `Deferred`, which is
a one-shot promise the asking tool fiber awaits (`permission/index.ts:18-25, 98-107`).
The entry goes into a Map keyed by request id, and a transient `permission.asked` event is
broadcast. The request carries `tool: {messageID, callID}`, so every client can anchor
the approval card on the exact tool call it gates (`tools.ts:86`).

**Multiple simultaneous approvals are structurally free.** The pending store is a keyed
map; every concurrently executing tool call blocks its own fiber on its own deferred; the
UI holds a per-session sorted list of pending requests fed by asked and replied events
(`packages/app/src/context/global-sync/event-reducer.ts:330-357`). Nothing serializes
asks, and nothing anywhere waits for "all cards settled".

The answer is one HTTP call naming one request id:
`POST /session/:sessionID/permissions/:permissionID` with reply `once`, `always`, or
`reject` (`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:362-380`),
or the instance-level `POST /permission/:requestID`
(`handlers/permission.ts:16-38`). Reply semantics
(`permission/index.ts:109-167`):

- `once` resolves that one deferred and the tool proceeds.
- `always` resolves it, appends the request's `always` patterns as allow rules to the
  instance's approved set, and then walks the remaining pending map: any other pending
  request in the same session now fully covered by the new rules is auto-approved and a
  `permission.replied` event is emitted for it. Approving "always run git" settles the
  three other git cards on screen in the same call. In v2 the saved rules become durable
  per-project rows (`packages/core/src/permission/saved.ts`,
  `packages/core/src/permission.ts:250-256`).
- `reject` fails that deferred and then **rejects every other pending request in the
  session** (`permission/index.ts:129-139`; same in v2, `permission.ts:237-247`). Their
  chosen policy is that one rejection means "stop what you are doing", and the loop halts
  (a declined ask is treated as a user-initiated stop, not as model-visible tool output,
  `packages/core/src/session/runner/llm.ts:144-150, 297-301`).
- `reject` with a message becomes a `CorrectedError` carrying the text, which flows back
  to the model as feedback instead of a bare denial (`permission/index.ts:121-127`).

### What is durable about an approval: nothing, on purpose

The pending map is process memory. The `permission.asked` and `permission.replied` events
are defined without the `durable` option, so they never enter the event log
(`packages/schema/src/v1/permission.ts:61-70`,
`packages/schema/src/permission.ts:44-53`). A client that attaches mid-ask discovers
pending requests from `GET /permission` (`handlers/permission.ts:12-14`), which reads the
live map. If the server dies while an ask is pending, a finalizer fails every deferred
(`permission/index.ts:54-61`), the tool call errors, and the durable trace the next
reader sees is the tool part's terminal state, not an approval record.

That is the deep contrast with our interactions plane. OpenCode can afford undurable
approvals because the asker, the executor, and the answer route all live in one process
and the turn simply stays open while the human thinks; the durable answer is the tool
call's own status transition, exactly the Zed shape. Agenta cannot: our gate and executor
are in different processes, the browser turn closes when we park, answers may arrive from
a webhook days later, and we owe tenants an audit trail of who approved what. Our
`session_interactions` rows with stored verdicts, and the `interaction_response` record
(#5382 lane), have no OpenCode equivalent because OpenCode does not have our problem.

## 4. Cancel, steer, and multi-client attach

### Cancel is a fiber interrupt with honest bookkeeping

`POST /session/:id/abort` calls `SessionPrompt.cancel`, which interrupts the running
fiber (`handlers/session.ts:232-235`, `packages/opencode/src/session/run-state.ts:77-86`,
`packages/opencode/src/effect/runner.ts:171-201`). Because the loop is in-process, the
signal takes effect immediately; there is no heartbeat-granularity delay like our
30-second `is_current_turn` path (`architecture.md` gap 5). The cleanup then writes an
honest durable ending: every open tool call gets status `error`, error text "Tool
execution aborted", and `metadata.interrupted = true`, with its accumulated partial
output preserved in metadata (`packages/opencode/src/session/processor.ts:577-596`); the
assistant message is finalized with an aborted error
(`prompt.ts:1203-1211`). Notably, when an interrupted shell command produced output
before the abort, that partial output is replayed to the model as a tool result on the
next turn (`message-v2.ts:326-336`), so the model knows what actually happened. No
synthetic success is ever written, and no "retry the same call" sentinel exists. Their
cancel is everything our db58551b fix plan items 2 through 4 ask for.

### Steer, shipped version: the loop re-reads the store

In the shipped v1 path a new prompt during a running turn does not error and does not
queue in memory. `prompt()` writes the user message durably first
(`prompt.ts:1046-1047, 1052-1071`), then calls into the per-session runner, whose
`ensureRunning` joins the already-active run instead of starting a second one
(`effect/runner.ts:117-137`). The loop reloads the full projected history at the top of
every step (`prompt.ts:1092-1094`), and its exit condition is "the last assistant message
finished AND no user message is newer than it" (`prompt.ts:1111-1130`). A message that
landed mid-turn therefore steers the conversation at the next step boundary, and a
message that lands after the turn would have ended keeps the loop alive for another
round. There is no 409, no separate steer verb, and no way for new text to vanish into a
stale resume: the store is the queue. Our defect 6 (a text message during a park consumed
as an approval resume) cannot be expressed in this design.

### Steer, v2 version: a durable prompt inbox

The v2 slice makes the same idea explicit data. `session_input` is a durable inbox table;
every prompt is first **admitted** (durable `prompt.admitted` event, row with
`admitted_seq`) and later **promoted** (durable `prompted` event stamps `promoted_seq`,
and only then does the projector write the model-visible user message)
(`packages/core/src/session/sql.ts:140-166`,
`packages/core/src/session/input.ts:41-168`). Delivery is explicit per prompt
(`specs/v2/session.md:155-158`):

- `steer` promotes at the next safe provider-turn boundary, including inside the current
  drain; the runner computes a cutoff sequence and promotes all eligible steers in
  admission order (`packages/core/src/session/runner/llm.ts:187-196`,
  `input.ts:245-266`).
- `queue` waits until the session would otherwise go idle, then promotes exactly one
  queued prompt FIFO (`input.ts:268-288`, `runner/llm.ts:383-406`).

Interrupt stops execution but "preserves durable inbox rows for a later wake or resume"
(`specs/v2/session.md:22-27`), so cancel and steer compose: you can interrupt, and the
queued text is still there, admitted but unpromoted, visible to clients as queued input
(`specs/v2/session.md:35-37`). A per-process coordinator serializes execution per session
while letting sessions run concurrently, with joins and coalesced wakes
(`packages/core/src/session/run-coordinator.ts:5-15, 67-101`).

### Attach: one event stream, snapshot endpoints, and a durable cursor

Every client follows every session the same way: subscribe to `GET /event`, one SSE
stream carrying all bus events for the instance, then fetch snapshots (session list,
messages, pending permissions) through plain endpoints. The handler registers its
listener eagerly before the response body starts, with a comment explaining that events
published while the stream is starting cannot be lost
(`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts:28-31`). The
client applies events onto its stores with a reducer and refetches snapshots when the
stream reconnects (`packages/app/src/context/server-sync.tsx:388-393`,
`packages/app/src/context/global-sync/event-reducer.ts`). Attaching mid-turn needs no
special verb: the snapshot contains the partially-built assistant message (parts are
durably updated at every boundary), and the stream delivers deltas from now on. Several
clients attach concurrently; nobody holds a watcher lock; the TUI, the web app, and the
desktop render the same turn live.

The v1 stream has no replay cursor (reconnect means refetch). The v2 contract closes that
gap precisely: `sessions.events({sessionID, after})` replays durable events after an
aggregate sequence and then tails live commits, and the implementation registers the
wake signal **before** the historical read so the replay-to-tail handoff cannot miss a
commit (`packages/core/src/event.ts:565-604`, `specs/v2/session.md:175-183`). Live-only
deltas are deliberately excluded from the replayable stream and can never advance the
cursor. A finite paged variant exists at `GET /api/session/:id/history`.

Two cross-machine features sit on top. **Share** pushes session, message, and part
payloads to a cloud viewer keyed by a share id and secret, batched from bus events
(`packages/opencode/src/share/share-next.ts`). **Sync** replays serialized durable events
onto another node's log with owner claims, which is how a session moves between a laptop
and their cloud workspace (`handlers/sync.ts:35-91`).

## 5. Side by side with our planes and our gaps

| Agenta plane | OpenCode counterpart | Note |
|---|---|---|
| Records (tracing DB, upsert log) | `EventTable` plus projections in one SQLite file | Theirs is also the model conversation; ours is display-only because the harness owns the model copy |
| Turns ledger (`session_turns`) | None; nearest is the per-session `seq` in `EventSequenceTable` | The ledger exists to map to a harness-native session id; with no harness there is nothing to map |
| Streams row + Redis nest | In-memory runner map and status events | Single node, one writer per session; clustered ownership is on their future list (`specs/v2/session.md:109, 185`) |
| Interactions (durable gates, verdicts) | In-memory pending map + `permission.list` | No durable approval, no webhook path, no audit |
| Mounts (object store + geesefs) | The host filesystem | Their bash "is not sandboxed" by design (`specs/v2/session.md:204`) |
| Keepalive pool (parked processes) | Nothing to park; the server is the process | The open turn plays the role of our warm park |

What they avoid structurally: the whole continuation ladder (no native session file to
trust or invalidate), heartbeat-latency cancel (in-process interrupt), the
answered-cards-resurrect bug class (pending truth is queryable and tool status is the
durable answer), and the split between transcript and model context (one store, one
translation).

What they lack that we have and need: multi-tenant projects and authorization, remote
sandboxed execution with credential isolation, harness choice (their loop is their only
agent; we host Pi and Claude Code), durable approvals with webhook delivery and
re-invocation references, an audit trail, ingest quotas, and any notion of a runner fleet.
Their single-file, single-process shape is the reason their session code is small; it is
also the reason it cannot be our architecture.

Against our two open gaps: gap 5 (cancel and steer) is where their design is most
instructive, because both halves are data problems in their system, not signaling
problems: cancel is an immediate interrupt followed by honest durable settlement, and
steer is a durable inbox with explicit delivery semantics. Gap 6 (live mid-turn attach)
is solved by the combination we lack: prompt boundary persistence plus a per-session
durable cursor plus a replay-then-tail read path with the wake registered before replay.

## 6. Learnings

**Adopt.**

1. A per-session monotonic sequence and a replay-then-tail read contract, for gap 6. Our
   records plane already persists promptly but orders by ingest time and restarts
   `record_index` per execution (`architecture.md` section 2). Adding a per-session
   sequence at ingest, an `after` cursor on the records query, and a tail wired to the
   ingest path gives exactly their `sessions.events` contract
   (`packages/core/src/event.ts:585-604`). Their two details worth copying verbatim:
   register the live subscription before the historical read so the handoff cannot drop
   an event, and keep live-only deltas out of the replayable stream so a cursor always
   equals a persisted row.
2. Steer and queue as durable inbox rows with admitted and promoted states, for gap 5 and
   for db58551b defect 6. "Is this request an answer to the gates or new work" stops
   being a dispatch heuristic and becomes a field: a prompt with `delivery: steer`
   promotes at the next safe boundary, a `queue` prompt waits for idle, and an approval
   answer is neither. Our runner's parked dispatch would then consume answers from the
   interactions plane and prompts from the inbox, and could never again consume new text
   as a stale resume (`packages/core/src/session/sql.ts:140-166`,
   `specs/v2/session.md:155-171`).
3. Terminal-evidence discipline on tool calls, confirming the db58551b fix plan. Their
   only writers of terminal tool state are real settlement, explicit abort cleanup that
   marks calls interrupted while preserving partial output
   (`processor.ts:577-596`), and a drain-start reconciliation that durably fails calls
   left `running` by a dead process (`runner/llm.ts:119-139`). Nothing ever fabricates a
   success, and the interrupted marker even feeds the partial output back to the model
   (`message-v2.ts:326-336`). Our post-pause sweep should converge on exactly this set of
   writers.

**Adapt.**

4. The durable-boundary versus live-delta split as a schema contract. We already coalesce
   deltas at persist time; declaring per record type whether it is replayable (with the
   full value) or ephemeral would let the attach endpoint and the audit story reason
   about the log instead of about persistence behavior
   (`packages/schema/src/session-event.ts:208-218`).
5. Approval generalization at answer time. Their `always` reply saves wildcard rules
   derived per tool (the bash arity dictionary) and immediately settles other pending
   cards the new rule covers (`permission/index.ts:145-166`, `shell.ts:408-409`). For us
   this maps to an "always allow this command shape for this session or agent" option on
   the approval card, resolved in the runner's policy layer; it needs adaptation because
   our rules must be tenant-scoped and durable rather than instance memory.
6. Reject with a message as model feedback. Their reject can carry text that reaches the
   model as a correction instead of a bare denial (`permission/index.ts:121-127`). ACP
   permission outcomes can carry equivalent context; our deny path currently sends only
   the verdict.
7. Their reject-cascade policy (one rejection cancels every pending gate in the session,
   `permission/index.ts:129-139`) is a defensible product answer to partial answer sets:
   rejection means stop. If we adopt it, it belongs in the runner's gate bookkeeping, and
   it would have turned the db58551b partial-answer deadlock into a clean stop.

**Does not transfer.**

8. In-memory pending approvals. Holding the turn open on a process-lifetime deferred is
   only safe when the asker, executor, and answer route share a process and the client
   connection model tolerates long-open turns. Our gates outlive browser requests,
   arrive from webhooks, and must survive runner restarts; the durable interactions plane
   stays.
9. Event-plus-projection in one transaction. Their consistency guarantee depends on one
   SQLite file owned by one process (`event.ts:236-353`). We are cross-database and
   cross-process by necessity; our nearest equivalent remains idempotent upserts plus the
   sequence from learning 1.
10. No liveness plane. They need no Redis nest because exactly one process can run a
    session and clients never contend for execution. Our owner, alive, and running locks
    exist because many runner replicas serve many tenants; their own spec lists
    "clustered Session execution ownership and stale-runtime fencing" as unsolved future
    work (`specs/v2/session.md:109, 185`), which is a useful reminder that our streams
    plane is us already paying a cost they have merely deferred.

## Verdict on the choices we just made

Per-card dispatch is vindicated: their reply names one request id, one click delivers one
answer, and no code path anywhere waits for sibling cards
(`handlers/session.ts:362-380`). Persisting the answer half of a gate is vindicated in an
indirect way: their durable answer is the tool call's status transition, and every rebuilt
client reads settled state rather than reconstructing "waiting" from requests, which is
the same invariant our `interaction_response` record restores. The turns ledger is
neither vindicated nor contradicted: OpenCode simply has no harness-native session id to
map, which confirms the ledger is an artifact of driving external harnesses, not a
conversation primitive; the conversation primitive their design argues for is the
per-session durable sequence. Park and warm resume is the one place their design pushes
back: they never park because the open in-process turn is their warm state, and their v2
direction is to make every resumable thing a durable row rather than a held process. Our
keepalive pool remains justified by sandbox and model-context reuse economics, but the
inbox learning says the dispatch decisions around a parked process should be driven by
durable data, not by what happens to be in the pool.
