# Plan-based retention (Postgres) — schema migrations + retention job

This document captures the **exact schema changes** (indexes + constraints + autovacuum reloptions) and a **Python/SQLAlchemy implementation** for plan-based retention with:

- **Two databases**
  - **Core DB**: `projects`, `subscriptions` (and org/workspace tables, etc.)
  - **Tracing DB**: `spans` (no cross-DB foreign keys)
- **Option A per plan** (but split across DBs due to the cross-DB boundary):
  1) In **Core DB**, resolve **eligible projects** for a given `plan` (paged in chunks).
  2) In **Tracing DB**, delete **expired traces** (trace-scoped) for that chunk using a **constant cutoff** and a **max traces per chunk** limit.
- **No temp tables**
- **Do not use**:
  - `spans.deleted_at`
  - `subscriptions.active`

---

## Current schema snapshots (as provided)

### `public.spans` (Tracing DB)
- Primary key: `PRIMARY KEY (project_id, trace_id, span_id)`
- Relevant columns:
  - `project_id uuid NOT NULL`
  - `trace_id uuid NOT NULL`
  - `span_id uuid NOT NULL`
  - `parent_id uuid NULL` (root span when NULL)
  - `created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Existing indexes (subset):
  - `ix_project_id_trace_id (project_id, trace_id)`
  - various GIN indexes for jsonb columns
- Missing for retention:
  - **partial root-span index** for `(project_id, created_at, trace_id) WHERE parent_id IS NULL`
  - (recommended) **unique partial root per trace**: `(project_id, trace_id) WHERE parent_id IS NULL`

### `public.projects` (Core DB)
- PK: `PRIMARY KEY (id)`
- Has `organization_id uuid NULL` with an FK to `organizations(id)`
- Only index currently shown: `projects_pkey (id)`
- Missing for retention:
  - index on `organization_id` to support `subscriptions -> projects` joins

### `public.subscriptions` (Core DB)
- PK: `PRIMARY KEY (organization_id)`
- Columns:
  - `plan varchar NOT NULL`
  - `organization_id uuid NOT NULL`
  - `active boolean NOT NULL` (ignored for retention)
- Only index currently shown: `subscriptions_pkey (organization_id)`
- Missing for retention:
  - index on `plan` for “all orgs on plan X” lookup

---

## Retention algorithm (current flow)

We run this periodically (e.g., every **15–60 minutes**).

For each **plan** with a finite retention window:

1) **Core DB**: page through eligible projects in deterministic chunks (`max_projects_per_batch`).
2) For each project chunk:
   - **Tracing DB**: delete up to `max_traces_per_batch` expired traces.
   - This is **one delete per chunk** (no inner drain loop).

**Parameters (4)**
- `plan: str` — subscription plan value (enum serialized to text).
- `cutoff: datetime` — constant cutoff timestamp (e.g., `now() - retention_minutes`).
- `max_projects_per_batch: int` — number of project IDs to fetch per page from Core DB.
- `max_traces_per_batch: int` — max number of **traces** deleted per project chunk.

**Plan retention source**
- Retention minutes are defined per plan in entitlements as `Quota.retention` on `Counter.TRACES`.
- Plans without a retention value are skipped.

---

## Schema migrations (DDL)

Because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, Alembic migrations must use **autocommit** for those statements.

### A. Core DB migrations

#### A.1 `projects`: add index on `organization_id`

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_projects_organization_id
ON public.projects (organization_id);
```

#### A.2 `subscriptions`: add index on `plan` (do not include `active`)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_subscriptions_plan
ON public.subscriptions (plan);
```

*(Nothing else is required for retention in Core DB.)*

---

### B. Tracing DB migrations

#### B.1 `spans`: enforce a single root span per `(project_id, trace_id)` (recommended)

This is a **unique partial index**, not a table constraint, and is compatible with your composite PK.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_spans_root_per_trace
ON public.spans (project_id, trace_id)
WHERE parent_id IS NULL;
```

> This does not affect deletion correctness (you’ll still delete by `(project_id, trace_id)`), but it makes traces deterministic and prevents malformed input.

#### B.2 `spans`: index for retention selection (critical)

This is the index that allows Postgres to find expired root spans using an index range scan.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_spans_root_project_created_trace
ON public.spans (project_id, created_at, trace_id)
WHERE parent_id IS NULL;
```

#### B.3 `spans`: autovacuum reloptions (steady-state retention)

Tune autovacuum at the table level. These defaults are a reasonable starting point for “append + periodic deletes” tables; adjust after observing `pg_stat_all_tables.n_dead_tup` and vacuum timing.

```sql
ALTER TABLE public.spans SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 5,
  autovacuum_vacuum_cost_limit = 4000
);
```

Notes:
- Scale factors control *when* autovacuum triggers (lower triggers sooner).
- Cost settings control vacuum aggressiveness. If vacuum lags, increase `cost_limit` or reduce `cost_delay`.
- You can tune other options later (`autovacuum_vacuum_threshold`, `freeze_max_age`, etc.) but start minimal.

---

## Alembic migration templates (current implementation)

Because Core DB and Tracing DB are separate databases, you typically have **separate Alembic environments** (two `alembic.ini` / env.py) or at least separate branches.

Below are two minimal revisions.

### A. Core DB Alembic revision (indexes)

```python
\"\"\"Add retention helper indexes on projects/subscriptions

Revision ID: <fill>
Revises: <fill>
Create Date: <fill>
\"\"\"

from alembic import op

