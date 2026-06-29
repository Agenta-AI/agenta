# POC — show sessions in web — tasks

Ordered Phase-1 (backend) checklist, then Phase-2 (web) scope. Each Phase-1 group is a
self-contained edit that keeps the tree green (ruff + the streams unit/contract tests).

## Phase 1 — backend

### 1. Redis contract: the `running` lock

- [ ] `contract.py`: add `running_key(session_id)` → `running:session:<id>`; add
      `RUNNING_TTL_SECONDS` (= `ALIVE_TTL_SECONDS`).
- [ ] `locks.py`: `acquire_running` / `refresh_running` / `release_running` (mirror the
      alive helpers); `force_clear_running` for cancel/steer/kill.
- [ ] `get_session_liveness` → return `{alive, running, attached}` (drop the derived
      `reattachable`; it is client-side now).
- [ ] Golden fixture `redis_contract.json`: add `running` ttl + `running_example` key.
- [ ] Python contract test `test_redis_contract.py`: assert the new key + ttl.
- [ ] TS contract test `session-redis-contract.test.ts` + `sessions/contract.ts`: mirror the
      `running` key + ttl so the cross-language fixture stays green.

### 2. Row shape — `flags` nest, drop `sandbox_live`/`last_seen_at`

- [ ] `dbes.py`: drop `attached`, `sandbox_live`, `last_seen_at` columns + their index; add
      `flags` JSONB (default `{}`). Keep the `session_id` unique + project-scoped pk.
- [ ] `dtos.py`: `SessionStream` carries `flags: SessionStreamFlags{is_alive,is_running,
      is_attached}` + `turn_id`; drop `attached`/`sandbox_live`/`last_seen_at`. Update
      `SessionStreamCreate`/`SessionStreamEdit`/`SessionStreamQuery` to the flags shape.
- [ ] `mappings.py`: map `flags` JSONB ↔ DTO; drop the removed columns.
- [ ] `dao.py`: `query` filters on `flags` (e.g. `is_alive`); `count_active` keys off
      `status.code == running` (unchanged) or `flags.is_running`; drop `last_seen_at` writes.
- [ ] Alembic migration: drop the three columns + stale index, add `flags` JSONB.

### 3. Service — command shape + run→turn + nest mirror

- [ ] Rename `invoke` → `command` (method) returning a `SessionStreamCommand`/`CommandMode`
      result; `_start_run` → `_start_turn`; `run_id` → `turn_id`.
- [ ] `_start_turn`: acquire alive, **acquire running**, mirror `flags.is_alive=is_running=
      true` + `status=running` to the row.
- [ ] cancel/steer: clear `running` (+ `flags.is_running=false`), keep alive as appropriate.
- [ ] `detach`: user path (release attached + `flags.is_attached=false`).
- [ ] `kill`: collapse the nest (clear alive+running+attached, `status=ended`,
      `flags.*=false`) + call the runner `/kill` (idempotent); soft-delete the row.
- [ ] `get_liveness` / new `fetch` read: reconcile Redis bools + row → primitive flags.
- [x] `SessionRunInUse` → `SessionTurnInUse` (types.py + router catch).
- [x] **`run_id` → `turn_id` everywhere**: interactions (DTO/DBE/dao/mappings + migration
      `oss000000009`), lock helpers (`acquire/refresh/release_alive`), and the wire
      (`runId`→`turnId`: protocol.ts + wire.py + wire_models.py + both golden contract tests).
- [x] **`replica_id` distinct from `turn_id`** (multi-container today): runner mints a stable
      `REPLICA_ID` per process; heartbeat carries both `replica_id` (affinity) and `turn_id`
      (alive/running ownership); service `refresh_alive`+`refresh_running` on the turn id.

### 4. Router + models — unified surface, verb-first ids

- [ ] `models.py`: `SessionStreamCommandRequest/ResponseModel`, `SessionStreamReadModel`
      (flags + turn_id), drop the `sandbox_live`/`reattachable` fields.
- [ ] `router.py`: GET `fetch_session_stream`, POST `set_session_stream`, DELETE
      `delete_session_stream` on `/sessions/streams` (`?session_id=`); POST
      `query_session_streams`; POST `detach_session_stream` (user, RUN_SESSIONS); admin
      `heartbeat_session_stream`. Drop the old `liveness` GET (folded into `fetch`).
- [ ] entrypoint `routers.py`: register any new route prefixes (the DELETE/GET share the
      streams router; confirm the unified path mounts without a prefix as today).

### 5. Runner — `/stream` + `/kill`

- [ ] `server.ts`: route `POST /stream` (rename of `/run`; keep `/run` as a thin alias for
      one release per the migration rule, `include_in_schema=False` analogue = a comment).
- [ ] `server.ts`: new `POST /kill` — idempotent sandbox teardown for a session; returns
      `{ok:true}` even if nothing was live.
- [ ] `alive.ts`: heartbeat carries the nest intent (running) rather than `sandbox_live`;
      align the body with the new heartbeat model.

### 6. Format + tests

- [ ] `ruff format` then `ruff check --fix` in `api/`.
- [ ] `cd api && py-run-tests` — streams unit + `test_redis_contract` green.
- [ ] `cd services/agent && pnpm test && pnpm run typecheck` — TS contract + server seams green.

## Phase 2 — web demonstrator (scope; built after Phase 1 lands)

- [ ] Session icon in the playground header → opens the inspector drawer.
- [ ] One tab per element: mounts / transcripts / states / streams / interactions, each on its
      productized endpoint.
- [ ] Streams tab: alive/running/attached badges (from `fetch_session_stream`), attach /
      detach / kill controls, interactions respond.
- [ ] Send/steer/cancel stay the playground chat's job — the drawer does not add a send path.
- [ ] Fern client regen for the renamed operation ids (`fetch/set/delete/query/detach/
      heartbeat_session_stream`).
