# M3 — per-session live relay (grounded design)

**Status:** PLANNED · **Date:** 2026-07-27 · **Branch:** `feat/agenta-mobile-wave-1`
**Parent:** `2026-07-27-mobile-approvals-steering.md` §3 Phase M3, §4b decision 1 (the standing
follow-up: an open desktop must eventually live-update a turn the phone resumed, and vice versa).
**Problem:** live tokens are the HTTP response of whichever client POSTed the turn. Every event
IS persisted producer-side regardless of watchers. M3 lets ANY authenticated client subscribe to
a session's live event flow (SSE) so no one has to own the turn to see it move.
All findings code-trace verified (file:line); nothing executed live. PLANNING ONLY.

---

## 1. Grounded findings

### 1.1 The tee is record-granularity by construction — tokens never reach it

The producer-side persistence path, end to end:

1. **Runner:** `buildPersistingEmitter` (`services/runner/src/sessions/persist.ts:160-354`)
   forwards every raw `AgentEvent` to `liveEmit` (the invoke response stream) but **coalesces
   before persisting**: `message_start/delta/end` accumulate and persist ONCE as
   `{type:"message", text}` on `message_end` (persist.ts:234-263); `thought_*` likewise
   (persist.ts:264-293); `tool_call` arg-snapshots accumulate into one open slot persisted on
   close/idle-TTL (persist.ts:206-232, `OPEN_TOOL_TTL_MS` = 3s, :145). **Individual deltas are
   never POSTed anywhere.** Each coalesced record goes through a per-session ordered
   fire-and-forget chain (`persistEvent`, persist.ts:95-122) → `POST /sessions/records/ingest`
   (persist.ts:49), 3 retries then drop (persist.ts:27-28, 85-88). The run is never blocked on
   persistence (header invariants, persist.ts:13-17).
2. **API ingest:** `ingest_record_event` (`api/oss/src/apis/fastapi/sessions/router.py:510-540`)
   — `RUN_SESSIONS` check → `publish_record` → `XADD streams:records` on the **durable** Redis
   (`api/oss/src/core/sessions/records/streaming.py:51-97`; maxlen 100k, zlib+orjson, 64KB
   attribute cap).
3. **Worker:** `RecordsWorker` (`api/oss/src/tasks/asyncio/sessions/records_worker.py:19-160`),
   hosted by `api/entrypoints/worker_streams.py:80-86` in the worker-streams process —
   `XREADGROUP` batches (max 50, `max_delay_ms=250`, idle block 5000ms), groups by project, EE
   quota check, then `append_many` upsert into Postgres
   (`api/oss/src/dbs/postgres/sessions/records/dao.py:56-97`).

**Consequences for a relay:**

- A tee off this path carries **coalesced records** (`message`/`thought`/`tool_call`/
  `tool_result`/`interaction_request`…), not token chunks. Token-level fidelity is not available
  here at any price.
- The runner has **no Redis client** (`services/runner/package.json:22-37` — no redis/ioredis
  dep; the contract file `src/sessions/contract.ts` mirrors wire *shapes* only). Token-level
  relay would mean either per-delta HTTP POSTs (the coalescing exists precisely to avoid that
  volume) or brand-new runner→Redis infrastructure.
- Two zero-risk tee points exist, both already off the run's request path:
  - **(a) ingest handler, post-XADD** — the record payload is in hand; but it fires BEFORE the
    Postgres write (worker is async), so a notified client that revalidates immediately can
    miss the row.
  - **(b) `RecordsWorker.process_batch`, post-`append_many`** — fires strictly AFTER the DB
    write; batching gives free debounce (≤ ~4 notifications/s/session worst case at
    `max_delay_ms=250`, typically far less); adds zero latency/failure risk to persistence
    (a failed publish is log-and-continue after the append already committed).

### 1.2 The record log is NOT append-only — a DB cursor is unsound

- `record_id` is runner-supplied uuid5 (tool-family, retry-stable) or backend-minted **uuid4**
  (`api/oss/src/dbs/postgres/sessions/records/mappings.py:16-20`) — NOT time-ordered. The
  parent plan's §C sketch ("uuid7 record id = natural resume token") is **wrong**.
- `append_many` is an upsert on `(project_id, record_id)` that **updates rows in place**
  (dao.py:84-97) — a re-sent tool_call record mutates an old row whose `created_at` sits behind
  any cursor. Read order is `created_at ASC, record_index ASC` (dao.py:112).
