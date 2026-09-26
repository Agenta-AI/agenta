# Trace totals across OTLP requests

Status: option A is implemented in `claude/project-thread-1g82wj-trace-totals`.
Bugs: B14 (root cost misses the agent subtree), B17 (Pi root shows no cost).

## Problem

Ingest rolls metrics (costs, tokens, errors) up from children to parents. It does this
once per OTLP request, in `TracingService.ingest_span_dtos`, with
`calculate_and_propagate_metrics_by_trace`. The result goes into
`ag.metrics.<metric>.cumulative` on each span.

A trace often arrives in more than one request:

- The agent runner exports its spans (`invoke_agent` → turns → `chat`) in its own
  request. Their parent is the Python SDK's workflow span, which the SDK exports in a
  different request.
- The Pi harness exports its spans from the sandbox, under the caller's traceparent,
  in separate requests (`services/runner/src/tracing/pi-*.ts`). This is the same
  cause, so B17 has the same fix.
- An OpenTelemetry `BatchSpanProcessor` (the SDK, Logfire, and other exporters) sends
  spans when they end. Children often go out before their root
  (`api/oss/tests/manual/tracing/ingestion/README.md`).

Since #7179, each request's subtree has a correct cumulative. The totals still stop at
the request boundary. The trace root does not include subtrees that came in other
requests. The dashboard reads `cumulative` from root spans only
(`build_base_cte` filters `parent_id IS NULL`), so it under-reports cost. The SDK works
around this for agents: `record_usage` copies the run total onto the workflow span.

## How ingest works today

1. `POST /otlp/v1/traces` parses the spans, rolls up metrics per request, and adds one
   message per span to the Redis stream `streams:spans` (one pipelined round trip).
   The request does not touch Postgres.
2. `TracingWorker` (`api/oss/src/tasks/asyncio/tracing/worker.py`, run by
   `entrypoints/worker_streams.py`) reads up to 50 messages, checks entitlements, and
   upserts the spans with `TracingDAO.ingest`. An upsert replaces the whole row.
3. Readers use the stored `cumulative` values: analytics on root spans, and the trace
   drawer on every span.

A worker read is not the same as a request. One request can be split across two reads.
Two requests can land in one read.

## Options

### A. Recompute in the worker after a short delay (recommended)

- The API tags every message of one request with a `batch_id` (a random id, no I/O).
- After the worker stores spans, it adds the batch ids to a Redis set per trace
  (`tracing:totals:batches:<project>:<trace>`, TTL 24 h), in one pipelined round
  trip per worker read. A set with more than one id means that more than one request
  touched the trace.
- Such a trace goes into a Redis sorted set (`tracing:totals:queue`) with a due time of
  now + `AGENTA_OTLP_TOTALS_DELAY_MS` (default 5 s). `ZADD NX` keeps the first due time,
  so a busy trace is recomputed at most once per window.
- A second loop in the same worker claims due traces (`ZREM` gives each trace to one
  replica), and calls `TracingService.recompute_trace_totals`.
- The DAO takes a Postgres advisory lock for the trace, reads `span_id`, `parent_id`,
  `span_type`, times and `attributes->'ag'->'metrics'` of every span, runs the same
  roll-up as ingest (`recompute_cumulative_metrics` in `trees.py`, without pricing),
  and updates only the `cumulative` values that changed. It never writes
  `incremental` values.

Cost:

- Request path: one random id per request. Measured: 100 spans serialize in about
  2.5 ms, with or without the id; the difference is below 0.15 ms. No new Redis or
  database calls.
- Worker, every read: one pipelined Redis round trip (`SADD`, `EXPIRE`, `SCARD` per
  trace), and a `ZADD` only when a trace is split.
- Worker, per split trace and window: one indexed read of the trace's metrics
  (`ix_project_id_trace_id`) and one `executemany` update of the changed rows. Traces
  over `AGENTA_OTLP_TOTALS_MAX_SPANS` (default 10 000) are skipped.

