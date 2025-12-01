# Tags Implementation Plan

## Overview
Implement the tags feature as specified in `/Users/junaway/Agenta/github/sandbox/architecture/tags.initial.specs.md`. This document outlines the work to be done in `/claude/api` only (OSS and EE).

## Key Design Principles (from specs)
1. **Canonical Storage**: Entity `tags` field is a flat JSON object with dot-notation keys (already stored as JSONB)
2. **Shared Registry**: `tags` table stores unique tag keys per `(project_id, kind)` for autocomplete
3. **Incremental Sync**: Triggers on entity INSERT/UPDATE maintain the tags table
4. **Manual Edit Safety**: Uses `ON CONFLICT DO NOTHING` to preserve manual edits to the tags table
5. **No Input Validation**: Assume all tags are already in dot-notation format

## Entity Kinds Mapping

### Tables with tags column (already have TagsDBA mixin):

| Entity Kind | Tables | Location |
|---|---|---|
| `testset` | testset_artifacts, testset_variants, testset_revisions | `/claude/api/oss/src/dbs/postgres/testsets/dbes.py` |
| `workflow` | workflow_artifacts, workflow_variants, workflow_revisions | `/claude/api/oss/src/dbs/postgres/workflows/dbes.py` |
| `query` | query_artifacts, query_variants, query_revisions | `/claude/api/oss/src/dbs/postgres/queries/dbes.py` |
| `evaluation_run` | evaluation_runs | `/claude/api/oss/src/dbs/postgres/evaluations/dbes.py` |
| `evaluation_scenario` | evaluation_scenarios | `/claude/api/oss/src/dbs/postgres/evaluations/dbes.py` |
| `evaluation_result` | evaluation_results | `/claude/api/oss/src/dbs/postgres/evaluations/dbes.py` |
| `evaluation_metrics` | evaluation_metrics | `/claude/api/oss/src/dbs/postgres/evaluations/dbes.py` |
| `evaluation_queue` | evaluation_queues | `/claude/api/oss/src/dbs/postgres/evaluations/dbes.py` |
| `blob` | blobs | `/claude/api/oss/src/dbs/postgres/blobs/dbas.py` |

**Note**: All git-based entities (testset, workflow, query) have THREE tables (artifact, variant, revision), each with tags.

## Implementation Tasks

### Phase 1: Database Schema & Triggers

#### Task 1.1: Create tags table migration (OSS)
**Location**: `/claude/api/oss/databases/postgres/migrations/core/versions/`

```python
# File: <timestamp>_add_tags_table.py

def upgrade():
    op.create_table(
        'tags',
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('project_id', 'kind', 'key'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )

    op.create_index('ix_tags_project_id_kind', 'tags', ['project_id', 'kind'])

def downgrade():
    op.drop_table('tags')
```

#### Task 1.2: Create trigger function migration (OSS)
**Location**: `/claude/api/oss/databases/postgres/migrations/core/versions/`

```python
# File: <timestamp>_add_sync_tags_trigger_function.py

def upgrade():
    # Create the generic trigger function
    op.execute("""
    CREATE OR REPLACE FUNCTION sync_tags_from_entity()
    RETURNS trigger AS $$
    DECLARE
        k text;
        entity_kind text;
    BEGIN
        entity_kind := TG_ARGV[0];

        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            IF NEW.tags IS NOT NULL THEN
                FOR k IN SELECT jsonb_object_keys(NEW.tags)
                LOOP
                    INSERT INTO tags(project_id, kind, key)
                    VALUES (NEW.project_id, entity_kind, k)
                    ON CONFLICT (project_id, kind, key) DO NOTHING;
                END LOOP;
            END IF;
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

def downgrade():
    op.execute("DROP FUNCTION IF EXISTS sync_tags_from_entity()")
```

#### Task 1.3: Attach triggers to entity tables (OSS)
**Location**: `/claude/api/oss/databases/postgres/migrations/core/versions/`

