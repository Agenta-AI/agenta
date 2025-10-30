# Agenta Database SQL Snippets

Common SQL queries for exploring the Agenta database.

## Usage

```bash
# Run a snippet directly
./agenta-db-query.sh core "SELECT * FROM app_db LIMIT 5;"

# Or copy-paste into the script
cat << 'EOF' | ./agenta-db-query.sh core
SELECT app_name, created_at
FROM app_db
ORDER BY created_at DESC
LIMIT 10;
EOF
```

---

## 📊 Database Overview

### List all tables in CORE database
```sql
\dt
```

### List all tables in TRACING database
```sql
\dt
```

### Get table structure
```sql
\d table_name
```

### Database sizes
```sql
SELECT
    pg_database.datname,
    pg_size_pretty(pg_database_size(pg_database.datname)) AS size
FROM pg_database
WHERE datname LIKE 'agenta_%';
```

---

## 👤 Users & Projects

### List all users
```sql
SELECT
    id,
    email,
    username,
    created_at
FROM users
ORDER BY created_at DESC;
```

### List all projects
```sql
SELECT
    id,
    project_name,
    created_at,
    updated_at
FROM projects
ORDER BY created_at DESC;
```

### Count users
```sql
SELECT COUNT(*) as total_users FROM users;
```

---

## 🎯 Applications & Variants

### List all applications
```sql
SELECT
    id,
    app_name,
    created_at,
    updated_at
FROM app_db
ORDER BY created_at DESC;
```

### Applications with user info
```sql
SELECT
    a.id,
    a.app_name,
    u.username,
    a.created_at
FROM app_db a
LEFT JOIN users u ON a.modified_by_id = u.id
ORDER BY a.created_at DESC;
```

### Count apps by user
```sql
SELECT
    u.username,
    COUNT(a.id) as app_count
FROM users u
LEFT JOIN app_db a ON u.id = a.modified_by_id
GROUP BY u.username
ORDER BY app_count DESC;
```

### List variants for an application
```sql
SELECT
    config_name as variant_name,
    parameters,
    created_at,
    updated_at
FROM app_variants
WHERE app_id = (SELECT id FROM app_db WHERE app_name = 'contract-review-indemnities-lol')
ORDER BY created_at DESC;
```

---

## 🔍 Traces & Observability

### Count traces by application
```sql
SELECT
    refs->>'application.slug' as application,
    COUNT(DISTINCT tree_id) as trace_count,
    MAX(created_at) as last_trace
FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
GROUP BY refs->>'application.slug'
ORDER BY trace_count DESC;
```

### Recent traces for an application
```sql
SELECT
    tree_id,
    node_name,
    tree_type,
    node_type,
    created_at,
    refs->>'application.slug' as app,
    refs->>'environment.slug' as env
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND refs->>'application.slug' = 'contract-review-indemnities-lol'
ORDER BY created_at DESC
LIMIT 20;
```

### Trace details by tree_id
```sql
SELECT
    node_id,
    node_name,
    node_type,
    time_start,
    time_end,
    (EXTRACT(EPOCH FROM time_end) - EXTRACT(EPOCH FROM time_start)) * 1000 as duration_ms,
    status,
    refs
FROM nodes
WHERE tree_id = '474ac7db-ffc1-c100-0afb-b8739b1b52a6'::uuid
ORDER BY time_start;
```

### Count traces by environment
```sql
SELECT
    refs->>'environment.slug' as environment,
    COUNT(DISTINCT tree_id) as trace_count
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND refs->>'application.slug' = 'contract-review-indemnities-lol'
GROUP BY refs->>'environment.slug';
```

### Traces in last 24 hours
```sql
SELECT
    tree_id,
    node_name,
    created_at,
    refs->>'application.slug' as app,
    refs->>'environment.slug' as env
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

---

## 📈 Analytics & Stats

### Total nodes and traces
```sql
SELECT
    COUNT(*) as total_nodes,
    COUNT(DISTINCT tree_id) as total_traces
FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47';
```

### Trace activity by day
```sql
SELECT
    DATE(created_at) as date,
    COUNT(DISTINCT tree_id) as trace_count,
    COUNT(*) as node_count
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Most active applications
```sql
SELECT
    refs->>'application.slug' as application,
    COUNT(DISTINCT tree_id) as traces,
    COUNT(*) as nodes,
    MIN(created_at) as first_trace,
    MAX(created_at) as last_trace
FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
GROUP BY refs->>'application.slug'
ORDER BY traces DESC;
```

### Average trace duration
```sql
SELECT
    refs->>'application.slug' as application,
    AVG(EXTRACT(EPOCH FROM time_end) - EXTRACT(EPOCH FROM time_start)) * 1000 as avg_duration_ms,
    MIN(EXTRACT(EPOCH FROM time_end) - EXTRACT(EPOCH FROM time_start)) * 1000 as min_duration_ms,
    MAX(EXTRACT(EPOCH FROM time_end) - EXTRACT(EPOCH FROM time_start)) * 1000 as max_duration_ms
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND parent_id IS NULL  -- Only root nodes
GROUP BY refs->>'application.slug';
```

---

## 🔐 Authentication (SuperTokens)

### List all authenticated users
```sql
SELECT
    user_id,
    email,
    time_joined,
    password_hash IS NOT NULL as has_password
FROM emailpassword_users
ORDER BY time_joined DESC;
```

### User sessions
```sql
SELECT
    user_id,
    session_handle,
    time_created,
    expiry_time
FROM session_info
WHERE expiry_time > NOW()
ORDER BY time_created DESC;
```

---

## 🧹 Maintenance Queries

### Clean up old traces (BE CAREFUL!)
```sql
-- First check what would be deleted
SELECT COUNT(*)
FROM nodes
WHERE created_at < NOW() - INTERVAL '30 days';

-- Then delete (uncomment to run)
-- DELETE FROM nodes WHERE created_at < NOW() - INTERVAL '30 days';
```

### Vacuum database (reclaim space)
```sql
VACUUM ANALYZE nodes;
```

### Database table sizes
```sql
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 🎨 Custom Queries

### Find traces with specific variant
```sql
SELECT
    tree_id,
    node_name,
    created_at,
    refs->>'variant.slug' as variant
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND refs->>'variant.slug' = 'grok-4-fast'
ORDER BY created_at DESC
LIMIT 20;
```

### Search traces by content
```sql
SELECT
    tree_id,
    node_name,
    content,
    created_at
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND content ILIKE '%indemnity%'
ORDER BY created_at DESC
LIMIT 10;
```

### Check trace with exception
```sql
SELECT
    tree_id,
    node_name,
    exception,
    created_at
FROM nodes
WHERE
    project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
    AND exception IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

---

## 💡 Tips

1. **Always add LIMIT** to queries when exploring to avoid overwhelming results
2. **Use transactions** for any UPDATE/DELETE operations:
   ```sql
   BEGIN;
   -- your query
   -- Check results
   ROLLBACK; -- or COMMIT;
   ```
3. **Check execution plan** for slow queries:
   ```sql
   EXPLAIN ANALYZE <your-query>;
   ```
4. **Be careful with DELETE** - always SELECT first to verify what you're deleting

---

## 🚀 Quick Reference

```bash
# Basic usage
./agenta-db-query.sh core "SELECT COUNT(*) FROM app_db;"

# List tables
./agenta-db-query.sh core "\dt"

# Pipe from file
cat my-query.sql | ./agenta-db-query.sh tracing

# Recent traces
./agenta-db-query.sh tracing "SELECT tree_id, node_name, created_at FROM nodes ORDER BY created_at DESC LIMIT 10;"
```
