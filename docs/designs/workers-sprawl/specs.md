# Workers Sprawl — codebase slice

Source of truth: the workers-sprawl audit (external, not in this repo). This spec covers
only the slice that lives in **this** repo (`application/`): Package 0 codebase parts,
Package 1 in full, and the dev-compose/helm parts of Package 2. Prod compose
(`platform/`) and Terraform (`infrastructure/`) are out of scope — other agents own them.

## What

Seven always-on `worker-*` containers split into two families:

- **Stream workers** (records, events, tracing) — hand-rolled asyncio consumers of Redis
  Streams via `XREADGROUP`/`XACK`/`XDEL`. Classes:
  `api/oss/src/tasks/asyncio/tracing/worker.py`,
  `api/oss/src/tasks/asyncio/sessions/records_worker.py`,
  `api/oss/src/tasks/asyncio/events/worker.py`. These three are the same program
  copy-pasted three times (`create_consumer_group`/`read_batch`/`ack_and_delete`/`run`
  byte-identical; see tracing `worker.py:83-189` vs records `records_worker.py:58-131` vs
  events `worker.py:69-153`).
- **Queue workers** (webhooks, triggers, interactions, evaluations) — TaskIQ
  `RedisStreamBroker` consumers, one broker per process, `workers=1`. Entrypoints
  `api/entrypoints/worker_{webhooks,triggers,interactions,evaluations}.py`.

Each of the seven pays a full per-process baseline (interpreter + import graph + New
Relic agent) despite being IO/network-bound, not CPU-bound — that baseline dominates
the RAM cost, independent of throughput.

## Why

Consolidate container *types* (not replicas — replicas are already 1 everywhere) by
packing multiple consumer loops into one process, while changing nothing external.
Two entrypoint *kinds*, each list-selecting a subset of its family's loops:

- `worker-streams` — `AGENTA_WORKER_STREAMS` (subset of `{records,events,tracing}`),
  empty ⇒ all three, hosted as sibling `asyncio.gather`ed loops (same event loop,
  cheap: stream consumers are already plain coroutines).
- `worker-queues` — `AGENTA_WORKER_QUEUES` (subset of
  `{webhooks,triggers,interactions,evaluations}`), empty ⇒ all four.

This collapses 7 dev containers to 2 with no topology-specific code — every topology
(merge-all, peel-one-out, per-loop) is just a choice of list values, not a new code path.

## Constraints preserved (must not change)

1. Stream names verbatim: `streams:tracing`, `streams:events`, `streams:records`. (The
   separate planned `streams:tracing` → `streams:spans` rename is NOT done here.)
2. Queue names verbatim: `queues:webhooks`, `queues:triggers`, `queues:interactions`,
   `queues:evaluations`.
3. Consumer-group names verbatim (all seven): `worker-tracing`, `worker-events`,
   `worker-records`, `worker-webhooks`, `worker-triggers`, `worker-interactions`,
   `worker-evaluations`. This is the coordination identity that makes scale-up safe —
   `consumer_name = f"worker-{os.getpid()}"` per process, unchanged.
4. Message shapes: `data` = zlib(orjson(...)) blob on streams; TaskIQ task names + kwargs
   unchanged.
5. Read/write semantics unchanged: `XREADGROUP`/`XACK`/`XDEL` on streams; TaskIQ
   ack/retry on queues; per-task retry flags; evaluations' no-redelivery
   (`_NoRedeliveryRedisStreamBroker`) + Redis job-lock behavior untouched.
6. Producer `.kiq()`/`XADD` call sites unchanged, except the tracing pipeline batching
   below (a perf fix, not an interface change — same stream, same field, same count
   semantics).
7. Durable Redis stays the substrate for everything.

## Per-worker asymmetries that must survive the stream-worker refactor

These are NOT hoisted, dropped, or generalized away — each stays scoped to its own
subclass:

- **events ingest is EE-gated** (`if is_ee():` around `service.ingest`, see
  `events/worker.py:270-274`) — tracing and records ingest unconditionally in OSS too.
- **events has a webhook-dispatch post-hook** that can *skip ack* to force redelivery on
  dispatch failure (`events/worker.py:309-324`) — tracing/records have no such stage.
- **Differing meter counters**: `Counter.TRACES_INGESTED` / `Counter.EVENTS_INGESTED` /
  `Counter.RECORDS_INGESTED`.
- **Differing group keys**: tracing groups by org → (project, user); events/records
  group by project (+ org for the quota pass).
