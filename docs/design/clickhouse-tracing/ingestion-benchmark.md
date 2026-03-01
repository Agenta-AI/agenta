ClickHouse ingestion benchmark

Goal

Measure ingestion throughput when the tracing worker writes to ClickHouse. Compare to the Timescale baseline.

Setup

- Backend switch: TRACING_BACKEND=clickhouse
- ClickHouse table: default.spans_beta
- ClickHouse URL: https://er3fulih5c.eu-central-1.aws.clickhouse.cloud:8443
- Ingestion endpoint: POST /api/otlp/v1/traces

Method

- Payload: protobuf OTLP
- Request shape: 10 traces per request
- Spans per trace: 3
- Total traces per run: 5,000
- Concurrency levels: 1, 5, 10, 20, 50

Results

ClickHouse results

- Backend: TRACING_BACKEND=clickhouse
- Table: default.spans_beta
- Batch size: 1000 spans per insert
- Client transport: curl via subprocess. httpx and requests returned 401 for OTLP POST with body.

Concurrency sweep

| Concurrency | Send time (s) | Traces/s | Spans/s | HTTP errors |
| --- | --- | --- | --- | --- |
| 1 | 7.99 | 626 | 1878 | 0 |
| 5 | 3.82 | 1310 | 3931 | 0 |
| 10 | 3.57 | 1399 | 4197 | 0 |
| 20 | 3.42 | 1462 | 4385 | 0 |
| 50 | 3.62 | 1381 | 4143 | 0 |

Drain observation

- Redis drain rate observed at about 368 spans per second over a 30 second window.
- This corresponds to about 123 traces per second with 3 spans per trace.

Notes

- Redis stream drained to 50 pending entries. These are still owned by worker-7.
- ClickHouse row delta after the run was 12,900 spans. Expected was 15,000 spans.
- The remaining 50 pending entries explain the shortfall.

Timescale baseline (for reference)

- API accept rate: ~1,400 to 1,530 traces/s
- Worker persist rate: ~33 traces/s before batching
- Worker persist rate: ~167 traces/s with chunked bulk upsert
