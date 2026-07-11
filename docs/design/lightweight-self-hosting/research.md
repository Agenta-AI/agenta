# Lightweight self-hosting: research and ROI-ranked plan

Status: research only. No code or compose changed. Date: 2026-06-26.

## Goal

The OSS self-host compose runs many containers and is heavy on CPU and RAM. We want a
simple compose with few parameters that a small server, a laptop, or possibly Windows or
Cloud Run can run. This doc inventories the current stack, finds what drives the weight,
and ranks the simplifications by return on investment. It also gives a blunt verdict on the
SQLite idea and on Windows and Cloud Run.

## TL;DR

- The default OSS self-host (`run.sh --oss --gh`) starts **17 containers** (16 long-running
  plus the one-shot `alembic` migration). Counting the two optional services that exist but
  are off by default (`nginx`, `otel-collector`) gets you to the CEO's "~20".
- The container count is dominated by **5 separate worker containers plus a cron container**,
  all running the heavy Python API image, plus **two Redis containers** and a **SuperTokens
  auth service with its own database**.
- The cheapest, highest-value win is **collapsing the 5 workers + cron into one container**
  and **collapsing the two Redis instances into one**. The config already supports a single
  Redis. With these plus `--workers 1` on api/services, the default drops from 16 long-running
  containers to **10 while keeping Composio and the agent sidecar on** (the CEO's preference,
  section 3a), or to **8** if Composio and the sidecar are also turned off. No code rewrite in
  either case.
- **SQLite to replace Postgres: not worth it.** The app DB needs ~50 files rewritten and the
  tracing DB would lose JSONB/GIN/full-text indexing and hit SQLite's single-writer lock
  under the multi-worker span ingestion. Even at low volume the tracing store should stay on
  Postgres.
- **Windows: works** via Docker Desktop with the WSL2 backend; the only friction is the bash
  `run.sh` wrapper. **Cloud Run: feasible only as a different topology** (api + web as
  separate services, external managed Postgres + Redis, workers reworked); it is not a
  drop-in and not the natural target for a "single small box" lite mode.

---

## 1. Current OSS self-host inventory

Source: `hosting/docker-compose/oss/docker-compose.gh.yml` (the production self-host file).
`docker-compose.dev.yml` defines the same 17 services. `run.sh` enables three profiles by
default: `with-web`, `with-traefik`, `with-tunnel`. `nginx` (alternative proxy) and
`otel-collector` (separate `docker-compose.otel.yml`) are not started by default.

Important: the many containers reuse only **three images**. `api`, the 5 workers, `cron`,
and `alembic` all run the single `agenta-api` image. `services` runs `agenta-services`.
`web` runs `agenta-web`. `sandbox-agent` runs `agenta-agent-runner`. So disk cost is modest;
the cost is **RAM and CPU from many live processes**, not many distinct images.

| # | Service | Image | What it is | Essential? | Rough footprint |
|---|---------|-------|------------|-----------|-----------------|
| 1 | `web` | agenta-web (Node) | Next.js frontend server | Yes | ~150-300 MB |
| 2 | `api` | agenta-api (Python) | FastAPI app, gunicorn 2 uvicorn workers | Yes | ~300-500 MB |
| 3 | `worker-evaluations` | agenta-api | taskiq Redis worker: evaluation jobs | Only if running evals | ~200-300 MB |
| 4 | `worker-tracing` | agenta-api | Redis Streams consumer: span ingestion | Only if using tracing | ~200-300 MB |
| 5 | `worker-webhooks` | agenta-api | taskiq Redis worker: webhooks | Optional | ~200-300 MB |
| 6 | `worker-triggers` | agenta-api | taskiq Redis worker: triggers | Optional | ~200-300 MB |
| 7 | `worker-events` | agenta-api | taskiq Redis worker: events | Optional | ~200-300 MB |
| 8 | `cron` | agenta-api | supercronic running queries + triggers crontab | Optional | ~30-60 MB |
| 9 | `alembic` | agenta-api | one-shot DB migration runner, then exits | Yes (startup) | transient |
| 10 | `services` | agenta-services (Python) | LLM workflow/evaluator service (completion, chat, custom-code evals) | Yes (playground/evals) | ~300-500 MB |
| 11 | `sandbox-agent` | agenta-agent-runner (Node) | Agent runner sidecar (new agent feature) | No (new, optional) | ~100-200 MB |
| 12 | `postgres` | postgres:17 | Single Postgres holding 3 DBs: core, tracing, supertokens | Yes | ~150 MB idle, grows |
| 13 | `redis-volatile` | redis:8 | Cache (no persistence, LRU, maxmemory 512mb) | Yes | ~15 MB idle, up to 512 MB |
| 14 | `redis-durable` | redis:8 | Queue/broker: taskiq streams + tracing stream (AOF) | Yes | ~15 MB idle, up to 512 MB |
| 15 | `traefik` | traefik:2 | Reverse proxy routing `/`, `/api`, `/services` | Yes (one proxy) | ~50 MB |
| 16 | `supertokens` | supertokens-postgresql:11 (JVM) | Auth service, uses its own `agenta_oss_supertokens` DB | Yes (auth) | ~250-450 MB |
| 17 | `composio` | python:3.13-slim | Outbound relay for inbound Composio trigger events; `pip install`s at runtime (see section 2a) | No (off-able) | ~100-120 MB + install |
| - | `nginx` | nginx:1 | Alternative proxy to traefik (profile `with-nginx`) | No (alt) | not started |
| - | `otel-collector` | otel-collector-contrib | OTLP receiver, separate compose file | No | not started |

