Following up on your message about Timescale from Friday. I wanted to test it out, so I spun up a Timescale Cloud instance and pointed only the tracing database at it. The core DB, SuperTokens, and Redis all stayed local.

I ran the Alembic migrations from scratch against the Timescale instance. Everything worked as is; no code changes were needed to get the schema up. I then converted the `spans` table to a hypertable (partitioned by `created_at` with weekly chunks) and enabled compression. The only required code change was adding `created_at` to the upsert's `index_elements`, because TimescaleDB requires the partition column in all unique constraints.

To have realistic data for benchmarking, I bulk-inserted 1M traces (3M spans, about 6 GB) spanning 90 days. Compression brought that down to 3.8 GB across 14 weekly chunks.

I did not benchmark against local Postgres or RDS. The goal was to see how the analytics queries behave on Timescale at a realistic scale, not to do a head-to-head comparison (yet).

### Benchmark results

I tested through the actual analytics API (`POST /api/tracing/analytics/query`). The queries include percentile computation, histograms, and JSONB extraction from the `attributes` column.

For small time ranges (1 day, about 11K root traces), queries returned in under 1 second. For 7 days (77K traces), about 3 seconds. Anything beyond 30 days (330K+ traces) hit the 15-second statement timeout and returned empty results.

I also created a continuous aggregate (`daily_trace_stats`) that pre-computes counts, averages, sums, min/max for duration, cost, and tokens per day. Direct SQL queries against this aggregate returned in under 7ms regardless of time range. That is 50x to 690x faster than the equivalent raw queries.

### Histogram fix (unrelated to Timescale)

While investigating the timeouts, I found a performance issue in the analytics query builder that affects all Postgres backends, not just Timescale.

The histogram computation was using a nested-loop join between generated bin intervals and every data row. For 332K traces, that produced 191 million row comparisons and took about 40 seconds. I replaced it with PostgreSQL's built-in `width_bucket()` function, which assigns each row to a bin in O(1). The results after the fix:

| Query | Before | After |
|---|---|---|
| Duration, 7 days | 2.97s | 0.47s |
| Duration, 30 days | timeout | 3.2s |
| Duration, 90 days (1M traces) | timeout | 11.9s |
| Dashboard (6 metrics), 30 days | timeout | 8.1s |

I opened a PR for this change. It is a single function edit in `api/oss/src/dbs/postgres/tracing/utils.py` and the output format is unchanged.

### Ingestion benchmark

I also benchmarked OTLP trace ingestion through the actual API endpoint (`POST /api/otlp/v1/traces`). The test sends protobuf payloads with 10 traces each (3 spans per trace: 1 root + 2 children).

The write pipeline has two stages. The API handler parses the protobuf, transforms spans, and publishes them to a Redis Stream. It returns HTTP 200 immediately. A background worker then reads from Redis in batches of 50 and writes each span to Postgres via individual `INSERT ... ON CONFLICT` statements.

**API accept rate** (HTTP to Redis): about 1,500 traces/s (4,500 spans/s). Concurrency beyond 5 did not improve throughput; the bottleneck is the API's protobuf parsing and span transformation.

**Worker drain rate** (Redis to Timescale Cloud): about 33 traces/s (98 spans/s). Each span is a separate SQL round-trip to the remote Timescale instance. With ~10ms network latency per query and 50 spans per batch, the worker spends most of its time waiting on the network.

The gap between accept and drain means the Redis Stream absorbs bursts. A sustained load of 1,500 traces/s would grow the backlog by about 1,400 traces/s until the stream fills up or the worker catches up during quiet periods.

The drain rate is limited by the single-span upsert pattern, not by Timescale itself. Switching to bulk inserts (e.g., `COPY` or multi-row `INSERT`) would close this gap significantly. The bulk insert script I used to load the test data (`bench_bulk_insert.py`) wrote 3M spans in about 10 minutes via `COPY`, which is roughly 5,000 spans/s to the same remote Timescale instance.