```python
# File: <timestamp>_attach_tags_triggers.py

def upgrade():
    # Testsets
    op.execute("CREATE TRIGGER trg_testset_artifacts_sync_tags AFTER INSERT OR UPDATE ON testset_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset')")
    op.execute("CREATE TRIGGER trg_testset_variants_sync_tags AFTER INSERT OR UPDATE ON testset_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset')")
    op.execute("CREATE TRIGGER trg_testset_revisions_sync_tags AFTER INSERT OR UPDATE ON testset_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset')")

    # Workflows
    op.execute("CREATE TRIGGER trg_workflow_artifacts_sync_tags AFTER INSERT OR UPDATE ON workflow_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow')")
    op.execute("CREATE TRIGGER trg_workflow_variants_sync_tags AFTER INSERT OR UPDATE ON workflow_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow')")
    op.execute("CREATE TRIGGER trg_workflow_revisions_sync_tags AFTER INSERT OR UPDATE ON workflow_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow')")

    # Queries
    op.execute("CREATE TRIGGER trg_query_artifacts_sync_tags AFTER INSERT OR UPDATE ON query_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query')")
    op.execute("CREATE TRIGGER trg_query_variants_sync_tags AFTER INSERT OR UPDATE ON query_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query')")
    op.execute("CREATE TRIGGER trg_query_revisions_sync_tags AFTER INSERT OR UPDATE ON query_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query')")

    # Evaluations (single table per kind)
    op.execute("CREATE TRIGGER trg_evaluation_runs_sync_tags AFTER INSERT OR UPDATE ON evaluation_runs FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_run')")
    op.execute("CREATE TRIGGER trg_evaluation_scenarios_sync_tags AFTER INSERT OR UPDATE ON evaluation_scenarios FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_scenario')")
    op.execute("CREATE TRIGGER trg_evaluation_results_sync_tags AFTER INSERT OR UPDATE ON evaluation_results FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_result')")
    op.execute("CREATE TRIGGER trg_evaluation_metrics_sync_tags AFTER INSERT OR UPDATE ON evaluation_metrics FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_metrics')")
    op.execute("CREATE TRIGGER trg_evaluation_queues_sync_tags AFTER INSERT OR UPDATE ON evaluation_queues FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_queue')")

    # Blobs
    op.execute("CREATE TRIGGER trg_blobs_sync_tags AFTER INSERT OR UPDATE ON blobs FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('blob')")

def downgrade():
    # Drop all triggers
    tables = [
        'testset_artifacts', 'testset_variants', 'testset_revisions',
        'workflow_artifacts', 'workflow_variants', 'workflow_revisions',
        'query_artifacts', 'query_variants', 'query_revisions',
        'evaluation_runs', 'evaluation_scenarios', 'evaluation_results',
        'evaluation_metrics', 'evaluation_queues', 'blobs'
    ]
    for table in tables:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table.replace('_', '_').replace('artifacts', 'artifacts')}_sync_tags ON {table}")
```

#### Task 1.4: Backfill tags table (OSS)
**Location**: `/claude/api/oss/databases/postgres/migrations/core/versions/`

```python
# File: <timestamp>_backfill_tags_from_entities.py

def upgrade():
    # Backfill from all entity tables
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'testset'::text, key
    FROM testset_artifacts
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    # ... repeat for testset_variants, testset_revisions, workflows, queries, evaluations, blobs
```

### Phase 2: API Endpoints

#### Task 2.1: Add tags list endpoint
**Location**: `/claude/api/oss/src/apis/fastapi/tags/` (create new module)

Create router to:
- `GET /projects/{project_id}/tags?kind=testset` → list all keys for that kind

**DTOs** (`models.py`):
```python
class TagKeyResponse(BaseModel):
    key: str
    kind: str
    project_id: str
```

**Router** (`router.py`):
- `get_tag_keys_for_kind(project_id: UUID, kind: str)` → queries tags table

### Phase 3: Utility Functions

#### Task 3.1: Add tag utilities module
**Location**: `/claude/api/oss/src/core/tags/utils.py`

Utilities for:
- `flatten(nested_dict) -> dict`: Convert nested JSON to dot-notation
- `unflatten(flat_dict) -> dict`: Convert dot-notation to nested JSON

Example:
```python
def flatten(d: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, full))
        else:
            out[full] = v
    return out

def unflatten(flat: dict) -> dict:
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

### Phase 4: Integration (Optional for now)

#### Task 4.1: Update entity DTOs (optional)
If API responses need nested format:
- Provide an `unflatten` option when serializing entity tags to API responses
- Accept nested JSON on entity create/update endpoints and flatten before saving

#### Task 4.2: Update entity service layer
- No changes needed if tags are already in dot-notation format
- Only flatten if API accepts nested JSON

## EE Considerations

The EE database inherits from OSS, so:
1. **EE migrations**: May need to apply same trigger/table setup separately if EE has own migration chain
2. **Check structure**: Verify if `/claude/api/ee/databases/postgres/migrations/` exists and needs updates
3. **Reuse trigger function**: Same `sync_tags_from_entity` function can be used in both OSS and EE

## File Structure Summary

```
/claude/api/oss/
├── databases/postgres/migrations/core/versions/
│   ├── <ts>_add_tags_table.py
│   ├── <ts>_add_sync_tags_trigger_function.py
│   ├── <ts>_attach_tags_triggers.py
│   └── <ts>_backfill_tags_from_entities.py
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

## Notes

- **No validation**: Specs assume all tags already in dot-notation format; skip input validation for now
- **Triggers on INSERT/UPDATE only**: No DELETE triggers; orphaned keys remain in tags table (expected behavior)
- **Flat schema**: Tags table stores only keys, not values; values live in entity tables
- **Concurrency**: `ON CONFLICT DO NOTHING` is safe for concurrent inserts
- **Manual edits**: Users can edit/delete rows in tags table; they'll be recreated if entity still uses them

## Testing Strategy

1. **Unit tests**: Test flatten/unflatten utilities
2. **Integration tests**:
   - Verify trigger fires on entity INSERT/UPDATE
   - Verify tags table is populated correctly
   - Verify `ON CONFLICT DO NOTHING` preserves manual edits
   - Verify backfill works
3. **API tests**:
   - Verify GET /projects/{id}/tags returns correct keys per kind
   - Test with different kinds

