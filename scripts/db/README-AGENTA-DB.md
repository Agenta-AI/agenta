# Agenta Database Query Tools

Simple scripts to query your Agenta production database without SSH/Docker complexity.

## 📦 Files

- **`agenta-db-query.sh`** - Main query script
- **`agenta-quick-queries.sh`** - Interactive menu with common queries
- **`agenta-sql-snippets.md`** - SQL query reference library

---

## 🚀 Quick Start

### Run a simple query
```bash
cd /Users/edgar/workspace/agenta/scripts/db

# Count applications
./agenta-db-query.sh core "SELECT COUNT(*) FROM app_db;"

# Recent traces
./agenta-db-query.sh tracing "SELECT tree_id, created_at FROM nodes ORDER BY created_at DESC LIMIT 5;"
```

### Interactive menu
```bash
./agenta-quick-queries.sh
```

---

## 📖 Usage

### agenta-db-query.sh

**Syntax:**
```bash
./agenta-db-query.sh <database> "<sql-query>"
```

**Databases:**
- `core` - Application data (apps, users, projects)
- `tracing` - Observability data (traces, spans, nodes)
- `supertokens` - Authentication data

**Examples:**

```bash
# List all applications
./agenta-db-query.sh core "SELECT app_name FROM app_db;"

# Count traces
./agenta-db-query.sh tracing "SELECT COUNT(*) FROM nodes;"

# List all tables
./agenta-db-query.sh core "\dt"

# Describe a table
./agenta-db-query.sh tracing "\d nodes"

# Pipe from file
cat my-query.sql | ./agenta-db-query.sh core
```

---

## 📝 Common Queries

### Applications

```bash
# List all apps
./agenta-db-query.sh core "SELECT id, app_name, created_at FROM app_db ORDER BY created_at DESC;"

# Find specific app
./agenta-db-query.sh core "SELECT * FROM app_db WHERE app_name = 'contract-review-indemnities-lol';"
```

### Users

```bash
# List all users
./agenta-db-query.sh core "SELECT id, email, username, created_at FROM users ORDER BY created_at DESC;"

# Count users
./agenta-db-query.sh core "SELECT COUNT(*) FROM users;"
```

### Traces

```bash
# Recent traces
./agenta-db-query.sh tracing "
SELECT
    tree_id,
    node_name,
    created_at,
    refs->>'application.slug' as app
FROM nodes
ORDER BY created_at DESC
LIMIT 10;"

# Traces for specific app
./agenta-db-query.sh tracing "
SELECT tree_id, node_name, created_at
FROM nodes
WHERE refs->>'application.slug' = 'contract-review-indemnities-lol'
ORDER BY created_at DESC
LIMIT 20;"

# Count traces by app
./agenta-db-query.sh tracing "
SELECT
    refs->>'application.slug' as app,
    COUNT(DISTINCT tree_id) as traces
FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
GROUP BY refs->>'application.slug'
ORDER BY traces DESC;"

# Traces in last 24 hours
./agenta-db-query.sh tracing "
SELECT COUNT(DISTINCT tree_id) as traces_24h
FROM nodes
WHERE created_at > NOW() - INTERVAL '24 hours';"
```

### Database Info

```bash
# List all tables (core)
./agenta-db-query.sh core "\dt"

# List all tables (tracing)
./agenta-db-query.sh tracing "\dt"

# Database sizes
./agenta-db-query.sh core "
SELECT
    datname,
    pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datname LIKE 'agenta_%';"

# Table sizes
./agenta-db-query.sh tracing "
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;"
```

---

## 🔍 Finding Specific Traces

### By trace_id

```bash
# Find trace by ID (from your script output)
./agenta-db-query.sh tracing "
SELECT * FROM nodes
WHERE tree_id = '474ac7db-ffc1-c100-0afb-b8739b1b52a6'::uuid;"
```

### By application

```bash
./agenta-db-query.sh tracing "
SELECT
    tree_id,
    node_name,
    created_at,
    refs->>'environment.slug' as env
FROM nodes
WHERE refs->>'application.slug' = 'contract-review-indemnities-lol'
ORDER BY created_at DESC
LIMIT 20;"
```

### By time range

