# Tasks — Sessions persistence

> Ordered, design-first. No implementation until [specs.md](./specs.md) open questions are
> resolved. `[ ]` = not started.

## 0. Decided

- [x] Liveness lives in `session_runners` (runner-scalability), NOT here — separate tables.
- [x] **No Redis here** — Postgres only (persistence-cache idea dropped).
- [x] `state_id` own uuid7 pk; `session_id` bare correlator (NOT FK), unique 1:1.
- [x] `sandbox_id` single source of truth here; session overlay deferred.

## 1. Postgres — `session_states` (core DB)

- [ ] `api/oss/src/dbs/postgres/session_states/dbes.py` — `SessionStateDBE`: own `state_id`
      uuid7 pk (`IdentifierDBA`); `session_id` (bare correlator, **NOT an FK** — sessions may be
      external; unique 1:1); `project_id` (FK `ON DELETE CASCADE`); **`data` (`DataDBA` = JSON,
      not JSONB)** holding the opaque SDK record; `sandbox_id?`; timestamps. **No `record`
      column.**
- [ ] DAO: `get_session_state`, `set_session_state` (upsert), `set_sandbox_id`.
- [ ] Mappings + migration for `session_states`.
- [ ] Tenant scope + ownership on every read/write.

## 2. Service + endpoints (under `sessions`)

- [ ] `api/oss/src/core/sessions/service.py` (states slice) — get/upsert record, set/clear
      sandbox_id.
- [ ] `api/oss/src/apis/fastapi/session_states/router.py` — top-level resource (NOT nested):
      `GET /sessions/states/{session_id}`, `PUT /sessions/states/{session_id}`,
      `PUT /sessions/states/{session_id}/sandbox-id`.
- [ ] Validate `session_id` shape (SEC-8); `@intercept_exceptions()`.
- [ ] Mount in `api/entrypoints/routers.py`.

## 3. Runner persist driver (port + clean from PoC `session-persist.js`)

- [ ] `makePersist()` adapter over the API: `getSession` → `/state`, `updateSession` →
      `/state`, `listEvents` → `/record` (records worktree), `insertEvent` no-op.
- [ ] Wire into `services/agent` `sandbox_agent` engine so `resumeOrCreateSession` resumes
      instead of cold-creating.
- [ ] Resume path: reconnect `sandbox_id` if alive; recreate + remount (mounts worktree) if
      gone; persist new `sandbox_id`.

## 5. Tests

- [ ] Unit: persist driver maps endpoints correctly; `insertEvent` is a no-op.
- [ ] Integration: `session_states` DAO upsert/read against Postgres.
- [ ] Acceptance: turn 1 creates record → turn 2 resumes (harness has prior context) →
      kill sandbox → turn 3 recreates + resumes from durable cwd + record. Both editions.

## Cross-worktree dependencies

- **records**: `listEvents` reads `/records` filtered by `session_id`. Keep that shape.
- **mounts**: resume-after-kill relies on the durable cwd remount.
- **runner-scalability**: liveness/affinity ownership; the "one runner per session" invariant
  that keeps `record` upserts uncontended.

## Out of scope

- Run coordination (steer/cancel/attach/detach), session→runner affinity, concurrency caps —
  all runner-scalability.
- The record table itself — records worktree.