Default running set with `run.sh --oss --gh`: services 1-17 minus `nginx` and
`otel-collector` = **16 long-running + 1 one-shot (`alembic`)**.

### Storage and networking notes

- One Postgres instance already serves all three logical databases (`agenta_oss_core`,
  `agenta_oss_tracing`, `agenta_oss_supertokens`) via `init-db-oss.sql`. There is no second
  database server. There is **no ClickHouse** anywhere; tracing is stored in Postgres.
- Persistent volumes: `postgres-data`, `redis-volatile-data`, `redis-durable-data`.
- Dead config to clean up: `.env.oss.gh` still defines `RABBITMQ_DEFAULT_USER/PASS` and
  `CELERY_BROKER_URL=amqp://...`. There is no RabbitMQ container and no Celery in the stack.
  The real broker is **Redis** (taskiq `RedisStreamBroker` for the 4 task workers, Redis
  Streams for tracing). These vars are leftovers.

---

## 2. What drives the container count and weight

1. **Five worker containers + cron (6 containers).** This is the single biggest contributor
   to the count and a large share of RAM. Each loads the full `agenta-api` image (which
   keeps `litellm` + `tokenizers` + `tiktoken` + `huggingface_hub` per the Dockerfile), so
   each worker is a heavy Python process. All four task workers use the **same broker
   technology** (taskiq over Redis); `worker-tracing` is a custom asyncio Redis Streams loop.
   Nothing forces them into separate containers.

2. **Two Redis containers.** `redis-volatile` (cache) and `redis-durable` (queue) differ only
   in persistence and eviction policy. The env layer already supports a single Redis:
   `REDIS_URI_VOLATILE or REDIS_URI` and `REDIS_URI_DURABLE or REDIS_URI` both fall back to
   one `REDIS_URI`. So one Redis can serve both roles with no code change.

3. **SuperTokens + its database.** A JVM auth service (~250-450 MB) plus a dedicated logical
   DB. Auth is wired deeply (auth router, middleware, account service, supertokens
   config/overrides), so this is not a flip-a-flag removal. Dropping it needs a real
   single-user / no-auth mode.

4. **gunicorn worker multiplicity.** `api` and `services` each run `--workers 2`. On a small
   box that is 4 Python web workers before counting the 5 background workers. Dropping to
   `--workers 1` each halves their RAM.

5. **Optional extras on by default.** `composio` tunnel (`with-tunnel` defaults on in
   `run.sh`, and it `pip install`s at container start — note: `run.sh` now only activates
   the `with-tunnel` profile when `COMPOSIO_API_KEY` is set, so it no longer crash-loops for
   keyless users) and `sandbox-agent` (the new agent feature, and `services` hard-depends on
   it via `depends_on: sandbox-agent`). Both are non-core for most users.

6. **Proxy.** `traefik` is light, but on a single-container target it is unnecessary.

### 2a. What the `composio` container actually is

It is **not** an ngrok/cloudflared HTTP tunnel and **not** an OAuth callback relay. It runs
`api/entrypoints/dispatcher_composio.py` (the compose service is `composio`; the code calls
it the `triggers-bridge`, the `stripe listen` equivalent). The docstring states it is
**dev-only**.

