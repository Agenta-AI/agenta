# Tags Feature - Starter Guide (Workflows Only)

## Goal
Implement tags feature starting with **workflows only**, then expand to other entities once validated.

## Why Start with Workflows?
- Workflows are a core git-based entity with clear hierarchy (artifacts → variants → revisions)
- 3 tables with tags column = good test case for trigger pattern
- Same pattern will apply to testsets, queries, and evaluations
- Easier to validate before scaling to 15 tables total

## Quick Reference: Workflows in /claude/api

```
Entity Kind: 'workflow'
Tables:
  - workflow_artifacts (3 columns: project_id, id, slug, ..., tags)
  - workflow_variants  (inherits VariantDBA with tags)
  - workflow_revisions (inherits RevisionDBA with tags)

All three tables:
  - Have tags: JSONB column (already present, inherited from TagsDBA)
  - Have project_id: UUID (scoping)
  - Location: /claude/api/oss/src/dbs/postgres/workflows/dbes.py
```

## Implementation Steps (Workflows Only)

### Step 1: Create tags table migration
**File**: `/claude/api/oss/databases/postgres/migrations/core/versions/`
**Name**: `0001_add_tags_table.py` (or use timestamp format)

**What to do**:
- Create `tags` table with columns:
  - `project_id` (UUID, NOT NULL)
  - `kind` (STRING, NOT NULL)
  - `key` (STRING, NOT NULL)
- Primary Key: (project_id, kind, key)
- Foreign Key: project_id → projects.id (cascade)
- Index: (project_id, kind) for autocomplete

**Dependencies**: None (standalone)

---

### Step 2: Create trigger function + attach workflow triggers
**File**: Same directory, separate migration file
**Name**: `0002_add_tags_trigger_and_workflow_triggers.py`

**What to do**:
- Create PostgreSQL function `sync_tags_from_entity()` that:
  - Accepts entity kind as parameter (TG_ARGV[0])
  - On INSERT/UPDATE: extracts keys from `NEW.tags` JSONB
  - For each key: INSERT into tags table with `ON CONFLICT DO NOTHING`
- Attach triggers to 3 workflow tables:
  - `workflow_artifacts` → trigger with kind='workflow'
  - `workflow_variants` → trigger with kind='workflow'
  - `workflow_revisions` → trigger with kind='workflow'

**Dependencies**: Step 1 (tags table must exist)

---

### Step 3: Backfill tags table from existing workflows
**File**: Same directory
**Name**: `0003_backfill_tags_from_workflows.py`

**What to do**:
- Run 3 INSERT...SELECT statements:
  1. `INSERT INTO tags SELECT DISTINCT project_id, 'workflow', key FROM workflow_artifacts CROSS JOIN LATERAL jsonb_object_keys(tags) WHERE tags IS NOT NULL ON CONFLICT DO NOTHING`
  2. Same for `workflow_variants`
  3. Same for `workflow_revisions`

**Dependencies**: Steps 1 & 2 (table and triggers ready)

---

### Step 4: Add tags API endpoints
**Location**: `/claude/api/oss/src/apis/fastapi/tags/`
**Files to create**:
- `__init__.py`
- `models.py` (DTOs)
- `router.py` (endpoints)

**Endpoints**:
- `GET /projects/{project_id}/tags?kind=workflow` → list tag keys for workflows

**DTO**:
```python
class TagKeyResponse(BaseModel):
    key: str
```

**Dependencies**: None (API is independent)

---

### Step 5: Add tag utilities
**Location**: `/claude/api/oss/src/core/tags/utils.py`

**Functions**:
```python
def flatten(d: dict, prefix: str = "") -> dict:
    """Convert nested dict to flat dict with dot-notation keys"""
    out = {}
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, full))
        else:
            out[full] = v
    return out

def unflatten(flat: dict) -> dict:
    """Convert flat dict with dot-notation keys to nested dict"""
    out = {}
    for key, val in flat.items():
        parts = key.split('.')
        d = out
        for part in parts[:-1]:
            if part not in d:
                d[part] = {}
            d = d[part]
        d[parts[-1]] = val
    return out
```