- **records writes per-event** via `service.append(event=...)` in a loop; tracing/events
  write the whole grouped batch via `service.ingest(...)`.

## Design: `StreamConsumer` base class

New file `api/oss/src/tasks/asyncio/shared/consumer.py` (no existing `shared/` dir under
`tasks/asyncio` before this change). Holds the byte-identical mechanics:
`create_consumer_group`, `read_batch` (time-boxed accumulation up to `max_delay_ms`),
`ack_and_delete`, `run` (the `while True: read → process_batch → ack` loop with
`sleep(1)` on error), and the shared constants (`max_batch_size=50`, `max_block_ms=5000`,
`max_delay_ms=250`, `max_batch_mb=50`).

Each of the three concrete workers (`TracingWorker`, `EventsWorker`, `RecordsWorker`)
subclasses `StreamConsumer` and implements only `process_batch` (the per-worker
deserialize/group/meter/write/post-hook logic already differs enough — see table above
— that forcing a narrower `{deserialize, group_key, meter, write, post_hook}` seam would
fragment `process_batch`'s control flow across 5 template methods for little gain; the
audit's suggested seam is honored in spirit — one base class, only the deltas in
subclasses — via overriding `process_batch` as the single delta method). Pure refactor:
behavior byte-identical, consumer group names unchanged, log prefixes
(`[INGEST]`/`[EVENTS]`/`[RECORDS]`) preserved per subclass.

## Design: two list-parameterized entrypoints

- `AGENTA_WORKER_STREAMS`, `AGENTA_WORKER_QUEUES` — new env vars in
  `api/oss/src/utils/env.py`, comma-separated lists, consumed via the shared `env`
  object. Empty/unset ⇒ all loops in that family.
- `api/entrypoints/worker_streams.py` — constructs the selected `StreamConsumer`
  subclasses and `asyncio.gather`s their `.run()` coroutines in one process. Low risk:
  stream workers are plain coroutines we already own.
- `api/entrypoints/worker_queues.py` — hosts the selected TaskIQ brokers in one process.

### The multi-broker TaskIQ spike

`taskiq.cli.worker.run.run_worker(WorkerArgs)` is **not awaitable-safe to co-host**: it
calls `ProcessManager(...).start()`, which forks OS child processes (`spawn` on darwin)
and installs its own `SIGINT`/`SIGTERM` handlers in `start_listen`, which in turn creates
its **own** event loop via `loop.run_until_complete(receiver.listen(shutdown_event))`.
Calling `run_worker` from inside our own loop, or `asyncio.gather`ing several of them, is
not supported — each call wants to own the process and the loop.

The actual per-broker unit of async work is `taskiq.receiver.Receiver.listen(finish_event)`
— a plain coroutine (`await self.broker.startup(); ...; anyio.create_task_group()`); this
is what `start_listen` awaits after all the process/signal/executor setup. `worker_events.py`
already demonstrates the pattern in miniature: it constructs a `RedisStreamBroker`,
`await broker.startup()`s it, and drives it via the webhooks dispatcher — no
`run_worker` involved.

`worker_queues.py` therefore bypasses `run_worker`/`ProcessManager` entirely: for each
selected queue it builds the existing broker + registers tasks (reusing
`WebhooksWorker`/`TriggersWorker`/`InteractionsWorker`/`EvaluationsWorker` unchanged),
constructs a `taskiq.receiver.Receiver(broker, executor, max_async_tasks=...)` per broker,
and `asyncio.gather`s `receiver.listen(shared_shutdown_event)` per broker as sibling tasks
in one process. This preserves each broker's `consumer_group_name`, `queue_name`,
`maxlen`, and per-task retry config untouched — only the run-loop driver changes (from
`run_worker`'s process-forking driver to a direct `Receiver.listen` coroutine).

This is implemented for all four queues (not left as a partial TODO) — the risk called
out by the audit ("spike this early") resolves cleanly once `run_worker` is bypassed in
favor of the coroutine it wraps.

The 7 existing `worker_*.py` entrypoints are kept working unchanged (not touched) —
they remain valid one-item topologies; nothing external (compose, helm, prod deploy)
is required to switch to the new entrypoints as part of this slice.

## Design: `.tick()` EMF metrics

`get_module_logger` (in `api/oss/src/utils/logging.py`) returns a `MultiLogger`. Add a
sibling `.tick(name, *, count=1, unit="Count", dims=None, **fields)` method that emits a
single CloudWatch **Embedded Metric Format** JSON line to stdout:

```json
{
  "_aws": {
    "Timestamp": 1710000000000,
    "CloudWatchMetrics": [
      {
        "Namespace": "Agenta/Workers",
        "Dimensions": [["stream"]],
        "Metrics": [{"Name": "tracing.processed", "Unit": "Count"}]
      }
    ]
  },
  "stream": "tracing",
  "tracing.processed": 42
}
```

No new port, no new infra — the CloudWatch agent already ships container stdout; EMF
lines embedded in stdout become metrics automatically. Dimensioned by `stream`/`queue`
so a merged container still separates its loops in CloudWatch. Called at the existing
`log.info` points that already carry the numbers:

- Producers: `publish_spans`/`publish_event`/`publish_record` (rate, payload bytes,
  duration was already implicit; failures via the existing `except` branches) and the
  `.kiq()` sites.
- Consumers: each stream worker's `run()` loop (rate = messages processed, duration =
  batch processing time, errors = deserialize/DB failures via existing log.error calls,
  payload = cumulative batch bytes already tracked as `batch_bytes`).