```bash
./agenta-db-query.sh tracing "
SELECT tree_id, node_name, created_at
FROM nodes
WHERE created_at BETWEEN '2025-10-25 10:00:00' AND '2025-10-25 11:00:00'
ORDER BY created_at DESC;"
```

---

## 📊 Analytics Queries

### Trace activity by day
```bash
./agenta-db-query.sh tracing "
SELECT
    DATE(created_at) as date,
    COUNT(DISTINCT tree_id) as traces,
    COUNT(*) as nodes
FROM nodes
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;"
```

### Most active applications
```bash
./agenta-db-query.sh tracing "
SELECT
    refs->>'application.slug' as app,
    COUNT(DISTINCT tree_id) as traces,
    MAX(created_at) as last_trace
FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
GROUP BY refs->>'application.slug'
ORDER BY traces DESC;"
```

---

## 💡 Tips

### Use LIMIT

Always add `LIMIT` when exploring to avoid overwhelming output:
```bash
./agenta-db-query.sh core "SELECT * FROM app_db LIMIT 10;"
```

### Multiline queries

For complex queries, use heredoc or escape newlines:

```bash
./agenta-db-query.sh tracing "
SELECT
    tree_id,
    node_name,
    created_at
FROM nodes
WHERE refs->>'application.slug' = 'contract-review-indemnities-lol'
ORDER BY created_at DESC
LIMIT 10;
"
```

Or save to a file:

```bash
cat > query.sql << 'EOF'
SELECT
    tree_id,
    node_name,
    created_at
FROM nodes
WHERE refs->>'application.slug' = 'contract-review-indemnities-lol'
ORDER BY created_at DESC
LIMIT 10;
EOF

cat query.sql | ./agenta-db-query.sh tracing
```

### JSON fields

Query JSONB fields using `->` and `->>`:

```bash
# Get specific JSON field as text
./agenta-db-query.sh tracing "SELECT refs->>'application.slug' FROM nodes LIMIT 5;"

# Query JSON field
./agenta-db-query.sh tracing "
SELECT * FROM nodes
WHERE refs->>'application.slug' = 'my-app';"
```

---

## 🛡️ Safety

### READ-ONLY by default

All queries in the snippets are read-only. Be careful with:
- `DELETE`
- `UPDATE`
- `DROP`
- `TRUNCATE`

### Test first

Always `SELECT` before `DELETE`:

```bash
# WRONG - Don't do this directly
./agenta-db-query.sh tracing "DELETE FROM nodes WHERE created_at < NOW() - INTERVAL '30 days';"

# RIGHT - Check first
./agenta-db-query.sh tracing "SELECT COUNT(*) FROM nodes WHERE created_at < NOW() - INTERVAL '30 days';"
# Review the count, then delete if needed
```

### Use transactions

For destructive operations, use transactions:

```bash
./agenta-db-query.sh core "
BEGIN;
DELETE FROM some_table WHERE condition;
-- Review results
ROLLBACK;  -- or COMMIT if you're sure
"
```

---

## 📚 More Examples

See `agenta-sql-snippets.md` for a comprehensive library of SQL queries organized by category:
- Database Overview
- Users & Projects
- Applications & Variants
- Traces & Observability
- Analytics & Stats
- Authentication
- Maintenance

---

## 🔧 Troubleshooting

### Connection refused
Make sure you can SSH to the production server:
```bash
ssh root@91.98.229.196 "echo 'Connected'"
```

### Invalid database error
Double-check the database name. Valid options:
- `core`
- `tracing`
- `supertokens`

### Syntax error in query
Test your query syntax:
```bash
# Use \d commands to explore
./agenta-db-query.sh core "\dt"  # List tables
./agenta-db-query.sh core "\d app_db"  # Describe table
```

---

## 🎯 Your Project ID

For reference, your project ID is:
```
019a0cc4-f1a3-7493-8d10-88d0f067bb47
```

Use it in queries that filter by project:
```bash
./agenta-db-query.sh tracing "
SELECT * FROM nodes
WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47'
LIMIT 10;"
```

---

## 📞 Support

For more SQL examples, see:
- `agenta-sql-snippets.md` - Comprehensive query library
- PostgreSQL documentation: https://www.postgresql.org/docs/

Happy querying! 🚀