Correctness with late spans: every stored request for a split trace schedules the trace
again after its write, so the last recompute reads after the last write. The advisory
lock makes recomputes of one trace run one after the other, so an older read cannot
write last. The update sets only `ag.metrics.<metric>.cumulative`, so it cannot erase a
newer `incremental`. An upsert that overwrites a recomputed value schedules a new
recompute. Upserts and updates lock rows in `(trace_id, span_id)` order, so they cannot
deadlock.

Span-type rule: model-call spans (`chat`, `completion`, `embedding`, `query`, `rerank`)
sum their own usage and their children. Other spans take the larger of their own usage
and their children's sum. So the run total that `record_usage` copies onto the workflow
span is not counted twice when the runner's `chat` spans roll up under it (see
`test_copied_run_total_on_the_workflow_span_is_not_counted_twice`).

Failure modes:

- Redis loses the queue or the batch sets: split traces keep per-request totals, which
  is today's behavior. The next request for the trace schedules it again.
- A worker crashes after it claims a trace, or a recompute fails: the claim stays in
  `tracing:totals:claims` with a lease deadline (60 s). When the lease expires, the
  worker puts the trace back in the queue and recomputes it. A failure does not block
  ingest.
- A trace is queued again while a recompute of it runs, and a second worker claims it:
  each claim has its own token (`<project>:<trace>|<token>`), so one worker's
  completion does not remove the other worker's claim. A race between a completion and
  a recovery can only queue one extra recompute, which is idempotent.
- Redis is down when the worker schedules a trace: the worker keeps the trace in memory
  (at most 10,000) and tries again. If the worker also stops during the outage, those
  traces keep per-request totals. We do not write a durable outbox at ingest, because
  that adds a database write to the ingest path.
- Spans that arrive more than 24 h after the first request of their trace: the batch
  set has expired, so the trace is not scheduled.
- Messages from an API that does not send `batch_id` (during a rolling deploy): these
  traces are not scheduled.
- The dashboard shows the per-request total for up to the delay plus the worker lag.

### B. Compute trace totals at read time

Analytics would sum model-call spans per trace, or rebuild each tree, instead of reading
root `cumulative`. This needs no write path. But the dashboard scans roots in a time
window; summing all spans of those traces multiplies the rows it reads by the trace
size, and the span-type rule needs the tree, which SQL cannot express cheaply. The trace
drawer would also need the same logic in a second place. We reject it for the dashboard.
The drawer could use it later, because it already loads the whole trace.

### C. Roll up at ingest from stored spans

Before the request returns, read the stored ancestors and descendants. This adds
database reads to the request path and fails when the other part arrives later. The
hard requirement is that ingest stays fast, so we reject it.

### D. Make producers send one request per trace

The runner could hold its spans until the SDK span ends, or the SDK could wait for the
runner. This is not possible across processes, and third-party exporters cannot be
changed. `record_usage` is a partial form of this for agent runs only.

## What is implemented and what is left

Implemented:

- `batch_id` on span messages (`core/tracing/streaming.py`).
- Scheduling and claiming (`core/tracing/totals.py`), and the second loop in
  `TracingWorker`.
- `recompute_cumulative_metrics` (`core/tracing/utils/trees.py`) and
  `TracingDAO.recompute_trace_metrics`.
- `AGENTA_OTLP_TOTALS_DELAY_MS` and `AGENTA_OTLP_TOTALS_MAX_SPANS` in `utils/env.py`.
- Unit tests with fakeredis and a fake session (no live database).

Left:

- An integration test against Postgres for the update statement (the statement was
  only parsed with the Postgres parser).
- Live check of B17: confirm that Pi `chat` spans carry a cost (reported or priced), so
  the recomputed root shows it.
- `record_usage` can go away once this is deployed and verified, because the root then
  gets the run total from its children.
- A metric for scheduled, claimed, and skipped traces.
