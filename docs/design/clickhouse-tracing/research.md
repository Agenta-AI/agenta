Research notes

Postgres spans schema

Table: spans
Primary key: project_id, trace_id, span_id
Core columns
- project_id (UUID)
- trace_id (UUID)
- span_id (UUID)
- parent_id (UUID, nullable)
- trace_type (enum)
- span_type (enum)
- span_kind (enum)
- span_name (string)
- start_time (timestamptz)
- end_time (timestamptz)
- status_code (enum)
- status_message (string, nullable)
- attributes (JSONB)
- references (JSONB)
- links (JSONB)
- hashes (JSONB)
- events (JSONB)

ClickHouse schema considerations

- UUID and DateTime64 map cleanly.
- JSONB fields should be stored as JSON or String. JSON type is preferred for queries.
- Sorting key should include project_id and start_time. That supports time range and tenant filters.
- Partitioning by date can help for retention and pruning.

Benchmark results

Dataset

- ClickHouse: 1,000,000 traces and 3,000,000 spans loaded into default.spans.
- Timescale: 1,001,000 traces and 3,003,000 spans in the project 019ca07e-1356-7793-a78e-132432eef0ce.

ClickHouse load time

- 3,000,000 spans loaded in 127 seconds via JSONEachRow over HTTPS.
- 3,000,000 spans loaded in 451 seconds when batching 50,000 spans per request.

Timescale load time

- 3,000,000 spans loaded in about 10 minutes via asyncpg COPY.

Query timings on full dataset with 90 day distribution and project_id filter

| Query | ClickHouse | Timescale |
| --- | --- | --- |
| count spans | 0.082s | 0.645s |
| count traces | 0.205s | 3.968s |
| avg duration | 8.467s | 3.245s |
| p50,p90,p95,p99 duration | 8.243s | 5.880s |
| histogram 20 bins duration | 8.253s | 9.611s |
| daily count | 0.104s | 2.820s |

Optimized schema results

Table: default.spans_beta
Columns: duration_cumulative, tokens_total, cost_total are materialized from JSON.

| Query | ClickHouse optimized | Timescale |
| --- | --- | --- |
| count spans | 0.109s | 0.645s |
| count traces | 0.202s | 3.968s |
| avg duration | 0.155s | 3.245s |
| p50,p90,p95,p99 duration | 0.153s | 5.880s |
| histogram 20 bins duration | 0.167s | 9.611s |
| daily count | 0.126s | 2.820s |

Notes

- ClickHouse JSON extraction uses toJSONString plus JSONExtractFloat. This adds overhead.
- ClickHouse dataset is now distributed across 90 days.
- Both query sets use a project_id filter.
