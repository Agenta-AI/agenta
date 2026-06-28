# Tasks — Transcripts

> Ordered, design-first. No implementation until [specs.md](./specs.md) open questions are
> resolved. `[ ]` = not started.

## 0. Decide (blockers)

- [x] Transcripts live in the **tracing DB**, flat table `transcripts` (no session prefix),
      API = `/sessions/transcripts/` (sessions namespace) filtered by `session_id` (NOT
      `/sessions/{id}/…`).
- [x] **Ingest = DEDICATED queue + worker** (own transcript Redis-Stream + transcript worker,
      NOT reusing the spans/events pipeline).
- [x] **Ordering: uuid7 `id`, no stored `seq`.** Decouples from runner affinity.
- [x] **Dedicated retention window** (transcripts ≠ spans ≠ events — each its own).
- [x] **Payload truncation: per-line max size** at ingest, mirroring spans (no blob-by-ref v1).

## 1. Schema (tracing DB)

- [ ] `transcripts` table: `id` (uuid7 pk, the ordering key), `session_id` (indexed),
      `project_id`, `event_index?`, `sender?`, `session_update?`, `payload` JSONB,
      `created_at`. **No `seq` column.**
- [ ] Migration in the tracing DB migration set.
- [ ] Wire into a **dedicated** transcript retention flush (own window; see §5).

## 2. DB + service

- [ ] DAO: `append_event(session_id, …)` (plain insert, uuid7 default id) and
      `get_transcript(session_id)` ordered by `id`. Optional read-time `row_number()` ordinal.
- [ ] Service = `/sessions/transcripts/` (query by `session_id`); read enforces project scope +
      the tracing view permission (`VIEW_SPANS`/`VIEW_EVENTS`-style; RBAC covers tracing — no
      special cross-DB story).
- [ ] Tenant scope (`project_id`) + ownership on read.

## 3. Ingest (DEDICATED queue + worker — own stream, not the spans/events one)

- [ ] Runner → ingest **enqueues** the event to a **dedicated transcript Redis-Stream**; a
      **dedicated transcript worker** consumes and writes the DB. Not a synchronous endpoint
      write; not the spans/events stream.
- [ ] Truncate each event's `payload` to a per-line max at ingest (mirror spans).
- [ ] `POST /sessions/transcripts/query` (or `GET ...?session_id=`) read (inspect + replay).
- [ ] Validate `session_id` shape (SEC-8); enqueue is internal (runner-only).

## 4. Runner-side producer path (port from PoC `server.js`)

- [ ] Producer-driven persist: **enqueue** every ACP event as produced, **not** gated on a view
      client (the worker writes the DB).
- [ ] Per-session serialization (promise chain) → produced-order enqueue.
- [ ] Bounded retry with backoff; log + count drops, never silently lose an event.
- [ ] **`drainPersist` before `_done`/teardown** — final message durable before sandbox dies.
- [ ] **`stripReplay`** — strip the injected replay block before storing (correctness; stops
      nested-replay doubling on resume).
- [ ] Coalesce `agent_message_chunk` → `agent_message`; drop empty standalone artifacts.

## 5. Retention (mirror events/spans)

- [ ] Entitlements: add a **dedicated** transcripts retention quota in `api/ee/src/core/access/
      entitlements/types.py` (`Counter.TRANSCRIPTS_*` with its own `Retention` window — NOT
      reusing TRACES; transcripts/spans/events each have their own).
- [ ] Retention service: transcripts flush mirroring `TracingRetentionService`, Redis-locked.
- [ ] Admin endpoint: `POST /admin/transcripts/flush` mirroring `/admin/spans/flush`.
- [ ] Cron: `api/ee/src/crons/transcripts.sh` + `.txt` mirroring `crons/spans.sh`.
- [ ] Privacy erase path (Open question 4) — explicit per-session transcript delete.

## 6. Tests

- [ ] Unit: `stripReplay` (idempotent, only strips the replay prefix), coalescing, empty-drop.
- [ ] Integration: DAO append/read against the tracing DB; ordering by uuid7 `id` is stable.
- [ ] Acceptance: run → fetch transcript → resume → fetch again, assert no nested replay and
      stable order. Both editions.
- [ ] Concurrency: two events written near-simultaneously for one session both persist and
      sort deterministically by `id` (no collision, no lost event) — proves the no-`seq` design.

## Cross-worktree dependencies

- **sessions-persistence** consumes `get_transcript` as the replay source (the persist
  driver's `listEvents`). Keep the read shape stable for it.
- **runner-scalability**: no longer a hard dependency for ordering (uuid7 removes the
  single-writer requirement). Still relevant for `drainPersist`-before-teardown and
  detach-never-cancels on the producer path.

## Out of scope

- The agent SessionRecord / resume mechanics (sessions-persistence).
- Inspect UI for transcripts (frontend follow-up).