# revision identifiers, used by Alembic.
revision = "<fill>"
down_revision = "<fill>"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY must run outside a transaction
    with op.get_context().autocommit_block():
        op.execute(text(\"\"\"
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_projects_organization_id
            ON public.projects (organization_id);
        \"\"\"))
        op.execute(text(\"\"\"
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_subscriptions_plan
            ON public.subscriptions (plan);
        \"\"\"))

def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(text(\"DROP INDEX CONCURRENTLY IF EXISTS public.ix_projects_organization_id;\"))
        op.execute(text(\"DROP INDEX CONCURRENTLY IF EXISTS public.ix_subscriptions_plan;\"))
```

> If your Alembic version doesn’t expose `op.text`, use `from sqlalchemy import text` and `conn.execute(text(...))`.

---

### B. Tracing DB Alembic revision (spans indexes + autovacuum)

```python
\"\"\"Add retention helper indexes on spans + autovacuum tuning

Revision ID: <fill>
Revises: <fill>
Create Date: <fill>
\"\"\"

from alembic import op
from sqlalchemy import text

revision = "<fill>"
down_revision = "<fill>"
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(text(\"\"\"
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_spans_root_per_trace
            ON public.spans (project_id, trace_id)
            WHERE parent_id IS NULL;
        \"\"\"))

        op.execute(text(\"\"\"
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_spans_root_project_created_trace
            ON public.spans (project_id, created_at, trace_id)
            WHERE parent_id IS NULL;
        \"\"\"))

        # autovacuum reloptions (can run in a transaction, but safe here)
        op.execute(text(\"\"\"
            ALTER TABLE public.spans SET (
              autovacuum_vacuum_scale_factor = 0.02,
              autovacuum_analyze_scale_factor = 0.01,
              autovacuum_vacuum_cost_delay = 5,
              autovacuum_vacuum_cost_limit = 4000
            );
        \"\"\"))

def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(text(\"DROP INDEX CONCURRENTLY IF EXISTS public.ux_spans_root_per_trace;\"))
        op.execute(text(\"DROP INDEX CONCURRENTLY IF EXISTS public.ix_spans_root_project_created_trace;\"))
        # Reset reloptions (NULL clears table-level overrides)
        op.execute(text(\"ALTER TABLE public.spans RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor, autovacuum_vacuum_cost_delay, autovacuum_vacuum_cost_limit);\"))
```

---

## SQL used by the retention job

### 1) Core DB — page eligible projects for a plan (keyset pagination)

> We page by `projects.id` (uuid). UUID ordering is arbitrary but total and stable, so it works for pagination.

```sql
-- Inputs:
--   :plan          (text)
--   :project_id    (uuid, nullable)
--   :max_projects  (int)

SELECT p.id AS project_id
FROM public.projects p
JOIN public.subscriptions s
  ON s.organization_id = p.organization_id
WHERE s.plan = :plan
  AND (:project_id IS NULL OR p.id > :project_id)
ORDER BY p.id
LIMIT :max_projects;
```

### 2) Tracing DB — delete expired traces for a chunk (single statement)

This statement:
- selects up to `:max_traces` **root spans** in the given projects chunk that are older than `:cutoff`
- deletes **all spans** for those `(project_id, trace_id)` pairs
- returns **two counters**:
  - `traces_selected` (<= `max_traces`)
  - `spans_deleted` (total spans removed)

```sql
-- Inputs:
--   :project_ids   (uuid[])
--   :cutoff        (timestamptz)
--   :max_traces    (int)

WITH expired_traces AS (
  SELECT sp.project_id, sp.trace_id
  FROM public.spans sp
  WHERE sp.parent_id IS NULL
    AND sp.project_id = ANY(:project_ids)
    AND sp.created_at < :cutoff
  ORDER BY sp.created_at
  LIMIT :max_traces
),
deleted AS (
  DELETE FROM public.spans sp
  USING expired_traces et
  WHERE sp.project_id = et.project_id
    AND sp.trace_id   = et.trace_id
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM expired_traces) AS traces_selected,
  (SELECT count(*) FROM deleted)        AS spans_deleted;
```

---

## Implementation (SQLAlchemy, async)

Current implementation lives in:
- `ee/src/dbs/postgres/tracing/dao.py` (raw SQL + SQLAlchemy CTE versions).
- `ee/src/core/tracing/service.py` (plan loop + batch orchestration).

Key points:
- Async SQLAlchemy sessions for Core and Tracing DBs.
- Project pagination uses `project_id` cursor (keyset pagination by `projects.id`).
- One delete statement per project chunk (no inner drain loop).
- SQLAlchemy version uses a CTE to select expired traces and delete spans in one statement.
- Raw SQL version uses the same CTE shape (`expired_traces` → delete).

## Entrypoints

- Admin endpoint: `POST /admin/billing/usage/flush` in `ee/src/apis/fastapi/billing/router.py`.
- Cron: `ee/src/crons/spans.sh` calls the endpoint (30 minute timeout).
- Locking: `acquire_lock`/`release_lock` guard the flush to avoid overlaps.

---

## Operational recommendations (minimal)

- Run per plan in code; you can sequence plans from smallest retention to largest or vice versa.
- Current defaults:
  - `max_projects_per_batch = 500`
  - `max_traces_per_batch = 5000`
- Keep transactions short:
  - commit after each delete statement
- Verify index usage once:
  - `EXPLAIN (ANALYZE, BUFFERS)` on the Tracing DB delete CTE (replace binds with literals)

---

## What this setup guarantees

- Deletes are **trace-scoped** (by `(project_id, trace_id)`), preserving trace integrity.
- Eligibility is **evaluated at deletion time** (projects are resolved dynamically by plan).
- Selection is **index-driven** on root spans via the partial index.
- No reliance on `subscriptions.active` or `spans.deleted_at`.
- No temp tables.
