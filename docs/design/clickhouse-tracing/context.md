Goal

Evaluate and integrate ClickHouse as an optional tracing storage backend. Keep Postgres as the default.

Scope

- Add a ClickHouse tracing DAO and a configuration switch to select the backend.
- Implement ClickHouse write and read paths for the tracing APIs.
- Validate correctness and performance on the same dataset as the Timescale baseline.

Phase 1 focus

- Implement the write path and ingestion benchmark.

Non-goals

- Replacing the core database or other services.
- Removing the Postgres tracing backend.