How it works (from the source):

- It opens an **outbound WebSocket** to Composio's cloud (`composio.triggers.subscribe()`),
  receives Composio trigger events, signs each with the webhook HMAC secret, and **POSTs them
  to the local API** at `http://api:8000/triggers/composio/events/` (route confirmed at
  `api/oss/src/apis/fastapi/triggers/router.py:119`).
- It exists because Composio has no CLI tunnel and a box behind NAT cannot receive Composio's
  inbound webhooks directly. The outbound WebSocket sidesteps that: the bridge dials out, so
  no public ingress is required.
- It **requires `COMPOSIO_API_KEY`**. Historically, without it the script called
  `sys.exit(...)` immediately and — combined with `restart: always` — the container
  **crash-looped, re-running its runtime `pip install composio httpx` on every restart**.
  This is now fixed: `run.sh` only activates the `with-tunnel` profile when `COMPOSIO_API_KEY`
  is set (and the script idles instead of exiting if it somehow starts keyless), so for the
  large majority of self-hosters who have not set up Composio this container simply does not
  start.

What breaks if it is absent:

- Only **inbound Composio trigger events** stop arriving (event-driven flows like "when a new
  GitHub issue is created, run X"). Using Composio **tools/actions** from agents is unaffected
  — those are outbound calls the api/services make to Composio directly and do not go through
  this bridge.
- If the self-host box has a public ingress URL, you do not need the bridge at all: point
  Composio's webhook at the public `/triggers/composio/events/` endpoint and run
  `run.sh --no-tunnel`.

Bottom line for a small self-hoster: the bridge is **not needed for normal use**, not needed
for Composio tool execution, and only matters if they (a) use Composio triggers and (b) are
behind NAT with no public URL. This is now the implemented behaviour: the service stays
defined but `run.sh` only starts it when `COMPOSIO_API_KEY` is set, so keyless users no longer
get a crash-looping, pip-installing container.

---

## 3. ROI-ranked simplifications

Effort: S (config/compose only), M (some code or new image), L (significant feature work).

| Item | What it saves | Effort | Risk |
|------|---------------|--------|------|
| **Collapse 5 workers + cron into 1 container** (supervisor process, or one taskiq worker subscribed to all queues + the tracing loop + supercronic) | 5 containers; removes per-container memory floor; fewer restarts to manage | S-M | Low-Med. One container = no per-worker isolation; if it dies all background work stops. Acceptable for lite/low volume. Merging the 4 taskiq workers into one process is M; a supervisord-launches-all is S. |
| **One Redis instead of two** (single `REDIS_URI`, AOF on, `noeviction`) | 1 container; up to 512 MB reserved | S | Low. Lose the cache/queue eviction split; fine at low volume. Use one instance with two logical DBs, or just db 0. |
| **Default `composio` tunnel OFF for lite** (already profile-gated; flip the run.sh/lite default) | 1 container + a runtime `pip install` | S | None. Only needed for Composio trigger ingestion. |
| **Default `sandbox-agent` OFF for lite + drop `services -> sandbox-agent` hard depends_on** (make it conditional; `AGENTA_AGENT_RUNNER_URL` is already optional in `services/oss/src/agent/config.py`) | 1 container | S | Low. Agent feature unavailable in lite; that is the intended tradeoff. Need to confirm `services` starts cleanly with the runner unset. |
| **`api` and `services` to `--workers 1` in lite** | ~half the RAM of the two web tiers | S | Low. Lower concurrency ceiling; fine for single-user. |
| **A dedicated "lite" compose file** with a tiny env (DB password, secret keys, web URL) and the above defaults baked in | The "few parameters" goal; one command | S | Low. Maintenance: another compose file to keep in sync. |
| **Single all-in-one image** (web + api + one worker under supervisord) for single-container / Cloud Run | Collapses to 1 app container (+ external or sidecar DB) | M-L | Med. Mixing Node + Python runtimes and a process supervisor; harder to debug; loses Compose's restart semantics. |
| **Inline tracing ingestion** (write spans in the request path at low volume, skip the Redis stream + `worker-tracing`) | Removes the tracing worker and a reason for durable Redis | M | Med. Couples trace-write latency to the request; only acceptable at low volume; needs a code path + a flag. |
| **No-auth / single-user mode** (drop SuperTokens + its DB) | 1 heavy JVM container + a logical DB | L | High. Auth is deeply wired; needs a real local-auth/bypass implementation and careful security review. Biggest single RAM win after the workers, but the most work. |
| **Keep Composio tunnel + agent sidecar ON** (the CEO's preference: apply every other cheap win but keep these two) | Still 16 -> 10 containers and ~3.4 GB -> ~2.2-2.8 GB; you forgo only the 2 containers / ~270 MB that turning them off would also save (section 3a) | S | Low. Caveat: `composio` crash-loops without `COMPOSIO_API_KEY` (section 2a); prefer gating its start on that key. `sandbox-agent` stays a hard dep of `services` (status quo). |
| **SQLite instead of Postgres** | The DB server container | L (and risky) | Very High. See section 4. Not recommended. |

### 3a. Two cheap-wins bundles (no code rewrite): keep-both vs drop-both

Both bundles apply the same independent wins — collapse the 5 workers + cron into one
container, one Redis instead of two, and `--workers 1` on `api` and `services`. They differ
only on whether `composio` and `sandbox-agent` stay on. SuperTokens stays in both (dropping it
is the Phase 3 no-auth feature, not a cheap win).

**Keep-both (CEO's preference): 10 long-running containers.**
`postgres`, `redis`, `api`, `web`, `services`, `worker` (consolidated), `traefik`,
`supertokens`, `sandbox-agent`, `composio`.

**Drop-both (even lighter): 8 long-running containers.**
The same list minus `sandbox-agent` and `composio`.

**Baseline today: 16 long-running containers** (+ the one-shot `alembic`).

#### RAM estimates

No `mem_reservation` / `mem_limit` / `deploy.resources` are set anywhere in the compose, so
every figure below is a **typical idle-to-light-load RSS estimate, not a reserved value and
not a hard limit**. The only memory cap in the stack is Redis `--maxmemory 512mb`, which
bounds each Redis *dataset* (a ceiling under load), not its idle RSS (~20-30 MB). Under real
traffic the Python web/worker processes grow well above these idle numbers.

A second variable matters: "collapse the workers into one container" can mean two things.
- **Pure compose (supervisord runs the 5 existing entrypoints unchanged):** container count
  drops 6 -> 1 but the **5 Python processes remain**, so the consolidated worker is still
  ~1.0-1.2 GB. This is the strictly-no-code path.
- **Light code (merge the 4 taskiq workers into one taskiq process; tracing loop + supercronic
  stay separate):** the consolidated worker drops to ~2 Python processes, ~450-550 MB. This is
  where the real RAM win is.

Keep-both, per-container typical RSS:

| Container | Typical idle/light RSS |
|-----------|------------------------|
| `postgres` | ~150 MB |
| `redis` (single) | ~25 MB (dataset ceiling 512 MB) |
| `api` (`--workers 1`) | ~350 MB |
| `web` (Next.js node) | ~200 MB |
| `services` (`--workers 1`) | ~320 MB |
| `worker` (consolidated) | ~1.1 GB (supervisord/no-rewrite) or ~500 MB (taskiq merge) |
| `traefik` | ~50 MB |
| `supertokens` (JVM) | ~350 MB |
| `sandbox-agent` (node, Pi baked) | ~150 MB |
| `composio` | ~120 MB |
| **Total** | **~2.8 GB (no-rewrite)** / **~2.2 GB (taskiq merge)** |

Comparison (typical idle/light load):

| Variant | Containers | RAM (no-rewrite worker) | RAM (taskiq-merge worker) |
|---------|-----------|-------------------------|---------------------------|
| Baseline today | 16 | ~3.4 GB (api/services at `--workers 2`) | n/a |
| Keep-both lite | 10 | ~2.8 GB | ~2.2 GB |
| Drop-both lite | 8 | ~2.55 GB | ~2.0 GB |

So keeping Composio + the sidecar costs only **2 containers and ~270 MB** versus dropping
them. The large savings (workers consolidation, single Redis, `--workers 1`) are independent
of that choice, so keep-both is a sound default; it still nearly halves the container count and
takes ~3.4 GB down to ~2.2-2.8 GB.

#### Caveat on keeping `sandbox-agent` on by default

- It is **one container, not a chain.** The published `agenta-agent-runner` image is the
  production Node runner with **Pi baked in** (`@earendil-works/pi-coding-agent`, MIT; see
  `services/agent/docker/Dockerfile.sidecar`). The default `SANDBOX_AGENT_PROVIDER=local`
  runs the agent in-sidecar, so it adds **no** extra containers. The Daytona path is a
  **remote cloud** option (`SANDBOX_AGENT_PROVIDER=daytona`) and adds no local containers.
- **Claude Code is not baked** into the redistributed image (Anthropic proprietary); it is
  installed from Anthropic at runtime only on first `claude` use. So the cost of keeping the
  sidecar on is a **heavier image on disk** (Node + Pi + git + python3) and ~100-200 MB idle
  RAM, not extra containers.
- It is **already a hard dependency** of `services` (`depends_on: sandbox-agent:
  service_healthy`), so keeping it on is the current behavior; only the drop-both variant needs
  to remove that edge.

---

## 4. SQLite feasibility (the CEO called this out)

**Verdict: not worth it. Keep Postgres.** The app DB would need roughly 50 files rewritten,
and tracing on SQLite is the worse half of the problem even at low volume.

Evidence (all under `api/oss/src/dbs/postgres/` unless noted):

- **JSONB everywhere (~31 columns).** Shared mixins (`shared/dbas.py`: flags, tags, status,
  data, meta), tracing (`tracing/dbas.py`: attributes, references, links, hashes, events),
  evaluations, webhooks. SQLite has no JSONB. Loses indexing, operators (`@>`, `->`, `->>`),
  and compression.
- **Native UUID columns (~42, `UUID(as_uuid=True)`)** across every `dbas.py`. SQLite has no
  UUID type; asyncpg UUID handling (`core/events/streaming.py` uses `AsyncpgUUID`) breaks.
- **Native enums (`secretkind_enum`, `folder_kind_enum`, `app_type_enum`, plus span
  `TraceType/SpanType/SpanKind/StatusCode`).** Migrations use `CREATE TYPE` and
  `ALTER TYPE ... ADD VALUE` (e.g. `f0a1b2c3d4e5_add_webhooks.py`,
  `863f8ebc200f_extend_app_type_again.py`). SQLite has no enum type and cannot run these.
- **Postgres `ltree` extension** for the folder hierarchy
  (`7a3d1c4f5b6a_add_folders_table_and_app_folder_id.py`: `CREATE EXTENSION ltree`, plus
  `nlevel()`, `subpath()`, `<@` operators in `folders/dao.py`). No SQLite equivalent.
- **`INSERT ... ON CONFLICT DO UPDATE` upserts** via
  `sqlalchemy.dialects.postgresql.insert` in tracing, events, triggers, evaluations,
  webhooks DAOs. SQLite upsert semantics differ.
- **GIN indexes on JSONB + full-text search** in tracing (`tracing/dbes.py`:
  `postgresql_using="gin"` with `jsonb_path_ops`, and `to_tsvector('simple', ...)` indexes).
  These are how span attributes/events are queried efficiently. SQLite has neither (FTS5 is
  a different, separate mechanism).
- **Engine is hardcoded to `postgresql+asyncpg`** (`utils/env.py` defaults, `shared/engine.py`
  `create_async_engine`), and error handling imports asyncpg-specific exception classes
  (`shared/exceptions.py`). There is no dialect abstraction.
- **~89 Alembic migration files** (80 core, 9 tracing), ~25 with raw `op.execute(...)`
  containing Postgres-only SQL (`jsonb_set`, `to_jsonb`, `::jsonb`/`::boolean` casts, enum
  ops). These would need a parallel SQLite migration history or batch-mode rewrites.

**Tracing on SQLite specifically (the CEO's worry):** confirmed a hard no even at low volume.
Span ingestion is multi-writer (the `worker-tracing` consumer batches and upserts spans;
`api`/`services` also touch the DB), and SQLite has a single global writer lock. The tracing
schema leans on JSONB columns with GIN and full-text indexes that SQLite cannot replicate, so
queries would fall back to scans. The combination of write-lock contention plus loss of JSONB
indexing makes SQLite tracing slow and fragile rather than just smaller.

If a truly DB-less footprint is ever needed, a better path than SQLite is **embedding
Postgres in one container alongside the app** (still Postgres, just co-located), or shipping a
"bring your own managed Postgres" lite image. Both keep the existing DAO/migration code.

---

## 5. Windows and Cloud Run

### Windows (Docker Desktop)

**Verdict: works, with minor friction.** No hard blocker in the compose.

- All containers are Linux images; Docker Desktop on Windows runs them under the WSL2 backend
  (which Docker Desktop requires anyway).
- Bind mounts used are single files (`init-db-oss.sql`, `nginx.conf`, otel config) and
  Docker Desktop translates these fine.
- `traefik` mounts `/var/run/docker.sock`; the Docker provider works on Docker Desktop for
  Windows. `extra_hosts: host.docker.internal:host-gateway` is supported on Docker Desktop.
- Container entrypoints use `sh -c ...` and a bash healthcheck (`supertokens` uses
  `/dev/tcp`), but those run **inside Linux containers**, so they are unaffected by the host
  OS.
- The real friction is `run.sh` (bash). Windows users either use WSL2 or run plain
  `docker compose -f ... --profile ... up -d`. Document the plain-compose invocation for
  Windows. The heavier concern is resources: a laptop wants the lite profile, not the full
  16-container stack.

### Cloud Run

**Verdict: feasible only as a different topology, not a drop-in; not the natural lite target.**

- Cloud Run runs containers per service, is stateless with no persistent volumes, scales to
  zero, and throttles CPU outside request handling. It expects external managed backends.
- Stateful deps must move out: Postgres -> Cloud SQL, Redis -> Memorystore, SuperTokens ->
  self-hosted elsewhere or replaced by no-auth mode. That is the opposite of the "everything
  on one small box" lite story, so an all-in-one-with-embedded-Postgres image does **not**
  fit Cloud Run (no durable disk).
- Background workers (the 4 taskiq + tracing loop) need always-on CPU; on Cloud Run that
  means `min-instances=1` with CPU always allocated, or moving them to Cloud Run Jobs. `cron`
  -> Cloud Scheduler. This is real rework.
- `traefik` is unnecessary; Cloud Run provides ingress and TLS.
- Realistic Cloud Run shape: deploy `web` and `api` as two Cloud Run services pointed at
  external Cloud SQL + Memorystore, with a separate always-on `worker` service. The
  synchronous app (prompt management, playground via `services`) can work; the async/tracing
  pipeline needs the rework above. Users who reach for Cloud Run already have managed
  Postgres, so the value of the lite single-box work mostly does not transfer here. Treat
  Cloud Run as a separate, later effort.

---

## 6. Recommended phased plan

**Phase 1 - Cheap wins, no code rewrite (ship first).** A `docker-compose.lite.yml` (or a
`--lite` flag in `run.sh`) with a small env (DB password, `AGENTA_AUTH_KEY`,
`AGENTA_CRYPT_KEY`, web URL) that:
- runs **one consolidated worker container** (supervisord launching the 4 taskiq workers +
  the tracing loop + supercronic), or a single taskiq worker across all queues;
- runs **one Redis** via a single `REDIS_URI` (AOF on, `noeviction`);
- sets `api` and `services` to `--workers 1`.

Two variants of the result (section 3a has the full numbers):
- **Keep-both (recommended default):** keep `composio` and `sandbox-agent` on -> **10
  long-running containers**, ~2.2-2.8 GB typical. Down from 16 / ~3.4 GB. Nothing is given up.
  Prefer gating `composio` start on `COMPOSIO_API_KEY` so it does not crash-loop when unset.
- **Drop-both (even lighter):** also default `composio` OFF and `sandbox-agent` OFF (and drop
  the `services -> sandbox-agent` hard dependency) -> **8 long-running containers**, ~2.0-2.55
  GB. Gives up the agent feature and Composio triggers; prompts, playground, evals, and
  tracing still work.

**Phase 2 - Medium.** Optional inline tracing ingestion behind a flag (drops the tracing
worker and a reason for durable Redis at very low volume), and a proper single-container
all-in-one image (web + api + worker under supervisord) for the laptop/Cloud-Run-style
single-process deploy with external or sidecar Postgres.

**Phase 3 - Larger features.** A single-user / no-auth mode to drop SuperTokens + its DB
(biggest remaining RAM win after the workers, but needs a security-reviewed local-auth
implementation). A documented Cloud Run topology (external Cloud SQL + Memorystore + workers
as a Job or always-on service).

**Do not do:** the SQLite adapter. The effort is large, the tracing store regresses badly
even at low volume, and it would split every future DB change across two dialects. Keep
Postgres; if a smaller footprint than "separate DB container" is ever required, co-locate
Postgres in the app container rather than swapping engines.
