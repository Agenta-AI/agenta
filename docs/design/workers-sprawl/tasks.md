# Workers Sprawl — codebase slice: tasks

Ordered checklist. See `specs.md` for the why/constraints. All paths repo-relative.

## Package 0 — cheap fixes, no consolidation dependency

- [x] **0a. Tracing producer pipeline.** `api/oss/src/core/tracing/streaming.py`,
  `publish_spans`: replaced the per-span `await redis.xadd(...)` loop with a single
  `async with redis.pipeline(transaction=False) as pipe:` that queues one `pipe.xadd(...)`
  per span (`name="streams:spans"` — renamed from `streams:tracing` as part of this work,
  same `fields={"data": ...}`, same `maxlen`/`approximate`), then one `await
  pipe.execute()`. Same return value (count of spans published). `publish_event`/
  `publish_record` untouched — they take single items by signature; batching them needs
  caller-side buffering, out of scope (audit explicitly defers this).
  - `.tick()` call added at the same touch point (Package 1c).

- [x] **0b. Dev watchmedo orphan-reap leak.** Applied to the 2 new services
  (`worker-streams`/`worker-queues`) in both
  `hosting/docker-compose/ee/docker-compose.dev.yml` and
  `hosting/docker-compose/oss/docker-compose.dev.yml`:
  - `init: true` (matches how `cron` already has it).
  - `--signal SIGTERM --kill-after 5` on the `watchmedo auto-restart` invocation. Both
    flags ARE supported by the pinned `watchdog==3.0.0` (verified via `watchmedo
    auto-restart --help`): `--signal` picks the stop signal sent to the child (default is
    SIGINT — switching to SIGTERM matches how compose stops containers), `--kill-after N`
    hard-kills the child if it hasn't exited N seconds after the signal.
  - `init: true` (PID-1 reaper) is still needed regardless, since `--kill-after` only
    guarantees watchmedo's *direct child* dies — it does not by itself reap
    already-orphaned grandchildren from a `run_worker`/`ProcessManager` fork tree
    (evaluations/webhooks/triggers/interactions); `init: true` is what reaps those.
  - The 7 old per-loop services these flags originally targeted are now deleted (Package
    2 follow-up), so this hardening lives only on the 2 merged services.

## Package 1 — codebase (`api/`)

- [x] **1a. Extract `StreamConsumer` base.** New file
  `api/oss/src/tasks/asyncio/shared/consumer.py` (+ `__init__.py` — no existing
  `shared/` dir under `tasks/asyncio` before this). Move in:
  `__init__` (with the shared constants `max_batch_size=50`, `max_block_ms=5000`,
  `max_delay_ms=250`, `max_batch_mb=50`, `consumer_name = f"worker-{os.getpid()}"`),
  `create_consumer_group`, `read_batch`, `ack_and_delete`, `run`. `process_batch` stays
  abstract (`NotImplementedError`) — each subclass's deserialize/group/meter/write/
  post-hook logic is the delta.
  - Update `api/oss/src/tasks/asyncio/tracing/worker.py`: `TracingWorker(StreamConsumer)`,
    keep only `process_batch` (org→(project,user) grouping, `Counter.TRACES_INGESTED`,
    root-span delta, `service.ingest(...)` per project/user).
  - Update `api/oss/src/tasks/asyncio/sessions/records_worker.py`:
    `RecordsWorker(StreamConsumer)`, keep only `process_batch` (project grouping,
    `Counter.RECORDS_INGESTED`, per-event `service.append(...)`).
  - Update `api/oss/src/tasks/asyncio/events/worker.py`: `EventsWorker(StreamConsumer)`,
    keep `process_batch` (project grouping, EE-gated `if is_ee(): service.ingest(...)`,
    `Counter.EVENTS_INGESTED`) AND override `run()` to add the webhook-dispatch stage
    (skip-ack-on-dispatch-failure) around the base's batch-processing — this is the one
    subclass whose `run()` genuinely differs (post-hook that can skip ack), so it
    overrides `run()` rather than forcing a `post_hook` template method that only one
    of three subclasses uses.
  - Preserve every asymmetry listed in specs.md. Preserve log message prefixes
    (`[INGEST]`, `[EVENTS]`, `[RECORDS]`) exactly as before per subclass.
  - Verify: consumer group names, stream names, constructor signatures (kwargs used by
    the 7 existing entrypoints) all unchanged.

- [x] **1b. Env vars.** `api/oss/src/utils/env.py`: add `AGENTA_WORKER_STREAMS` and
  `AGENTA_WORKER_QUEUES` (comma-list parsing, matching the existing `_load_json_env_list`-
  adjacent style but plain CSV, not JSON) to the relevant config section (new
  `WorkersConfig` or alongside `AgentaConfig`), consumed via `env.workers.streams` /
  `env.workers.queues` (or equivalent attribute path) — never `os.getenv` in feature code.