- `get_records` has no windowing at all — it is always the whole log (dao.py:99-116;
  `query_records` router.py:468-489 passes only `session_id`).

So "replay records from cursor, then follow the channel" (parent §C.1) is not sound as
specced. A payload-carrying relay would need client-side upsert-by-record_id semantics AND
either an `updated_at`-based delta query or accept-missed-mutations. A change-notification
relay sidesteps all of it: the notification carries no data, the client re-reads the whole log
through the existing (IDB-persisted, deduped) query.

### 1.3 Transport: Redis pub/sub exists in both flavors; the API has no SSE yet

- Two Redis planes: **volatile** (`CacheEngine`/`LockEngine`,
  `api/oss/src/dbs/redis/shared/engine.py:9-83`) and **durable** (`StreamsEngine`,
  engine.py:85-105, `REDIS_URI_DURABLE` — `api/oss/src/utils/env.py:1259`). They may be
  different instances — publisher and subscriber must pick ONE plane.
- Pub/sub precedent: exactly one — the attach-steal `displaced:` channel publish
  (`api/oss/src/dbs/redis/sessions/locks.py:178-196` via `LockEngine.publish`; naming +
  tenant-boundary rules in `api/oss/src/dbs/redis/sessions/contract.py:7-19, 60-61`). Zero
  subscribers anywhere (re-verified: no `.subscribe()`/`pubsub()` in api). Pattern to mirror:
  project-scoped channel names, payload shape defined in `contract.py`.
- **No SSE endpoint exists.** `StreamingResponse` is used only for zip/file downloads
  (`api/oss/src/apis/fastapi/mounts/utils.py:104-152`) and testsets. No `sse-starlette` dep
  (`api/pyproject.toml`) — plain `StreamingResponse(media_type="text/event-stream")` on
  fastapi 0.139 suffices; heartbeat comment frames replace the library.
- Auth on a long-lived GET: `auth_middleware` (`api/oss/src/middlewares/auth.py:134`,
  registered `api/entrypoints/routers.py:469` via `app.middleware("http")`) accepts Bearer,
  ApiKey, AND the `sAccessToken` cookie (auth.py:290), and sets
  `request.state.{user_id,project_id}` once at request start — the SSE handler then does the
  same `check_action_access(VIEW_SESSIONS)` as `query_records` (router.py:475-480). Auth is
  evaluated once at connect; scope holds for the connection's lifetime (standard SSE; cap the
  connection age server-side if that ever matters).
- Proxy path: Traefik routes `/api` → api:8000 with a strip-prefix middleware only
  (`hosting/docker-compose/oss/docker-compose.dev.yml:188-194`); no custom responding
  timeouts configured. Heartbeats every ~15s keep any idle timeout (Traefik or client) happy.
  Same-origin `/api` + cookie auth ⇒ native `EventSource` works on both mobile and desktop
  with zero custom headers.

### 1.4 Client side: the push-invalidate seam already exists on both surfaces

- **The gap is even named in code:** `@agenta/entities`
  `src/session/state/records.ts:5` — "no live backend channel for records". The write-atom to
  fire is `revalidateSessionRecordsAtom` (records.ts:111-121); the shared query
  (`sessionRecordsQueryFamily`, records.ts:41-50; staleTime 15s, IDB-persisted,
  always-revalidate-on-restore) dedupes every surface.
- **Mobile already polls exactly the loop a push would trigger:** `useSessionTranscript`'s
  `tick()` (`web/mobile/src/features/chat/useSessionTranscript.ts:42-68`) = invalidate via
  `revalidateSessionRecordsAtom` + `loadSessionMessages` re-read, on a timer set by
  `ChatScreen` (`web/mobile/src/features/chat/ChatScreen.tsx:31-42`): 4s while a decision
  settles, 7.5s while running/pending, 0 idle, foreground-only. The relay replaces the timer's
  *trigger*, not the machinery.
- **Desktop:** records adoption is already server-push-shaped — `useAgentConversation`
  revalidate-on-open adopts the server transcript only when strictly ahead and never over a
  live stream (`web/packages/agenta-chat/src/hooks/useAgentConversation.ts:300-324`,
  count-based, `busyRef`-guarded). A push-invalidate feeds the same `loadSessionMessages` →
  guarded-adopt path. Desktop needs NO change for the M3 BE to ship.
