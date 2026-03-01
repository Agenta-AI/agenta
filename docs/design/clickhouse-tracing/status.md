Status

Current focus: ClickHouse read path parity for UI.

Progress

- ClickHouse Cloud instance is reachable via HTTPS.
- Postgres tracing schema has been reviewed for field mapping.
- Draft ClickHouse schema created in schema.sql.
- ClickHouse spans table created in the default database.
- Sample loader script created: bench_clickhouse_load.py.
- Sample load completed. 3000 spans inserted into default.spans.
- Scale load completed. 303000 spans inserted into default.spans.
- Baseline query timings captured on ClickHouse for the 303000 span dataset.
- Full load completed. 3000000 spans inserted into default.spans.
- Comparison timings recorded against Timescale.
- Optimized schema created as default.spans_beta.
- Full load completed for spans_beta.
- Optimized query timings captured.
- ClickHouse tracing DAO added for write path only.
- Worker switch implemented via TRACING_BACKEND=clickhouse.
- Ingestion benchmark executed against ClickHouse backend.
- ClickHouse DAO updated for read path (query, analytics, legacy analytics, sessions/users).
- Added ClickHouse filtering translation for common query operators and fields.
- Fixed deployed EE worktree ClickHouse auth wiring (missing CLICKHOUSE_TRACING_* env vars caused 401 on ingest/query).
- Fixed ClickHouse row mapping for JSON list-like fields (`references`, `links`, `hashes`, `events`) so tracing query no longer collapses to empty results.
- Fixed enum literal SQL rendering so filters like `trace_type = invocation` work correctly.
- Parity requirement captured: tracing API responses must match Postgres timestamp shape (ISO-8601 with timezone, e.g. `...Z`) so existing cursor logic keeps working.
- Noted behavior: `application_id` query param on tracing endpoints is not currently consumed in backend filtering; app-scoped filtering must come from explicit tracing filter conditions.

Open items

- Consider schema changes to avoid JSON extraction overhead.
- Evaluate a Map column strategy for dynamic evaluator scores.
- Diagnose OTLP POST auth issue in httpx and requests clients.
- Validate query/analytics correctness against Postgres outputs.
- Verify sessions/users pagination behavior with windowing cursors.
- Validate completion-run generated traces appear in UI after the ClickHouse env/auth fix.
