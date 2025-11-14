# PostgreSQL to ClickHouse Migration Guide

This document describes the PostgreSQL to ClickHouse migration infrastructure for Agenta's tracing and observability system.

## Overview

This migration allows Agenta to leverage ClickHouse's columnar storage engine for improved analytical performance on high-volume trace/span data, while maintaining PostgreSQL for transactional operations.

### Architecture

- **Primary Database**: PostgreSQL (reads and writes)
- **Analytical Database**: ClickHouse (optional dual-write for spans)
- **Feature Flag**: `USE_CLICKHOUSE` environment variable enables ClickHouse writes

### Benefits

- **Better Analytical Performance**: ClickHouse excels at columnar operations and aggregations
- **High Volume Support**: Optimized for processing millions of spans
- **Minimal Risk**: Dual-write pattern allows safe transition
- **Optional Adoption**: Can be gradually enabled per deployment

## Directory Structure

```
api/oss/
├── src/
│   ├── dbs/
│   │   ├── clickhouse/                          # ClickHouse implementation
│   │   │   ├── shared/
│   │   │   │   ├── config.py                   # ClickHouse configuration
│   │   │   │   └── engine.py                   # ClickHouse client and connection pool
│   │   │   ├── tracing/
│   │   │   │   ├── dbes.py                     # ClickHouse database entities (schema)
│   │   │   │   └── dao.py                      # ClickHouse Data Access Objects (CRUD)
│   │   │   └── observability/
│   │   │       └── dao.py                      # ClickHouse observability DAOs (nodes)
│   │   └── postgres/
│   │       └── tracing/
│   │           └── dao_dual_write.py           # Dual-write DAO wrapper
│   └── utils/
│       └── env.py                              # Added ClickHouse env variables
│
└── databases/
    └── clickhouse/
        └── migrations/
            └── migrate_postgres_to_clickhouse.py  # Data migration script
```

## Configuration

### Environment Variables

Add these to your `.env.oss.dev` or deployment configuration:

```bash
# ClickHouse Configuration
CLICKHOUSE_HOST=clickhouse              # Default: clickhouse (Docker service name)
CLICKHOUSE_PORT=9000                    # Default: 9000 (native protocol)
CLICKHOUSE_USER=default                 # Default: default
CLICKHOUSE_PASSWORD=""                  # Default: empty
CLICKHOUSE_DATABASE=agenta_oss_tracing  # Default: agenta_oss_tracing
USE_CLICKHOUSE=false                    # Default: false (disabled)
```

### Docker Compose

The ClickHouse service is already configured in `hosting/docker-compose/oss/docker-compose.dev.yml`:

```yaml
clickhouse:
    image: clickhouse/clickhouse-server:latest
    restart: always
    ports:
        - "8123:8123"  # HTTP interface
        - "9000:9000"  # Native protocol
    networks:
        - agenta-network
    volumes:
        - clickhouse-data:/var/lib/clickhouse/
```

## Data Models

### Spans Table

Migrated from PostgreSQL with the following schema:

```sql
CREATE TABLE spans (
    -- Identifiers
    project_id String,
    trace_id String,
    span_id String,
    parent_id Nullable(String),

    -- Span type information
    trace_type Nullable(String),
    span_type Nullable(String),
    span_kind String,
    span_name String,

    -- Timing
    start_time Nullable(DateTime),
    end_time Nullable(DateTime),

    -- Status
    status_code String,
    status_message Nullable(String),

    -- Attributes and metadata (stored as JSON strings)
    attributes Nullable(String),
    references Nullable(String),
    links Nullable(String),
    hashes Nullable(String),
    events Nullable(String),

    -- Lifecycle
    created_at DateTime,
    updated_at Nullable(DateTime),
    deleted_at Nullable(DateTime),
    created_by_id Nullable(String),
    updated_by_id Nullable(String),
    deleted_by_id Nullable(String)
)
ENGINE = MergeTree()
PRIMARY KEY (project_id, trace_id, span_id)
ORDER BY (project_id, created_at, trace_id, span_id)
```

### Nodes Table

```sql
CREATE TABLE nodes (
    project_id String,
    node_id String,
    tree_id Nullable(String),
    root_id Nullable(String),
    created_at DateTime,
    attributes Nullable(String)
)
ENGINE = MergeTree()
PRIMARY KEY (project_id, node_id)
ORDER BY (project_id, created_at, node_id)
```

## Implementation Details

### Dual-Write Pattern

The `DualWriteTracingDAO` (`dao_dual_write.py`) implements a safe migration strategy:

1. **Writes**: All write operations (create, update, delete) write to **both** PostgreSQL and ClickHouse
2. **Reads**: All read operations use **PostgreSQL only** (primary source)
3. **Feature Flag**: ClickHouse writes are controlled by the `USE_CLICKHOUSE` environment variable
4. **Error Handling**: ClickHouse write failures don't affect main operations (logged but not raised)

```python
# Example flow
await dual_write_dao.create_spans(spans)
# 1. Writes to PostgreSQL (always)
# 2. Writes to ClickHouse (if USE_CLICKHOUSE=true)
# 3. Returns PostgreSQL results
```

### Service Integration

The following services automatically support ClickHouse through the dual-write DAO:

- **TracingService**: Manages span creation and queries
- **EvaluationsService**: Uses tracing for evaluation data
- **InvocationsService**: Tracks invocation spans
- **AnnotationsService**: Annotates traces

No service-level changes are needed; the DAO abstraction handles the complexity.

## Migration Process

### Phase 1: Set Up ClickHouse (Done ✓)

- ✅ Docker Compose configured
- ✅ ClickHouse engine and connection pool created
- ✅ Table schemas defined
- ✅ Environment variables added