**Dependencies**: None (utility module)

---

## Testing the Workflow Implementation

### 1. Create a workflow with tags
```bash
POST /projects/{id}/workflows
Body:
{
  "slug": "test-workflow",
  "tags": {
    "env": "prod",
    "owner.name": "Juan"
  }
}
```

### 2. Verify tags table is populated
```sql
SELECT * FROM tags
WHERE project_id = <project_id> AND kind = 'workflow';
```

Expected:
```
project_id | kind     | key
-----------|----------|----------
<id>       | workflow | env
<id>       | workflow | owner.name
```

### 3. Verify API endpoint works
```bash
GET /projects/{id}/tags?kind=workflow
```

Expected response:
```json
[
  {"key": "env"},
  {"key": "owner.name"}
]
```

### 4. Verify manual edits are preserved
```sql
-- Delete a key from tags table
DELETE FROM tags WHERE project_id = <id> AND kind = 'workflow' AND key = 'env';

-- Update the workflow (triggers fire)
PATCH /projects/{id}/workflows/{workflow_id}
Body:
{
  "tags": {
    "env": "staging",
    "owner.name": "Juan"
  }
}

-- Verify 'env' key is restored in tags table
SELECT * FROM tags WHERE project_id = <id> AND kind = 'workflow' AND key = 'env';
```

Expected: Row is recreated (trigger re-inserted it)

---

## Expanding to Other Entities

Once workflows are validated, follow the same pattern for:

1. **Testsets** (3 tables: testset_artifacts, testset_variants, testset_revisions)
   - Kind: 'testset'
   - Same as workflows, just different table names

2. **Queries** (3 tables: query_artifacts, query_variants, query_revisions)
   - Kind: 'query'
   - Same pattern

3. **Evaluations** (5 single tables: evaluation_runs, evaluation_scenarios, evaluation_results, evaluation_metrics, evaluation_queues)
   - Kinds: 'evaluation_run', 'evaluation_scenario', 'evaluation_result', 'evaluation_metrics', 'evaluation_queue'
   - Each table gets its own trigger with appropriate kind

4. **Blobs** (1 table: blobs)
   - Kind: 'blob'
   - Simplest case (single table)

**Batching strategy**:
- One migration file per "logical group" (e.g., "attach_evaluation_triggers", "attach_testset_triggers")
- Or: one migration file with all remaining triggers
- Backfill migration can include all entities

---

## File Structure After Workflows Complete

```
/claude/api/oss/
├── databases/postgres/migrations/core/versions/
│   ├── 0001_add_tags_table.py
│   ├── 0002_add_tags_trigger_and_workflow_triggers.py
│   ├── 0003_backfill_tags_from_workflows.py
│   └── (later: 0004_attach_remaining_triggers.py)
│   └── (later: 0005_backfill_remaining_entities.py)
└── src/
    ├── apis/fastapi/
    │   └── tags/
    │       ├── __init__.py
    │       ├── models.py
    │       └── router.py
    └── core/
        └── tags/
            ├── __init__.py
            └── utils.py
```

---

## Migration File Template

Use this template for consistency:

```python
"""<description>

Revision ID: <auto-generated>
Revises: <previous-revision>
Create Date: <current-date>

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "<auto>"
down_revision: Union[str, None] = "<previous>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add your SQL changes here
    op.create_table(...)
    op.execute("CREATE FUNCTION ...")
    op.execute("CREATE TRIGGER ...")


def downgrade() -> None:
    # Reverse operations in opposite order
    op.execute("DROP TRIGGER IF EXISTS ...")
    op.execute("DROP FUNCTION IF EXISTS ...")
    op.drop_table(...)
```

---

## Next: Scale Up

Once workflows are working:
1. Add testsets triggers
2. Add queries triggers
3. Add evaluations triggers
4. Add blobs trigger
5. Backfill all remaining entities

Same process repeated 4 times (or batched into 1-2 larger migrations).

