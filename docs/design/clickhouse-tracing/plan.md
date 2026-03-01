Plan

Phase 1. Integration design

1) Add a ClickHouse tracing DAO interface and implementation. It should mirror the current TracingDAO behavior.
2) Add a config switch for tracing backend selection. Default remains Postgres.
3) Create ClickHouse schema migrations for spans and spans_beta.

Phase 2. Write path

4) Update the tracing worker to write to ClickHouse when the backend switch is enabled.
5) Keep Redis as the buffering layer. Do not change ingest routing yet.
6) Add bulk insert for spans in ClickHouse. Use JSONEachRow with chunking.

Phase 3. Read path

7) Implement query equivalents for the analytics API.
8) Support the main metrics queries first. Count, avg, percentiles, histogram, daily series.
9) Add optional support for Map based dynamic metrics.

Phase 4. Validation

10) Run the analytics benchmark suite for Postgres and ClickHouse.
11) Verify correctness on the same dataset and project_id.
12) Compare performance, storage size, and operational impact.