### Phase 2: Enable Dual-Write (Next Steps)

1. **In Development**:
   ```bash
   USE_CLICKHOUSE=false  # Start with disabled
   docker-compose up    # Starts ClickHouse but doesn't use it
   ```

2. **Test ClickHouse Connection**:
   ```bash
   USE_CLICKHOUSE=true  # Enable dual-write
   # Monitor logs for any ClickHouse connection errors
   ```

3. **Migrate Historical Data** (Once ClickHouse is stable):
   ```bash
   python -m oss.databases.clickhouse.migrations.migrate_postgres_to_clickhouse
   ```

4. **Validate Data** (Before switching reads):
   - Compare row counts: PostgreSQL vs ClickHouse
   - Spot-check span data integrity
   - Verify JSON attributes are properly stored

### Phase 3: Switch to ClickHouse for Reads (Future)

Once confident in ClickHouse data:

1. Update `DualWriteTracingDAO` to read from ClickHouse for analytical queries
2. Keep PostgreSQL as fallback for transactional operations
3. Eventually, consider PostgreSQL-only for transactional data (users, projects)

## API Reference

### ClickHouse Engine

```python
from oss.src.dbs.clickhouse.shared.engine import engine

# Execute queries
result = await engine.execute(
    "SELECT * FROM spans WHERE project_id = %s",
    ["project-uuid"]
)

# Insert data (batch)
await engine.execute_insert(
    "spans",
    [{"project_id": "...", "trace_id": "...", ...}]
)

# Delete operations
await engine.execute_delete(
    "ALTER TABLE spans UPDATE deleted_at = now() WHERE ..."
)
```

### Tracing DAO

```python
from oss.src.dbs.clickhouse.tracing.dao import TracingDAO

# Initialize tables
await TracingDAO.init_tables()

# Create spans
await TracingDAO.create_spans([span1, span2, ...])

# Query spans
spans = await TracingDAO.search_spans(
    project_id="project-uuid",
    filters={"span_type": "QUERY"},
    limit=100
)

# Get trace
spans = await TracingDAO.get_spans_by_trace_id(
    project_id="project-uuid",
    trace_id="trace-uuid"
)
```

## Monitoring and Troubleshooting

### Logs

Check for ClickHouse-related logs:

```bash
# In API service logs
grep -i clickhouse logs.txt

# Common warnings (non-fatal):
# - "Failed to load ClickHouse DAO: Connection refused"
# - "ClickHouse write operation failed: timeout"
```

### ClickHouse Status

Check ClickHouse health:

```bash
# Via Docker
docker exec agenta-clickhouse clickhouse-client -q "SELECT 1"

# Via HTTP
curl http://localhost:8123/ping
```

### Database Comparison

Compare PostgreSQL and ClickHouse row counts:

```bash
# PostgreSQL
psql -d agenta_oss_tracing -c "SELECT COUNT(*) FROM spans;"

# ClickHouse
clickhouse-client -d agenta_oss_tracing -q "SELECT COUNT(*) FROM spans;"
```

## Performance Considerations

### ClickHouse Advantages

- **Columnar compression**: 10-100x better compression for analytics
- **Aggregation speed**: 100x+ faster for GROUP BY queries
- **Storage efficiency**: Lower disk usage for time-series data
- **Batch processing**: Optimized for large batch inserts

### PostgreSQL Still Best For

- **ACID transactions**: Guarantees for critical data
- **Complex updates**: Business logic requiring transaction semantics
- **Referential integrity**: Foreign key constraints
- **User/project data**: Transactional operations

## Future Improvements

### Planned Enhancements

1. **Async ClickHouse Writes**: Use message queue for fire-and-forget writes
2. **Selective Migration**: Choose which projects use ClickHouse
3. **Read-From-ClickHouse**: For analytical queries only (filtered by date range)
4. **Materialized Views**: Aggregate data in ClickHouse for faster dashboard queries
5. **TTL Policies**: Automatic data retention/pruning in ClickHouse

### Schema Evolution

When modifying span schema:

1. Update PostgreSQL migration
2. Update ClickHouse DDL in `dbes.py`
3. Update DAO serialization/deserialization
4. Create data migration if needed

## Troubleshooting Guide

### Issue: ClickHouse connection refused

```
ERROR: Failed to load ClickHouse DAO: [Errno 111] Connection refused
```

**Solution**:
- Check if ClickHouse service is running: `docker ps | grep clickhouse`
- Verify port 9000 is accessible: `telnet localhost 9000`
- Check ClickHouse logs: `docker logs agenta-clickhouse`
- Ensure `CLICKHOUSE_HOST` and `CLICKHOUSE_PORT` are correct

### Issue: Data not appearing in ClickHouse

**Solution**:
- Verify `USE_CLICKHOUSE=true` is set
- Check ClickHouse database and tables exist
- Look for write errors in logs (grep "ClickHouse write")
- Manually verify: `clickhouse-client -q "SELECT COUNT(*) FROM agenta_oss_tracing.spans"`

### Issue: Migration script failing

```
python -m oss.databases.clickhouse.migrations.migrate_postgres_to_clickhouse
```

**Solution**:
- Check PostgreSQL and ClickHouse are both running
- Verify credentials are correct
- Check table schemas match (DDL in `dbes.py`)
- Run with verbose logging to see detailed errors

## References

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [Agenta API Documentation](./docs/api.md)
- [Database Architecture](./docs/architecture.md)

## Support

For issues or questions about ClickHouse integration:

1. Check troubleshooting guide above
2. Review logs for error messages
3. Open an issue on GitHub with:
   - Error message and stack trace
   - Environment configuration
   - Steps to reproduce
   - ClickHouse version: `clickhouse-client --version`