Kept intentionally small: this is not a general metrics framework, just an EMF line
next to each existing `log.info`/`log.error` that already has the numbers in scope.

## Dev compose and helm (Package 2, this-repo parts only)

Both `hosting/docker-compose/{ee,oss}/docker-compose.dev.yml` gain `worker-streams` and
`worker-queues` services (empty `AGENTA_WORKER_STREAMS`/`AGENTA_WORKER_QUEUES` inline
`environment:` vars — NOT `.env` — so the same `.env` file works for both merged and
split topologies). The 7 existing worker services are commented out (not deleted) so
dev boots 2 containers by default, matching the audit's Recommendation
("one container of each — topology A — by default"). `init: true` and the
watchmedo hardening from Package 0b apply to the 2 new services too (and to the 7 old
ones, kept for reference/rollback).

Helm: two new parameterized deployments alongside the 7 existing `worker-*-deployment.yaml`
(kept, marked deprecated in a comment) — the audit notes helm isn't the prod path here, so
this is a lighter touch: add the shape, don't migrate values/charts wiring beyond what's
needed to prove the two deployments render.

## Operational notes (the "why" behind the one-line source comments)

Source and config files carry only a one-line pointer here; this section is the full
rationale.

**One coherent topology, never two.** Every environment ships *topology A* by default:
one `worker-streams` (records+events+tracing) and one `worker-queues`
(webhooks+triggers+interactions+evaluations). The 7 legacy per-loop
containers/deployments are kept in the tree but disabled by default. Running both the
merged kinds *and* the legacy per-loop set at once would put two consumer groups' worth
of processes on the same stream/queue — wasteful, though not double-processing (Redis
consumer-group exclusivity still holds). So the rule is: exactly one topology active.

- **docker-compose** (all 7 files): the 2 new services are defined and active; the 7
  legacy `worker-*` services are commented out (kept for rollback). To revert to the
  per-loop topology, uncomment the 7 and comment out the 2.
- **helm**: `_helpers.tpl` `*.enabled` fallbacks make `workerStreams`/`workerQueues`
  default `true` and the 7 legacy `worker*` default `false`, so an empty `values.yaml`
  renders exactly topology A. `values.yaml` surfaces `workerStreams`/`workerQueues`
  (`enabled`, `replicas`, optional `streams`/`queues` selector). **Fallback to the legacy
  topology:** set `workerStreams.enabled` and `workerQueues.enabled` to `false`, and each
  `worker*.enabled` to `true`.

**Selector vars.** `AGENTA_WORKER_STREAMS` / `AGENTA_WORKER_QUEUES` are comma-lists;
empty/unset ⇒ all loops in that family. They are set per-service **inline** in each
compose `environment:` block and in each helm deployment's `env`, NOT in the shared
`.env`/env file — two containers run the same image + same env file and differ only by
these two vars, so a shared-file value could not express a split topology. The
`env.*.example` files document them but do not set them.

**Empty-selector idiom by env form.** In docker-compose *map-form* `environment:`
(the dev files) the empty value is `AGENTA_WORKER_STREAMS: ""`. In *list-form*
`environment:` (the gh/gh.local/ssl files) it MUST be the bare `- AGENTA_WORKER_STREAMS=`
— `- AGENTA_WORKER_STREAMS=""` would resolve to the literal two-character value `""`,
which the CSV parser would read as a one-element list and reject as an unknown loop.
