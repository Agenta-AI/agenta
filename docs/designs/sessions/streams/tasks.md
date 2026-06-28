# Tasks — Runner scalability

> Ordered, design-first. No implementation until [specs.md](./specs.md) open questions are
> resolved. `[ ]` = not started. Constraint: docker-compose, no gVisor — make 2–3 replicas
> *correct*, not yet hardened.

## 0. Decided

- [x] **Coordinate via Redis** (not route-to-owner): cancel/steer → Redis channel → owning
      runner is subscribed. Runner connects to the same Redis; durable `session_runners` writes
      go through the API.
- [x] `session_runners` separate from `session_states` (different durability tiers); 1:1.
- [x] **Concurrency cap: per-container, start ~1000** (tune once we measure per-run resource
      use). Behavior on cap → see §4.
- [x] Liveness/heartbeat: throttled durable writes (Redis hot; Postgres lazy).

## 1. Redis coordination plane — ONE CONTRACT, TWO IMPLEMENTATIONS

- [ ] **Author the contract** (single source of truth): key names (`alive:session:<id>`,
      `attached:session:<id>`, `owner:session:<id>`, `displaced:session:<id>`), TTL constants,
      displacement-channel payload shape, release-if-owner Lua.
- [ ] **Python implementation** (API utils) of the contract.
- [ ] **TS implementation** (runner utils) of the contract — duplicated deliberately (language
      barrier; no shared runtime). Lives where the runner needs it.
- [ ] **Golden-fixture contract test** both sides assert against (like `protocol.ts ↔ wire.py`)
      so the two implementations can't drift.
- [ ] Global session run lock (`alive`): acquire/force-cancel/release; `409 in_use` with
      `{alive, attached, reattachable}` (port PoC `run-lock.js`).
- [ ] Attach lock (`attached`): unconditional steal + displacement publish; short TTL +
      refresh; release-if-owner Lua (port PoC `locks.py`).
- [ ] Session→runner sticky affinity key with TTL; cancel/steer coordinate through Redis.
- [ ] Detach drops `attached` only — never cancels the run or stops persistence.

## 2. Durable state: `session_runners` (Postgres)

- [ ] DBE: own `runner_id` uuid7 pk (`IdentifierDBA`); `session_id` (bare correlator, **NOT an
      FK**, **unique — 1:1**); `project_id` (FK `ON DELETE CASCADE`); `replica_id?` (owning
      container; distinct from the pk); `attached`, `sandbox_live`, `last_seen_at`, `status`,
      timestamps. **No `sandbox_id`** — that's the single source of truth in `session_states`.
- [ ] DAO + mappings + migration.
- [ ] Heartbeat write path (runner → service) per chosen mechanism.
- [ ] Tenant scope + ownership.

## 3. Control endpoints (the DATA/FORCE matrix)

- [ ] Control on the **`/invoke`**-style surface (carrying `session_id`): SEND / STEER /
      CANCEL / ATTACH / DETACH
      per the matrix (port PoC `/invoke` + `_watch_attached`).
- [ ] Validate `session_id` shape + project ownership before any Redis/runner action (SEC-8).
- [ ] `POST /sessions/runners/query` (filter `session_id`) — liveness/attached/owner. Top-level
      resource, NOT nested under `/sessions/{id}`.
- [ ] Mount in `api/entrypoints/routers.py`.

## 4. Concurrency cap + backpressure (SCA-2)

- [ ] Per-replica max concurrent runs; over cap → `429`/queue (decide which).
- [ ] Optional fleet-wide view via `session_runners` count.

## 5. Orphan sweep (SCA-6)

- [ ] Periodic sweeper: stale `last_seen_at` + `sandbox_live=true` → idempotent kill (port
      PoC `/kill`) → mark `ended`.
- [ ] Make the PoC live-TTL heuristic authoritative via `last_seen_at`.

## 6. Multi-replica validation (the whole point)

- [ ] Run the stack with **2–3 runner replicas** behind the service.
- [ ] Acceptance: start a run on replica A → cancel/steer it from a request that lands on
      replica B → it actually cancels/steers (proves shared run state, fixes SCA-1).
- [ ] Acceptance: attach from a second client steals the view; first detaches cleanly; run
      continues; transcript stays complete (transcripts worktree).
- [ ] Acceptance: kill a runner replica mid-run → orphan sweep reaps the leaked sandbox.
- [ ] Acceptance: exceed the concurrency cap → `429`/queue, no OOM, no leaked sandbox.

## Detached invoke (named deliverable) — interactions first, triggers follow

This worktree owns **detached `/invoke`** ("kick off the turn, return immediately, run
continues server-side"). It's a **named deliverable** — two workstreams block on it.

- [ ] Expose detached invoke as a first-class mode (caller doesn't hold the connection).
- [ ] **Interactions is the FIRST consumer** (respond fires detached + returns). Then it's the
      template for triggers.
- [ ] **Trigger dispatcher detaches** (deferred, see
      `big-agents-audit/sessions-integration-deferred.md`): switch
      `tasks/asyncio/triggers/dispatcher.py` (stored-refs → `invoke_workflow`) to fire-and-forget
      detached invoke; the long-lived **trigger worker may become unnecessary**.
- [ ] On run/turn **cancel**, the runner transitions that run's pending **interactions** →
      `cancelled` (ordinary write). NOTE: a *dead* runner / *deleted* session / *deleted
      project* do NOT need a sweep here — interactions handle those via the **`project_id`
      `ON DELETE CASCADE`** + the TTL read-predicate (no job). `session_id` is NOT an FK (no
      `sessions` table; sessions may be external). So this is just the explicit cancel path.

## Cross-worktree dependencies

- **sessions-persistence**: liveness/affinity split decision; the "one runner per session"
  invariant it relies on for uncontended `record` upserts.
- **transcripts**: detach/cancel must not break producer-driven persistence;
  drain-before-done before any sandbox teardown. (Ordering is uuid7, not affinity-bound.)
- **mounts**: orphan sweep kills the sandbox; the durable cwd survives for the next run.
- **interactions**: respond = detached invoke (this worktree's capability); on run cancel the
  runner writes that run's pending interactions → `cancelled`. (Project-delete + TTL are
  handled inside interactions via `project_id` cascade + read-predicate — no sweep needed.)

## Out of scope (this iteration)

- gVisor / per-tool isolation / microVM-per-tool (larger roadmap).
- Kubernetes autoscaling — docker-compose multi-replica only.
- TLS on the service↔runner hop (SEC-3, separate track).