- **Chunk-format reality:** the v6 UIMessage chunk stream desktop's transport consumes is
  minted in the SDK's vercel projection
  (`sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`) from runner NDJSON — that
  projection exists only in the invoke response path. The relay tee sits upstream of it. A
  record-payload relay would feed `transcriptToMessages`-shaped records
  (`web/packages/agenta-chat/src/assets/transcriptToMessages.ts:114-170` handles exactly the
  persisted `record_type` set), so an incremental reducer is *conceivable* — but it is new FE
  work plus the §1.2 upsert/dedupe problem, for paragraph-granularity updates (records land at
  message-END, never mid-message, per §1.1 coalescing).
- **Liveness poll** (`web/mobile/src/features/sessions/useLivenessPoll.ts:13-22`, mirror of
  desktop `web/oss/src/components/AgentChatSlice/state/liveness.ts:29-45`): one project-scoped
  query, 15s-while-alive, stops when idle. Cheap; out of scope to replace in v1 (see open
  question 2).

### 1.5 Lifecycle facts

- Pub/sub crosses API replicas via the shared Redis instance; the SSE connection lives on
  whichever replica served the GET — **no sticky-session trap** (no replica-local state; the
  notification originates in the worker process, not the API replica). Locally everything is
  single-instance (`docker-compose.dev.yml`; the worker-streams process is separate,
  worker_streams.py:122-167). If `RecordsWorker` is ever scaled, consumer-group members each
  publish for their own batches — still correct.
- Cost when nobody is subscribed: `PUBLISH` to zero subscribers is an O(1) Redis op returning
  0 — **cheap publish to nobody**, ≤ ~4/s/session while a turn runs, zero when idle (no
  ingest ⇒ no batches ⇒ no publish). Conditional-publish (subscriber counting) is not worth
  its complexity.
- Backpressure: the notification degenerates to a boolean "changed" per session — coalesce in
  a per-connection queue (drop duplicates while one is unsent). A slow client can never build
  a meaningful backlog.
- Reconnect: `EventSource` auto-reconnects; the client revalidates once on every `open` —
  that single rule covers all missed notifications, so the server needs **no replay, no
  cursor, no delivery guarantees**. (This is the property that makes the notification variant
  ~10x simpler than the payload variant.)

---

## 2. Two-fidelity analysis

### Fidelity A — change-notification relay (recommended)

SSE event says "records changed for session X"; clients revalidate through the existing
records query. Publish from `RecordsWorker` post-append (§1.1 tee point b) so the
notification is strictly DB-write-ordered — the revalidating client always sees the new rows.

- **Latency:** message-end → ingest POST → worker batch (≤ ~300ms when events are flowing) →
  publish → client refetch ≈ **1-2s end-to-end**, vs today's up-to-7.5s mobile poll and
  never-until-reopen desktop. Records land at message/tool granularity anyway (§1.1), so this
  is within one "paragraph" of the best any relay off this tee can do.
- **New code:** one publish call in the worker, one SSE endpoint, one mobile hook. No new
  client reducer, no cursor, no delivery semantics, no contract between relay payload and
  `transcriptToMessages`.
- **Cost note:** each notification triggers a whole-log refetch (~200KB on long sessions,
  backend-slow — parent plan §5). Net requests go DOWN vs the 4-7.5s poll (fetch only on
  change, batch-debounced), but the per-fetch weight is unchanged. If that ever hurts, a
  `since`/windowing param on `query_records` is an independent, later optimization (imperfect
  under §1.2 upserts; would need `updated_at`-delta).

### Fidelity B — record-payload relay (M3.5, only if ever needed)

Publish the record body (tee point a, ingest handler) on the channel; clients apply
incrementally. Honest accounting: needs a new incremental records→UIMessage reducer in
`@agenta/chat` with upsert-by-record_id semantics (§1.2), dedupe against the periodic full
refetch, and a replay story for reconnect that the DB cannot cleanly provide (§1.2) — in
exchange for saving the refetch, NOT for finer granularity (still message-end-level; §1.1).
Skip unless the whole-log refetch cost becomes the measured bottleneck.

### Fidelity C — token-level relay (rejected)

Deltas exist only inside the runner process and its invoke HTTP response (§1.1). Getting them
out requires per-delta runner→API POSTs (the exact volume the coalescing was built to avoid)
or a new runner→Redis dependency (§1.1), PLUS a client-side AgentEvent→UIMessage incremental
projector that exists today only in Python (§1.4). All of that to upgrade "new paragraph
appears in ~1-2s" to "characters tick" on a *watched* (not owned) turn. Not an M3.5 — a
separate product decision (open question 1).

