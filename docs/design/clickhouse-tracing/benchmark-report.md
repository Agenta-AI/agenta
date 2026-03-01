ClickHouse tracing benchmark report

Summary

This report covers query performance only. It does not cover ingestion. We compared Timescale (TigerData) against ClickHouse on the tracing spans table. We tested ClickHouse with two schemas. The first schema stores metrics only in JSON. The second schema adds materialized columns for hot metrics.

Dataset

- 1,000,000 traces and 3,000,000 spans
- 90 day timestamp spread
- Single project_id: 019ca07e-1356-7793-a78e-132432eef0ce

Schema variants

1) ClickHouse base schema. All metrics only in JSON.
2) ClickHouse optimized schema. Adds materialized columns:
   - duration_cumulative
   - tokens_total
   - cost_total

Load time

- ClickHouse base schema: 3,000,000 spans in 127 seconds via JSONEachRow over HTTPS
- ClickHouse optimized schema: 3,000,000 spans in 451 seconds with 50,000 row batches
- Timescale: 3,000,000 spans in about 10 minutes via asyncpg COPY

Query timings

All queries filter by project_id. Times in seconds.

| Query | ClickHouse JSON only | ClickHouse optimized | Timescale |
| --- | --- | --- | --- |
| count spans | 0.082 | 0.109 | 0.645 |
| count traces | 0.205 | 0.202 | 3.968 |
| avg duration | 8.467 | 0.155 | 3.245 |
| p50, p90, p95, p99 duration | 8.243 | 0.153 | 5.880 |
| histogram 20 bins duration | 8.253 | 0.167 | 9.611 |
| daily count | 0.104 | 0.126 | 2.820 |

Observations

1) ClickHouse is fast on counts and grouping even with JSON only.
2) JSON extraction is the bottleneck for numeric aggregations in ClickHouse.
3) Materialized columns remove JSON parsing cost and make ClickHouse much faster for analytics.
4) Timescale remains solid for JSON based queries, but is slower than ClickHouse with optimized columns.

Appendix. Methodology

ClickHouse setup

- Database: default
- Tables: spans and spans_beta
- Engine: MergeTree
- Partition: toDate(created_at)
- Order by: (project_id, trace_id, span_id, created_at)

ClickHouse JSON extraction used in base schema

- JSONExtractFloat(toJSONString(attributes), 'ag','metrics','duration','cumulative')

ClickHouse optimized schema columns

- duration_cumulative Float64 MATERIALIZED JSONExtractFloat(toJSONString(attributes), 'ag','metrics','duration','cumulative')
- tokens_total UInt64 MATERIALIZED JSONExtractUInt(toJSONString(attributes), 'ag','metrics','tokens','cumulative','total')
- cost_total Float64 MATERIALIZED JSONExtractFloat(toJSONString(attributes), 'ag','metrics','costs','cumulative','total')

Timescale setup

- Hypertable spans with weekly chunks
- Project filter: project_id = 019ca07e-1356-7793-a78e-132432eef0ce
- Histogram uses width_bucket(…, 20) for binning

Query set

1) count spans
2) count distinct trace_id
3) avg duration
4) p50, p90, p95, p99 duration
5) histogram 20 bins
6) daily count
