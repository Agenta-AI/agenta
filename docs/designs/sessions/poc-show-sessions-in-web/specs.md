# POC — show sessions in web — specs

> Status: **in progress**. This worktree (`poc/show-sessions-in-web`) is a two-phase POC:
> **Phase 1** corrects the streams backend (data model, endpoints, behaviour); **Phase 2**
> builds a web "sessions inspector" drawer on top of the corrected API. The discussion and
> rationale live in `big-agents-audit/sessions-streams-planes-and-nest.md` (non-git
> companion folder); this doc is the implementation spec distilled from it.
>
> This supersedes the streams facet of `docs/designs/sessions/streams/specs.md`. That doc
> describes the older 5-slice decomposition (`session_runners`, `sandbox_live`/`last_seen_at`,
> the DATA/FORCE matrix). The code already landed as `session_streams`; here we finish the
> job — the nest as flags, a single source-of-truth read, a user-facing kill, and the
> verb-first operation ids.

## The two planes (mental model — do not collapse)

1. **Execution plane** — `services/agent/` runner. One HTTP contract: a run request in, an
   NDJSON event stream out. This is where the agent actually runs. Renamed `POST /run` →
   `POST /stream` in this phase (it streams; the name should say so), plus a new idempotent
   `POST /kill`.
2. **Coordination plane** — `api/.../sessions/streams/*` (Python, plain JSON). Never streams.
   It edits the lock/row nest. The renamed `set_session_stream` (was `invoke`) is a
   **state edit** over locks + the durable row; it runs nothing.
3. **Bridge** — already wired in the runner: a session-owned run (`sessionId` + `runId`)
   survives client disconnect, persists every event producer-side (transcript ingest), and
   heartbeats the alive lock for the run's lifetime. The coordination plane never talks to a
   socket; the runner is the only component that observes the live connection.

## The nest (three levels)

`alive ⊇ running ⊇ attached`. Invariant: `attached ⟹ running ⟹ alive`.

- **alive** — the session/run is claimed; the runner owns the lock and is persisting the
  transcript. **Survives client disconnect.** (Redis `alive:session:<id>`, TTL 3600s.)
- **running** — a turn is actively executing right now (an SSE/NDJSON stream is producing).
  **Distinct from alive**: a session can be alive-but-idle between turns. (Redis
  `running:session:<id>`, TTL = alive TTL; set when a turn starts, cleared when it ends.)
- **attached** — a client is watching over the socket. (Redis `attached:session:<id>`,
  TTL 60s, refreshed while watching.)

Derived client-side, **not stored**:

- `resumable = is_alive && !is_running` — alive but idle; send without force.
- `reattachable = is_running && !is_attached` — running with nobody watching (the
  "closed the chat" amber case); attach to watch.

`sandbox_live` is **dropped** from the stream nest — the durable mount/sandbox is a separate
domain (`session_states` owns `sandbox_id`), not a stream state.

## The command matrix (prompt × force)

`set_session_stream` derives the action from `prompt` × `force`:

| prompt | force | action |
|---|---|---|
| yes | no  | **send**  — 409 if alive |
| yes | yes | **steer** — cancel the holder, start a new turn |
| no  | no  | **cancel** — cancel the holder, run nothing |
| no  | yes | **attach** — steal the attached lock, watch the live turn |

Two detach mechanisms (neither cancels the run — the runner owns alive):

- **self-detach** — the client closes its own NDJSON socket; the runner observes it.
- **displacement** — a steal publishes on the displaced channel; the prior watcher
  self-closes. Plus a **user-facing detach trigger** (see route surface) so a client can drop
  its own attach without closing the socket.

## Route surface (corrected)

Unified on `/sessions/streams`, keyed by `?session_id=`:

| Method | Path | operation_id | Purpose |
|---|---|---|---|
| GET | `/sessions/streams?session_id=` | `fetch_session_stream` | read the full nest (folds in liveness) |
| POST | `/sessions/streams?session_id=` | `set_session_stream` | the command edit (send/steer/cancel/attach) |
| DELETE | `/sessions/streams?session_id=` | `delete_session_stream` | **kill**: collapse the nest + call runner `/kill` |
| POST | `/sessions/streams/query` | `query_session_streams` | filtered list |
| POST | `/sessions/streams/detach` | `detach_session_stream` | user drops their own attach |
| POST | `/admin/sessions/streams/heartbeat` | `heartbeat_session_stream` | runner → API liveness write |