**Recommendation: Fidelity A now.** It kills the poll latency, reuses the poll's own
revalidation machinery as the event handler, ships with no desktop changes required, and its
one moving part (the SSE endpoint) is the piece every later fidelity needs anyway.

---

## 3. Task list

Conventions: new env vars via `env.py` (api/AGENTS.md); channel name + payload shape added to
`contract.py` beside the displaced channel (project-scoped key rule, contract.py:14-19);
domain layering per api/AGENTS.md.

### BE

- **T1 — contract + publish.** Add `records_changed_channel(project_id, session_id)`
  (`records-changed:<project_id>:session:<session_id>`) and its payload shape
  (`{session_id, turn_id?}`) to `api/oss/src/dbs/redis/sessions/contract.py`. In
  `RecordsWorker.process_batch` (`records_worker.py:143-160`), after each successful
  `append_many`, publish ONCE per distinct `(project_id, session_id)` in that project batch,
  using the worker's existing durable redis client (`worker_streams.py:134-138`).
  Log-and-continue on publish failure — persistence is already committed and must not be
  re-driven by relay errors. Unit test with fakeredis: batch with 2 sessions ⇒ 2 publishes,
  each after append; append failure ⇒ no publish for that batch.
- **T2 — SSE watch endpoint.** `GET /sessions/streams/watch?session_id=` on the
  `StreamsRouter` (`api/oss/src/apis/fastapi/sessions/router.py`): `check_action_access`
  (`VIEW_SESSIONS`, mirroring router.py:475-480), validate `session_id`
  (contract.py:121-131), then `StreamingResponse(media_type="text/event-stream")` that
  subscribes a durable-Redis pubsub (`get_streams_engine()`) to the session channel and
  yields `event: records-changed` frames, with a `: heartbeat` comment every 15s and clean
  teardown on client disconnect. v1: one pubsub connection per SSE connection (simplest;
  revisit with a per-process shared listener + local fan-out only if connection counts
  grow). Heartbeat interval as an env-backed setting in `env.py`. Test: endpoint yields the
  event after a publish, heartbeats while idle, 403 without VIEW_SESSIONS.
- **T3 — spec surface.** Set `operation_id` and mount the route so it lands in OpenAPI;
  regenerate the Fern client for the types, but consumption is native `EventSource` (Fern
  does not model SSE) — document that in the route docstring.

### Mobile (the poll this replaces: §1.4)

- **T4 — `useSessionWatch(sessionId, projectId)`** in `web/mobile/src/features/chat/`:
  `EventSource` on `/api/sessions/streams/watch?session_id=&project_id=` (cookie auth,
  same-origin); on `records-changed` → exactly `tick()`'s body
  (`useSessionTranscript.ts:47-62`): `revalidateSessionRecordsAtom` + `loadSessionMessages`;
  on `open` → one revalidation (missed-event coverage); teardown on background/unmount
  (visibility rules as today). `ChatScreen` cadence (`ChatScreen.tsx:38-42`) becomes: SSE
  open ⇒ slow safety-net poll (30s); SSE errored/unsupported ⇒ today's 4s/7.5s cadence
  unchanged (the fallback IS the current behavior — no regression path).

### Deferred (explicitly not in M3)

- **Desktop consumption** — wire the same SSE into `revalidateSessionRecordsAtom` +
  liveness invalidation post-FE-queue, like all desktop work. The reconciler
  (`useAgentConversation.ts:300-324`) needs no changes. The M3 BE ships without this.
- **M3.5 payload relay** — only if the whole-log refetch is measured as the bottleneck (§2B).
- **Liveness/turn-settled over the relay** — see open question 2.

## 4. Open questions for Arda

1. **Is ~1-2s paragraph-level "live" enough as the durable cross-device answer, or is
   character-level streaming on watched turns a product requirement someday?** The former is
   M3 as planned; the latter is Fidelity C — new runner-side producer infrastructure, worth
   knowing about before anyone assumes M3.5 gets there (it does not; §2C).
2. **Should the watch channel also carry turn lifecycle (running/settled/approval-pending) to
   retire the 15s liveness + interactions polls, or stay records-only in v1?** Records-only
   is strictly simpler and the badges' polls are cheap; folding lifecycle in later means
   either a second event type on the same channel (easy) or a project-wide channel for list
   badges (new naming decision).
