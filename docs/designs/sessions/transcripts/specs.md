# Transcripts — specs

> Status: **draft for discussion**. Distilled from `poc-persistent-sessions`
> (`sessions/demo/`), cleaned up and re-homed into the tracing subsystem. Not implemented.

## Problem

An agent run produces a stream of ACP events (user prompt, agent messages, tool calls,
results). The product needs that stream **durably stored, append-only**, so that:

- a session can be replayed/inspected after the fact (observability),
- a resumed run can re-feed prior context to the harness (the replay source for
  sessions-persistence),
- it is independent of whether any client is connected when the events are produced.

Today there is no durable transcript (audit FUN-1). The PoC proved the shape: the runner
POSTs every event to a store **as it is produced**, with a dense per-session sequence, and a
persist driver reads it back on resume.

## Core decision: transcripts live in the tracing DB, not the core DB

A transcript is **append-only, high-volume, and retention-governed** — exactly like spans
and events. It does **not** belong in the core (config) database with mounts/sessions
config. It belongs alongside `events`/`spans` in the **tracing database**, where the
retention machinery already lives.

Consequences:

- **No session prefix at the DB level.** The table is just `transcripts` (mirroring how
  `events` and `spans` are flat tables keyed by their ids + attributes, not nested under a
  session). The session linkage is a column/attribute, not a table-name prefix.
- Retention periods apply uniformly via the tracing DB's existing retention path.
- The write path is producer-driven and decoupled from any read/inspect client.

## Service / endpoint surface: `/sessions/transcripts/`, filtered by `session_id`

Under the `sessions` namespace (fixed sub-path), **not** `/sessions/{id}/transcript` (no id
mid-path). Same shape as `/sessions/states/`, `/sessions/runners/`, `/sessions/mounts/`,
`/sessions/interactions/`. Reads:

- `POST /sessions/transcripts/query` (or `GET ...?session_id=`) — the event log for a session
- one event by id if ever needed: `/sessions/transcripts/{id}` (`id` = the row's uuid7)

So: **DB = `transcripts` (flat, tracing DB); API = `/sessions/transcripts/`, `session_id`
filter.**

## The write path (producer-driven, client-independent)

Ported from the PoC `server.js` + `db.append_event`:

1. As the runner produces each ACP event it enqueues it to the transcript ingest — a
   **dedicated queue + worker** (its own Redis-Stream + transcript worker, same *shape* as
   spans/events but **not the same pipeline**), **not** a synchronous DB write and **not** gated
   on any `/invoke`/view client. The worker consumes the stream and writes the DB → backpressure,
   decoupled from DB latency. (PoC did a direct `POST /events`; we upgrade to a dedicated
   Streams→worker.)
2. The ingest assigns a **dense per-session `seq`** at insert (count-at-insert), giving a
   monotonic, gap-free order independent of the harness's own `event_index` (which resets
   per resume).
3. Writes are **serialized per session** (a promise chain in the runner) so they land in
   produced order; the run is **not** blocked on persistence mid-stream.
4. **Bounded retry** on transient ingest failure (PoC: 3 tries, backoff) so an event is not
   silently dropped from the durable record.
5. Before a run reports `_done` (and before any sandbox teardown), the runner **drains** its
   pending persists for that session, so the final `agent_message` can't be lost to a
   teardown race.

### `stripReplay` — must port

On resume the SDK prepends the prior transcript to the live prompt as a synthetic text
block. If persisted, the *next* resume would replay a transcript that already contains a
replay → nested, doubling context every turn. The runner must **strip the injected replay
block before storing** so the transcript only ever holds the real user prompt (PoC
`stripReplay` + `REPLAY_PREFIX`). This is a correctness invariant, not an optimization.

### Coalescing

`agent_message_chunk`s are coalesced into a single `agent_message` before persist; standalone
empty `agent_message` artifacts are dropped (they'd shadow the good message). Port from
`streamSession`.

## Proposed schema (tracing DB)

Flat table `transcripts`, keyed like the PoC's `session_transcripts` but un-prefixed (the
tracing DB has no prefixes — it parallels `spans` / `events`):

| Field | Type | Notes |
|---|---|---|
| `id` | UUID (v7) | time-ordered pk — **this is the durable ordering key** |
| `session_id` | UUID | the session this event belongs to (indexed) |
| `project_id` | UUID | tenant scope (for retention + ownership) |
| `event_index` | int? | the harness's raw eventIndex (resets per resume) — kept for debug only |
| `sender` | str? | who produced it |
| `session_update` | str? | ACP update kind (`agent_message`, tool_call, …) |
| `payload` | JSONB | the event body (replay-stripped) |
| `created_at` | ts | |

### Ordering: uuid7, not a stored per-session `seq`

The PoC stored a dense per-session `seq` (count-at-insert). That was a single-writer hack —
two concurrent writers to one session read the same `MAX(seq)` and collide. We drop it.

Durability needs two things: **durable storage** + **stable order**. The **uuid7 `id`**
gives both — it is time-ordered by construction, globally unique, and already our standard
id everywhere (uuid7/uuid5-derived per repo convention). So:

- **Order transcripts by `id`** (tiebreak `created_at, id` if ever needed). No stored
  counter, no scoped sequence, no insert-time lock/retry.
- **No native Postgres "per-(project, session) auto-increment" exists** — `SERIAL`/`IDENTITY`
  are table-global, not per-group. The only ways to get a stored dense per-session counter
  are (a) count-at-insert under a lock/serializable-retry, or (b) a bumped counter row
  (`UPDATE session_seq SET next = next+1 RETURNING next`). Both add a write and a contention
  point. **We need neither, because uuid7 ordering is sufficient.**
- If a client ever needs a human ordinal ("message #3"), compute it **at read time**:
  `row_number() over (partition by session_id order by id)`. It's presentation, not storage.

**Consequence — a deliberate decoupling:** ordering no longer depends on "one runner per
session" (the runner-scalability affinity invariant). Even if two replicas ever wrote to one
session concurrently, uuid7 ordering stays correct (worst case: two same-millisecond events
tiebreak by random bits — acceptable for a transcript; they're effectively concurrent). The
runner stops being the source of truth for ordering; **Postgres is** (via the uuid7 default).
If strict *causal* per-session order is ever required, fall back to the bumped-counter row —
not worth the cost up front.

Read API mirrors the PoC `get_transcript`, ordered by `id`.

## Endpoints (proposed)

- ingest (internal, runner → service): append one event — a tracing-internal ingest path
  (likely the Streams→worker path, see Q1), carrying `session_id` + `project_id`.
- `POST /sessions/transcripts/query` (or `GET ...?session_id=`) — ordered event list (inspect +
  replay source).

## Retention (mirror events/spans exactly)

Transcripts are append-only and retention-governed, so they get the **same retention
machinery events and spans already have** — not an ad-hoc TTL:

1. **Entitlements**: add a transcripts retention quota in the same place as traces. The repo
   models per-plan retention via `Counter.<X>.retention` (`api/ee/src/core/access/
   entitlements/types.py`; `Retention` enum = EPHEMERAL/HOURLY/DAILY/MONTHLY/…). Add a
   `Counter.TRANSCRIPTS_*` (and/or reuse the TRACES retention window — Open question 3) so a
   plan defines how long transcripts live.
2. **Retention service**: a transcripts retention flush, mirroring `TracingRetentionService`
   — delete transcript rows older than the plan's retention, across all plans, wrapped in a
   **Redis lock** (as the spans flush is).
3. **Admin flush endpoint**: `POST /admin/transcripts/flush`, mirroring
   `POST /admin/spans/flush` / `/admin/events/flush` (`api/ee/src/apis/fastapi/spans/
   router.py`, admin-only, `Authorization: Access <AGENTA_AUTH_KEY>`).
4. **Cron**: `api/ee/src/crons/transcripts.sh` + `.txt`, mirroring `crons/spans.sh` —
   curls the flush endpoint on a schedule with a long `--max-time` (retention is slow).

## What we drop / change from the PoC

- The ad-hoc `/events` + `session_transcripts` in a single demo Postgres → tracing DB, flat
  `transcripts` table.
- `/invoke`-coupled persistence (PoC already moved off this) → strictly producer-driven.
- No "delete session cascades transcript" default; deletion is governed by retention, with
  an explicit admin/erase path if needed (privacy).

## Cross-cutting (see interactions/cross-cutting-review.md)

- **~~C2 cross-DB ownership~~ — WITHDRAWN.** RBAC already covers tracing (`VIEW_SPANS` /
  `VIEW_EVENTS` are tracing permissions); a transcript read enforces the same way spans/events
  do (project scope + tracing view permission). No special cross-DB story.
- **B3 — cleanup by design.** Transcripts stay on **tracing retention** (entitlement + cron),
  plus the **`project_id` `ON DELETE CASCADE`** every facet has. NOT a session-level cascade —
  `session_id` is not an FK (sessions may be external; finding A). A session-level delete is a
  deferred post-five feature.
- **D2 — ingest = a DEDICATED queue + worker** (own transcript Redis-Stream + worker, NOT
  reusing the spans/events pipeline), not a synchronous write.

## Decided

- **Ingest = DEDICATED queue + worker.** A **dedicated transcript Redis-Stream + transcript
  worker** — NOT reused from the spans/events pipeline. Everything independent.
- **Ordering = uuid7 `id`, no stored `seq`** (see "Ordering"). Read-time `row_number()` if a
  human ordinal is ever needed.
- **Dedicated retention window.** Transcripts get their **own** retention window — separate from
  spans, separate from events. Three independent windows / `Counter.*.retention` entries / flush
  paths / crons.
- **Payload truncation = per-line max size**, mirroring how spans truncate (cap each transcript
  event's payload at ingest; no blob-by-reference for v1).

## Open questions (for discussion)

None for v1. (Privacy / explicit "forget this session's transcript" erase is **deferred** — it
ties to the deferred session-level delete; for now project-cascade + retention cover deletion.)