- **GET read shape** returns **primitive flags only**:
  `{session_id, stream_id, flags:{is_alive,is_running,is_attached}, turn_id, status, updated_at}`.
  `resumable`/`reattachable` are derived client-side.
- `detach` moves from admin-only to a user route (RUN_SESSIONS). The admin heartbeat stays
  admin-only (it is the runner's internal write path).

## Source of truth (Option B)

**Redis is authoritative** for the three nest bools (hot path: locks, sub-second routing).
**Postgres `session_streams` mirrors** them as `flags.{is_alive,is_running,is_attached}` for
durability, the orphan sweep, and observability. The two stores are not collapsed; the GET
read reconciles by reading Redis for the bools and the row for `status`/`updated_at`/ids.

## Row shape (`session_streams`)

Drop `attached` (bool col), `sandbox_live`, `last_seen_at`. Add a `flags` JSONB
(`FlagsDBA`-style) carrying `is_alive`/`is_running`/`is_attached`, and a nullable `turn_id`
column — the Postgres mirror of the Redis alive/running lock value, so an attaching/fetching
client reads the **current** turn off the row (a `stream_id` outlives a succession of
`turn_id`s). Liveness/heartbeat writes update `flags` + `turn_id` + `status` + `updated_at`
(no dedicated heartbeat timestamp column — the shared `updated_at` is the heartbeat). Keep
`IdentifierDBA` (the row `id` = `stream_id`), `ProjectScopeDBA`, `LifecycleDBA`, `StatusDBA`,
the unique `session_id`.

## Naming (the run → turn rename)

A "run" in the streams domain is really **one turn** of an ongoing session. Rename the
turn-scoped symbols; **keep the lock/nest names** (`alive`/`running`/`attached`,
`acquire_alive`):

- `_start_run` → `_start_turn`; `run_id` (the turn correlator) → `turn_id`;
  `SessionRunInUse` → `SessionTurnInUse`.
- `invoke`/`InvokeMode`/`SessionInvokeRequest*`/`SessionInvokeResponse*` → the
  `set_session_stream` command shape (`SessionStreamCommand*`, `CommandMode`).
- The watcher correlator stays **`watcher_id`** (not `token_id` — collides with interactions).

**Rename boundary (be careful):** rename ONLY Plane-B / streams symbols. Do NOT touch
workflows/services `/invoke` + `/inspect`, `invoke_workflow`, or `WorkflowServiceRequest` /
`*Invoke*` in `core/workflows` | `core/invocations`. The runner `/run` → `/stream` rename is
separate. Never blanket-replace `invoke`/`inspect`.

## Wire-field rename — DONE (`runId` → `turnId`)

The turn correlator is now **one name everywhere**: `turn_id` (snake) / `turnId` (wire).
Renamed in lockstep across `protocol.ts`, `wire.py`, `wire_models.py`, the interactions DTO/
DBE/migration, the lock helpers, and both golden contract tests. No `run_id`/`runId` remains
in the sessions/agent path (the evaluations `run_id` is a different domain, untouched).

## Multi-container correctness — `replica_id` distinct from `turn_id`

The heartbeat carries **two ids**: `replica_id` (the runner *container*, minted once per
process via `AGENTA_AGENT_RUNNER_REPLICA_ID` or a uuid — refreshes `owner` affinity) and
`turn_id` (the *turn* — refreshes `alive`/`running`). With 2+ containers, affinity routes
control signals to the box running the session while each box proves its own turn ownership.
This is wired now, not deferred.

## Phase 2 (web demonstrator)

A "sessions inspector" drawer behind a session icon in the playground header. One tab per
session element (mounts / transcripts / states / streams / interactions), each exercising the
real productized endpoint. The streams tab shows the nest (alive/running/attached badges) and
drives lifecycle (attach / detach / kill / respond). **Send/steer/cancel stay the playground
chat's job** — the drawer inspects and drives lifecycle; it is not a second send path.

### The session_id the inspector keys off — read-back, runner-minted

The inspector needs a real backend `session_id` (the conversation correlator the five facets
key off). The playground does not have one today, so Phase 2 adds it — by **read-back**, never
by client minting:

- The playground **sends no `session_id`** on invoke. The runner mints one
  (`resolveRunSessionId` returns its fallback when the request omits it), persists the
  transcript and holds the alive lock under it, and **echoes it back** on the result
  (`AgentRunResult.sessionId`).
- The playground **captures `session_id` from the first run's response** at the same point
  it already extracts `trace_id`/`span_id` (the `executeViaFetch` normalizer), threads it onto
  the `ExecutionResult`, and **persists it per panel** in playground execution state.
- `session_id` stays **null until the first invoke returns it**. Pre-minting a client-side id
  was rejected: its only benefit was opening the inspector before the first run, but there is
  no nest / transcript / state to inspect before the first run anyway.

**Two unrelated "session" concepts — do not conflate (they are different axes):**

| concept | what it is | scope | crosses to API? |
|---|---|---|---|
| `"sess:<runnableId>"` (`ExecutionSession.id`) | a playground **UI column key** — which compare-column a streamed message renders in | per **revision** (same every open of that revision) | **never** |
| backend `session_id` | the durable **conversation correlator** (alive lock, transcript, state, mounts, interactions) | per **conversation thread** (a new chat is a new id) | yes — this is what the inspector uses |

One revision column hosts **many** backend sessions over its life. `"sess:<runnableId>"` must
**never** be sent as the invoke `session_id` — it would collapse every conversation on that
revision onto one lock/transcript/state. The panel simply *holds* a runner-minted `session_id`
alongside its column key once the first run returns one.

### Inspector surface

The session icon lives in the **playground header, per panel**, disabled until that panel has
a `session_id`. Clicking it opens the drawer keyed off that id. The drawer is an
`EnhancedDrawer` (`@agenta/ui/drawer`) with antd `Tabs`, one tab per facet, each calling
`getAgentaSdkClient().sessions.*`:

| tab | endpoint(s) | shows / does |
|---|---|---|
| streams | `fetchSessionStream`; `setSessionStream` (attach); `detachSessionStream`; `deleteSessionStream` (kill) | nest badges (`is_alive`/`is_running`/`is_attached`; `resumable`/`reattachable` derived client-side) + attach / detach / kill controls |
| transcripts | `queryTranscripts` (+ `getTranscriptEvent` on expand) | the persisted event log |
| states | `getState` | the durable record (incl. `sandbox_id`) |
| mounts | `querySessionMounts` | bound durable directories |
| interactions | `queryInteractions`; `respondInteraction` | pending interactions + respond |

Placement: the drawer is one feature's UI keyed off a `session_id`, used only here for now →
**app layer** (`web/oss/src/components/...`), not a package (per the package-practices 2+-features
heuristic). It mirrors the existing `SharedDrawers/SessionDrawer` *pattern* but is its own
session-scoped component — distinct from that drawer, which is trace/turn-scoped (reads
`ag.session.id` off span attributes, opened from the observability SessionsTable).

## Decided

- Nest as `flags.{is_alive,is_running,is_attached}`; `sandbox_live`/`last_seen_at` dropped.
- Redis authoritative, Postgres mirror (Option B); GET reconciles.
- New `running:session:<id>` Redis key, TTL = alive TTL; set on turn start, cleared on end.
- Unified GET/POST/DELETE on `/sessions/streams?session_id=`; verb-first operation ids.
- User-facing `detach` + `kill` (DELETE → runner `/kill`).
- run → turn rename for turn-scoped symbols; lock/nest names unchanged.
- Runner `/run` → `/stream` + new idempotent `/kill`.

## Open questions

- **Kill → runner reach**: the platform API has no runner client (the runner calls *into*
  the API, not the reverse; there is no `AGENTA_AGENT_RUNNER_URL` in `api/.../env.py`).
  **Decided for Phase 1**: `delete_session_stream` collapses the nest in Redis (force-clear
  alive + running + attached) + marks the row `ended` + soft-deletes. Force-clearing `alive`
  makes the owning runner's watchdog lose the lock, which is the existing teardown signal; the
  runner's new idempotent `/kill` is for the orphan sweeper (runner-scalability slice) to call
  out-of-band, NOT an inline API→runner HTTP hop. Wiring an API→runner kill client is deferred
  to when the runner URL/affinity lands.
- **Orphan sweep**: the current row carried `sandbox_live`/`last_seen_at` to drive the sweep.
  With those dropped, the sweep keys off stale `updated_at` + `flags.is_alive=true` whose
  Redis `alive` key has expired. Confirm the sweeper (not in this worktree's diff yet) reads
  that shape, or leave a typed TODO. **Leaning: leave the row shape sweep-ready, defer the
  sweeper itself** (it lives in the runner-scalability slice).
- **`running` lock writer**: `running` is set by the runner at turn start (it owns the live
  stream) and cleared at turn end — OR the API sets it in `_start_turn` and the runner's
  watchdog refreshes it. **Leaning: API sets+clears `running` around the turn** (mirrors how
  it already sets `alive`/`status`), runner only refreshes via heartbeat. Confirm during impl.