- [x] **1b. `api/entrypoints/worker_streams.py`** (new). Reads the selector, builds the
  DAOs/services/`StreamConsumer` subclasses for the selected loops (subset of
  `{records, events, tracing}`, empty ⇒ all three), calls `create_consumer_group()` on
  each, then `asyncio.gather(*[c.run() for c in consumers])`. Mirrors the
  `warn_deprecated_env_vars`/`validate_required_env_vars`/`is_ee()` boilerplate from the
  7 existing entrypoints. Events' webhook-dispatcher wiring (broker + `WebhooksWorker` +
  `WebhooksDispatcher`) is only constructed when `events` is selected, matching today's
  `worker_events.py`.

- [x] **1b. `api/entrypoints/worker_queues.py`** (new). Reads the selector (subset of
  `{webhooks, triggers, interactions, evaluations}`, empty ⇒ all four). For each selected
  queue: build its existing broker (unchanged `queue_name`/`consumer_group_name`/
  `maxlen`/`approximate`, including `evaluations`'s `_NoRedeliveryRedisStreamBroker`) and
  register its existing worker class (`WebhooksWorker`/`TriggersWorker`/
  `InteractionsWorker`/`EvaluationsWorker`), reusing their `_register_tasks()` as-is.
  Bypass `run_worker(WorkerArgs)` (confirmed process-forking + own-event-loop, not
  co-hostable — see specs.md spike writeup): construct a
  `taskiq.receiver.Receiver(broker, executor, max_async_tasks=...)` per broker (same
  `max_async_tasks` as today: 50 for webhooks/triggers/interactions, 10 for evaluations)
  and `asyncio.gather(*[receiver.listen(shutdown_event) for receiver in receivers])`
  against one shared `asyncio.Event`, with SIGINT/SIGTERM installed once in this
  entrypoint (not delegated to `run_worker`). Evaluations' worker-heartbeat
  (`run_worker_heartbeat`, `TaskiqEvents.WORKER_STARTUP`/`WORKER_SHUTDOWN` hooks) is
  preserved via the same `broker.on_event(...)` decorators — those fire regardless of
  whether `Receiver.listen` is driven by `run_worker` or directly, since they're
  broker-level hooks, not `run_worker`-level.
  - Outcome: implemented for all four queues, not a partial/TODO — see specs.md for why
    the `Receiver.listen` bypass makes this tractable.
  - Evaluations wiring is shared via `api/oss/src/core/evaluations/runtime/broker.py`
    (`build_evaluations_broker`/`build_evaluations_worker`): the producer side
    (`api/entrypoints/routers.py`) constructs it with `consumer_group_name=
    "api-evaluations-producer"`, the consumer side (`worker_queues.py`) with
    `consumer_group_name="worker-evaluations"` — one factory, two group identities.

- [x] **1b. The 7 old entrypoints — deleted.** `worker_tracing.py`, `worker_records.py`,
  `worker_events.py`, `worker_webhooks.py`, `worker_triggers.py`,
  `worker_interactions.py`, `worker_evaluations.py` are gone. `worker_streams.py`/
  `worker_queues.py` are the sole worker entrypoints; all deploy surfaces
  (compose/Helm) moved off the old files.

- [x] **1c. `.tick()` on the logger.** `api/oss/src/utils/logging.py`: add `.tick(...)` to
  `MultiLogger` (EMF JSON line to stdout via a dedicated stdlib `print`/handler, not routed
  through structlog's existing processors — EMF has a fixed shape). Call it at:
  - `api/oss/src/core/tracing/streaming.py` `publish_spans` (after the pipeline `execute`).
  - `api/oss/src/core/events/streaming.py` `publish_event`.
  - `api/oss/src/core/sessions/records/streaming.py` `publish_record`.
  - The `.kiq()` call sites: `api/oss/src/core/triggers/service.py:1411`,
    `api/oss/src/apis/fastapi/triggers/router.py:1598`,
    `api/oss/src/apis/fastapi/sessions/router.py:832`,
    `api/oss/src/tasks/asyncio/webhooks/dispatcher.py:274`,
    `api/oss/src/core/evaluations/runtime/runner.py:36/68/104`.
  - Each stream consumer's `run()` loop in `api/oss/src/tasks/asyncio/shared/consumer.py`
    (rate/duration/errors/payload, dimensioned by `stream`).

## Package 2 — dev compose + helm (this repo only)

- [x] **2a.** `hosting/docker-compose/ee/docker-compose.dev.yml` and
  `hosting/docker-compose/oss/docker-compose.dev.yml`: added `worker-streams` and
  `worker-queues` services (same image, `python -m entrypoints.worker_streams` /
  `worker_queues`, same `watchmedo` wrapper + `init: true` + `--signal SIGTERM` from
  0b, same `volumes`/`env_file`/`depends_on`/`networks`/`restart` pattern as the previous
  worker services). Inline `environment:` carries
  `AGENTA_WORKER_STREAMS: ""` / `AGENTA_WORKER_QUEUES: ""` (empty ⇒ all loops) alongside
  the existing `DOCKER_NETWORK_MODE` inline var — NOT added to `.env.*.dev` files, per
  the audit's wiring note (topology knobs must differ per-container even with an
  identical `.env`).
  - The 7 old `worker-*` service blocks were deleted outright (not commented out) in
    both files — dev boots the 2 new containers by default; the old blocks are
    recoverable from git history if a rollback is ever needed.

- [x] **2b.** `hosting/kubernetes/helm/templates/`: added
  `worker-streams-deployment.yaml` and `worker-queues-deployment.yaml` modeled on the
  previous `worker-tracing-deployment.yaml` shape (values lookups, New Relic wrapping,
  livenessProbe `pgrep -f entrypoints.worker_streams` / `worker_queues`), parameterized
  the same way (`agenta.values`, `$values.workerStreams`/`$values.workerQueues`,
  `agenta.workerStreams.enabled`/`.replicas`, mirroring the previous
  `agenta.workerTracing.*` helper convention in `_helpers.tpl`).
  - The 7 old `worker-*-deployment.yaml` files were deleted outright, along with their
    `_helpers.tpl` entries — helm ships only the two merged deployments now.

## Package 2 (follow-up) — the rest of the orchestration surface

The first pass only touched the two dev compose files. The consolidation had to be
made consistent across every compose file the workers appear in, the helm values
surface, the env example docs, and the self-host docs — otherwise the repo would ship
two conflicting topologies.

- [x] **2a-gh. The other 5 compose files.** Applied the same transformation (2 new
  services with inline `AGENTA_WORKER_STREAMS`/`AGENTA_WORKER_QUEUES` empty selectors +
  healthcheck grepping the new entrypoint; 7 old worker services deleted outright, not
  commented out), mirroring EACH file's own conventions (gh uses JSON-array `command:`,
  list-form `environment:`, per-file network name; gh.local uses `build:` +
  `newrelic-admin run-program`; ssl uses its own network) rather than pasting dev's form:
  - `hosting/docker-compose/ee/docker-compose.gh.yml`
  - `hosting/docker-compose/ee/docker-compose.gh.local.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.local.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.ssl.yml`
  - `docker-compose.otel.yml` has no workers — left untouched.
  - Empty-selector idiom: list-form env uses `- AGENTA_WORKER_STREAMS=` (bare `=`), NOT
    `=""` (which yields the literal two-char value `""`). Map-form (dev) uses `: ""`.
    Verified each renders as an empty string via `docker compose config`.

