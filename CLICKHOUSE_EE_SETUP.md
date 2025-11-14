# ClickHouse Setup for Enterprise Edition (EE)

## Quick Start

### 1. Add Environment Variables

Add the following lines to your `.env.ee.dev.local` file:

```bash
# ClickHouse Configuration (Optional - disabled by default)
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=9000
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=agenta_ee_tracing
USE_CLICKHOUSE=false
```

### 2. Start Services

Run your existing command:

```bash
./hosting/docker-compose/run.sh --build --no-cache --license ee --dev --env-file .env.ee.dev.local
```

That's it! The ClickHouse service will now start alongside your other services.

## Testing ClickHouse Integration

### Phase 1: Verify ClickHouse is Running (No writes yet)

With `USE_CLICKHOUSE=false` (default), ClickHouse starts but doesn't receive any data yet:

```bash
# Check if ClickHouse is healthy
docker ps | grep clickhouse

# Check ClickHouse logs
docker logs agenta-ee-dev-clickhouse-1

# Test ClickHouse HTTP interface
curl http://localhost:8123/ping
# Should return "Ok."
```

### Phase 2: Enable Dual-Write Mode

Once ClickHouse is running stable, enable dual-write mode to start sending spans to both PostgreSQL and ClickHouse:

1. **Update `.env.ee.dev.local`:**
   ```bash
   USE_CLICKHOUSE=true
   ```

2. **Restart services:**
   ```bash
   ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.local
   ```

3. **Verify data is being written:**
   ```bash
   # Connect to ClickHouse
   docker exec -it agenta-ee-dev-clickhouse-1 clickhouse-client

   # Check if tables were created
   SHOW TABLES;

   # Count spans
   SELECT count() FROM spans;

   # View recent spans
   SELECT project_id, trace_id, span_name, created_at
   FROM spans
   ORDER BY created_at DESC
   LIMIT 10;
   ```

### Phase 3: Migrate Historical Data (Optional)

If you want to migrate existing spans from PostgreSQL to ClickHouse:

```bash
# From inside the API container
docker exec -it agenta-ee-dev-api-1 bash

# Run migration script
python -m oss.databases.clickhouse.migrations.migrate_postgres_to_clickhouse

# This will:
# - Create ClickHouse tables if they don't exist
# - Migrate spans in batches of 1000
# - Migrate nodes for observability
# - Show progress as it runs
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│            Your Application / SDK                    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼ (trace spans)
         ┌───────────────────────────────────┐
         │  DualWriteTracingDAO              │
         │  (USE_CLICKHOUSE flag)            │
         └───────────────────────────────────┘
            │                           │
            ▼ (always)                  ▼ (if flag=true)
    ┌──────────────────┐       ┌──────────────────┐
    │  PostgreSQL      │       │  ClickHouse      │
    │  (Primary DB)    │       │  (Analytics DB)  │
    │  Port: 5432      │       │  Port: 9000      │
    └──────────────────┘       └──────────────────┘
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CLICKHOUSE_HOST` | `clickhouse` | ClickHouse hostname (Docker service name) |
| `CLICKHOUSE_PORT` | `9000` | Native protocol port (not HTTP 8123) |
| `CLICKHOUSE_USER` | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | `` | ClickHouse password (empty by default) |
| `CLICKHOUSE_DATABASE` | `agenta_ee_tracing` | Database name for traces |
| `USE_CLICKHOUSE` | `false` | Enable/disable ClickHouse writes |

## ClickHouse Ports

- **9000**: Native TCP protocol (used by clickhouse-driver) ✅ Primary
- **8123**: HTTP interface (for REST API, health checks) 🔍 Monitoring

## Rollback Plan

If you encounter issues, you can disable ClickHouse without any downtime:

1. **Set `USE_CLICKHOUSE=false` in `.env.ee.dev.local`**
2. **Restart services** (or just wait - the flag is read at runtime)
3. PostgreSQL continues working as before

## Performance Notes

### When to Enable ClickHouse

✅ **Good for:**
- High span volume (>1M spans/day)
- Complex analytical queries
- Time-series aggregations
- Large-scale observability dashboards

⚠️ **Not necessary for:**
- Low span volume (<100k spans/day)
- Simple queries
- Development environments

### Expected Performance Improvements

With ClickHouse enabled:
- **Aggregation queries**: 10-100x faster
- **Time-range queries**: 5-20x faster
- **Complex filters**: 3-10x faster
- **Storage**: 50-70% less disk space (compression)

## Troubleshooting

### ClickHouse container won't start

```bash
# Check logs
docker logs agenta-ee-dev-clickhouse-1

# Common issue: Port already in use
sudo lsof -i :9000
sudo lsof -i :8123
```

### "clickhouse-driver is not installed" error

```bash
# Rebuild the API container
./hosting/docker-compose/run.sh --build --license ee --dev --env-file .env.ee.dev.local
```

### Tables not created in ClickHouse

Tables are created automatically on first write when `USE_CLICKHOUSE=true`. If they don't appear:

```bash
# Manually create tables
docker exec -it agenta-ee-dev-api-1 python -c "
from oss.src.dbs.clickhouse.tracing.dao import TracingDAO
import asyncio
dao = TracingDAO()
asyncio.run(dao.create_tables())
print('Tables created!')
"
```

### Data mismatch between PostgreSQL and ClickHouse

```bash
# Compare row counts
# PostgreSQL
docker exec -it agenta-ee-dev-postgres-1 psql -U username -d agenta_ee_tracing -c "SELECT COUNT(*) FROM spans;"

# ClickHouse
docker exec -it agenta-ee-dev-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM agenta_ee_tracing.spans;"
```

## Next Steps

1. ✅ Add environment variables to `.env.ee.dev.local`
2. ✅ Start services with your usual command
3. ✅ Verify ClickHouse is healthy
4. ⏳ Enable `USE_CLICKHOUSE=true` when ready
5. ⏳ Monitor for a few days
6. ⏳ Run historical data migration if needed
7. ⏳ Switch analytics queries to use ClickHouse

## Documentation

For more details, see:
- **Main Migration Guide**: `CLICKHOUSE_MIGRATION.md`
- **ClickHouse Official Docs**: https://clickhouse.com/docs
- **Agenta Tracing Docs**: (your internal docs)

## Support

If you encounter issues:
1. Check `docker logs agenta-ee-dev-clickhouse-1`
2. Check `docker logs agenta-ee-dev-api-1`
3. Verify environment variables are set correctly
4. Try disabling with `USE_CLICKHOUSE=false` first
