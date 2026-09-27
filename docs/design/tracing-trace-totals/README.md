# Trace totals across OTLP requests

Status: implemented in `claude/project-thread-1g82wj-trace-totals`.
Bugs: B14 (root cost misses the agent subtree), B17 (Pi root shows no cost).

## Problem

Ingest rolls metrics (costs, tokens, errors) up from children to parents once per OTLP
request, in `TracingService.ingest_span_dtos`, and stores the result in
`ag.metrics.<metric>.cumulative` on each span.

A trace often arrives in more than one request:

- The agent runner exports its spans (`invoke_agent` → turns → `chat`) in its own
  request, under the Python SDK's workflow span, which the SDK exports separately.
- The Pi harness exports its spans from the sandbox under the caller's traceparent.
- An OpenTelemetry `BatchSpanProcessor` sends spans when they end, so children often go
  out before their root.

The trace root then misses the subtrees from other requests. The dashboard reads
`cumulative` from root spans only, so it under-reports cost.

## Design

`TracingWorker` (`api/oss/src/tasks/asyncio/tracing/worker.py`) already stores spans
asynchronously. After it writes a batch, it recomputes the totals of every trace the
batch touched, one trace at a time:

- `TracingDAO.recompute_trace_metrics` takes a transaction-scoped Postgres advisory lock
  on the trace, reads `span_id`, `parent_id`, `span_type`, times,
  `attributes->'ag'->'metrics'` and `attributes->'ag'->'flags'` of every span of the
  trace, runs the ingest roll-up (`recompute_cumulative_metrics` in `trees.py`, without
  pricing), and updates only the `cumulative` values that changed. It never writes
  `incremental` values.
- Each recompute runs after its own batch has committed, and the lock serializes
  recomputes of one trace. So the last recompute of a trace reads every span written
  before it.
- Upserts and updates lock rows in `(trace_id, span_id)` order, so they cannot deadlock.
- The HTTP ingest path is unchanged: it only publishes to the Redis stream.

Roll-up rule: a span's own usage and its children's add up. A span whose producer sets
`ag.flags.aggregate_usage` (the SDK agent handler's workflow span, stamped with the
whole run's usage) keeps the larger of the two instead, since both describe the same
model calls.

## Cost and limits

- Per worker batch: one short transaction per touched trace (an indexed read on
  `ix_project_id_trace_id` plus an `executemany` of the changed rows). Traces that
  arrived in one request usually produce no update.
- Traces over `AGENTA_OTLP_TOTALS_MAX_SPANS` (default 10 000) are skipped and keep
  their per-request totals.
- A failed recompute is retried in place, three attempts with a short backoff. After
  the last attempt it is logged and the batch is still acknowledged (a redelivery would
  meter the traces again). The trace keeps its partial totals until another batch
  touches it.
- A cumulative value that rolls up to nothing is removed, not written as 0: the
  dashboard counts any stored `errors.cumulative` as a failed trace.

## Options not taken

- Scheduling split traces in a Redis queue with a delay window, claims and leases:
  coalesces recomputes, but adds a second queue, recovery paths, and loses work when a
  worker restarts between ack and scheduling.
- Computing totals at read time: multiplies the rows the dashboard reads by the trace
  size, and the roll-up needs the tree.
- Rolling up from stored spans on the request path: adds database reads to ingest.
- One request per trace from producers: not possible across processes or for
  third-party exporters.

## Left

- An integration test against Postgres for the update statement.
- Live check of B17: confirm that Pi `chat` spans carry a cost, so the recomputed root
  shows it.