- [x] **2b-values. Helm values.yaml + default-topology decision.** The chart ships ONE
  topology: **topology A** — `workerStreams` + `workerQueues`, `enabled: true` by
  default (`_helpers.tpl` fallback). The 7 legacy per-loop deployments, their
  `values.yaml` keys, and their `_helpers.tpl` helper entries (`agenta.workerTracing.*`
  and siblings) were deleted outright — there is no legacy fallback path left in the
  chart; `hosting/kubernetes/helm/values.yaml` now carries only the `workerStreams`/
  `workerQueues` blocks (`enabled`, `replicas`, commented `streams`/`queues` selector
  examples) under a header pointing at this design doc.

## Package 4 (follow-up) — operator-facing docs

- [x] **3. env.\*.example (4 files).** Appended a commented "Workers topology" section to
  `hosting/docker-compose/{ee,oss}/env.{ee,oss}.{dev,gh}.example` documenting
  `AGENTA_WORKER_STREAMS`/`AGENTA_WORKER_QUEUES` (what they select, empty ⇒ all, and that
  they are set per-service inline in compose, NOT in the env file).

- [x] **4. Self-host MDX docs (3 files).** Rewrote the worker layout to the two kinds:
  - `docs/docs/self-host/infrastructure/01-architecture.mdx` — ASCII box + prose +
    dependency list now describe worker-streams/worker-queues as list-parameterized,
    one-of-each by default.
  - `docs/docs/self-host/infrastructure/02-networking.mdx` — worker-pool box + flow lines.
  - `docs/docs/self-host/03-upgrading.mdx` — `docker rollout` commands now roll the two
    new services (the old per-service rollouts would target now-deleted services).

## Verification

- [x] `ruff format` then `ruff check --fix` in `api/`. Fix all errors.
- [x] Smoke-import `api/entrypoints/worker_streams.py` and `worker_queues.py` — import
  failures seen were purely missing-runtime-infra (DB/Redis unreachable), not code defects.
- [x] `docker compose -f <file> config -q` clean on all 7 compose files (dev ×2 + gh ×5).
- [x] `helm lint` + `helm template` render exactly the 2 merged deployments (the 7 legacy
  deployments are deleted, so there is no legacy-fallback render path to verify);
  selectors/replicas plumb through.
