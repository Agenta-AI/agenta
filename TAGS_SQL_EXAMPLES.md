# Tags Implementation - SQL Examples

## 1. Create Tags Table

```sql
CREATE TABLE tags (
    project_id UUID NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,

    PRIMARY KEY (project_id, kind, key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX ix_tags_project_id_kind ON tags(project_id, kind);
```

## 2. Trigger Function

```sql
CREATE OR REPLACE FUNCTION sync_tags_from_entity()
RETURNS TRIGGER AS $$
DECLARE
    k TEXT;
    entity_kind TEXT;
BEGIN
    -- Get the entity kind from trigger parameter
    entity_kind := TG_ARGV[0];

    -- Only process INSERT and UPDATE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        -- If entity has tags, extract and sync
        IF NEW.tags IS NOT NULL THEN
            -- Iterate over each key in the JSONB tags object
            FOR k IN SELECT jsonb_object_keys(NEW.tags)
            LOOP
                -- Insert key into tags registry
                -- ON CONFLICT DO NOTHING preserves manual edits
                INSERT INTO tags(project_id, kind, key)
                VALUES (NEW.project_id, entity_kind, k)
                ON CONFLICT (project_id, kind, key) DO NOTHING;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## 3. Attach Triggers to Workflow Tables

```sql
-- Workflow Artifacts
CREATE TRIGGER trg_workflow_artifacts_sync_tags
AFTER INSERT OR UPDATE ON workflow_artifacts
FOR EACH ROW
EXECUTE FUNCTION sync_tags_from_entity('workflow');

-- Workflow Variants
CREATE TRIGGER trg_workflow_variants_sync_tags
AFTER INSERT OR UPDATE ON workflow_variants
FOR EACH ROW
EXECUTE FUNCTION sync_tags_from_entity('workflow');

-- Workflow Revisions
CREATE TRIGGER trg_workflow_revisions_sync_tags
AFTER INSERT OR UPDATE ON workflow_revisions
FOR EACH ROW
EXECUTE FUNCTION sync_tags_from_entity('workflow');
```

## 4. Backfill Tags from Workflows

```sql
-- From workflow_artifacts
INSERT INTO tags(project_id, kind, key)
SELECT DISTINCT project_id, 'workflow'::TEXT, key
FROM workflow_artifacts
CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
WHERE tags IS NOT NULL
ON CONFLICT (project_id, kind, key) DO NOTHING;

-- From workflow_variants
INSERT INTO tags(project_id, kind, key)
SELECT DISTINCT project_id, 'workflow'::TEXT, key
FROM workflow_variants
CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
WHERE tags IS NOT NULL
ON CONFLICT (project_id, kind, key) DO NOTHING;

-- From workflow_revisions
INSERT INTO tags(project_id, kind, key)
FROM workflow_revisions
CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
WHERE tags IS NOT NULL
ON CONFLICT (project_id, kind, key) DO NOTHING;
```

## 5. Test Scenarios

### Scenario 1: Insert entity with tags
```sql
-- This will trigger sync_tags_from_entity for workflow_artifacts
INSERT INTO workflow_artifacts(project_id, id, slug, tags, ...)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'uuid-value',
    'my-workflow',
    '{"env": "prod", "owner.name": "Juan", "metrics.latency.p95": 120}'::JSONB,
    ...
);

-- Verify tags table was populated:
SELECT * FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow';

-- Result should have 3 rows:
-- (project_id, 'workflow', 'env')
-- (project_id, 'workflow', 'owner.name')
-- (project_id, 'workflow', 'metrics.latency.p95')
```

### Scenario 2: Update entity tags
```sql
UPDATE workflow_artifacts
SET tags = '{"env": "staging", "owner.name": "Juan", "team": "ml"}'::JSONB
WHERE project_id = '11111111-1111-1111-1111-111111111111' AND slug = 'my-workflow';

-- Trigger fires again, inserts new key 'team' if not exists
SELECT * FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow'
ORDER BY key;

-- Result should now have 4 keys (including 'team')
```

### Scenario 3: Manual edit + re-add behavior
```sql
-- User manually deletes a tag key
DELETE FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow'
  AND key = 'env';

-- Verify deletion
SELECT * FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow'
  AND key = 'env';
-- Result: empty

-- User updates the entity (trigger fires)
UPDATE workflow_artifacts
SET updated_at = CURRENT_TIMESTAMP,
    tags = '{"env": "prod", "owner.name": "Juan", "team": "ml"}'::JSONB
WHERE project_id = '11111111-1111-1111-1111-111111111111' AND slug = 'my-workflow';

-- Verify key was re-added by trigger
SELECT * FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow'
  AND key = 'env';
-- Result: 1 row (re-created)
```

### Scenario 4: Query tag keys for autocomplete
```sql
-- Get all tag keys for workflows in a project
SELECT DISTINCT key
FROM tags
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'workflow'
ORDER BY key;

-- Result: all tag keys used in that project's workflows
```

### Scenario 5: Filter entities by tag
```sql
-- Find all workflows in a project with env=prod tag
SELECT project_id, id, slug, tags
FROM workflow_artifacts
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND tags @> '{"env": "prod"}'::JSONB;

-- Or check for key existence
SELECT project_id, id, slug, tags
FROM workflow_artifacts
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND tags ? 'env';

-- Or check for nested key in dot notation
SELECT project_id, id, slug, tags
FROM workflow_artifacts
WHERE project_id = '11111111-1111-1111-1111-111111111111'
  AND tags ? 'owner.name';
```

## 6. Alembic Migration File Template

```python
"""add tags support for workflows

Revision ID: 0001_workflows_tags
Revises: <previous-revision-id>
Create Date: 2025-11-27 12:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001_workflows_tags"
down_revision: Union[str, None] = "<previous>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Create tags table
    op.create_table(
        'tags',
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('project_id', 'kind', 'key'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_tags_project_id_kind', 'tags', ['project_id', 'kind'])

    # Step 2: Create trigger function
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

    # Step 3: Attach triggers to workflow tables
    op.execute("""
    CREATE TRIGGER trg_workflow_artifacts_sync_tags
    AFTER INSERT OR UPDATE ON workflow_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)

    op.execute("""
    CREATE TRIGGER trg_workflow_variants_sync_tags
    AFTER INSERT OR UPDATE ON workflow_variants
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)

    op.execute("""
    CREATE TRIGGER trg_workflow_revisions_sync_tags
    AFTER INSERT OR UPDATE ON workflow_revisions
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)

    # Step 4: Backfill tags from existing workflows
    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_artifacts
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_variants
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)

    op.execute("""
    INSERT INTO tags(project_id, kind, key)
    SELECT DISTINCT project_id, 'workflow'::text, key
    FROM workflow_revisions
    CROSS JOIN LATERAL jsonb_object_keys(tags) AS key
    WHERE tags IS NOT NULL
    ON CONFLICT (project_id, kind, key) DO NOTHING;
    """)


def downgrade() -> None:
    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_artifacts_sync_tags ON workflow_artifacts")
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_variants_sync_tags ON workflow_variants")
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_revisions_sync_tags ON workflow_revisions")

    # Drop function
    op.execute("DROP FUNCTION IF EXISTS sync_tags_from_entity()")

    # Drop table
    op.drop_table('tags')
```

## 7. All Entity Kinds - Complete Trigger List

For future reference, here are all 9 kinds and their trigger statements:

```sql
-- Testsets (3 tables)
CREATE TRIGGER trg_testset_artifacts_sync_tags AFTER INSERT OR UPDATE ON testset_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset');
CREATE TRIGGER trg_testset_variants_sync_tags AFTER INSERT OR UPDATE ON testset_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset');
CREATE TRIGGER trg_testset_revisions_sync_tags AFTER INSERT OR UPDATE ON testset_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('testset');

-- Workflows (3 tables)
CREATE TRIGGER trg_workflow_artifacts_sync_tags AFTER INSERT OR UPDATE ON workflow_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow');
CREATE TRIGGER trg_workflow_variants_sync_tags AFTER INSERT OR UPDATE ON workflow_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow');
CREATE TRIGGER trg_workflow_revisions_sync_tags AFTER INSERT OR UPDATE ON workflow_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('workflow');

-- Queries (3 tables)
CREATE TRIGGER trg_query_artifacts_sync_tags AFTER INSERT OR UPDATE ON query_artifacts FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query');
CREATE TRIGGER trg_query_variants_sync_tags AFTER INSERT OR UPDATE ON query_variants FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query');
CREATE TRIGGER trg_query_revisions_sync_tags AFTER INSERT OR UPDATE ON query_revisions FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('query');

-- Evaluations (5 tables)
CREATE TRIGGER trg_evaluation_runs_sync_tags AFTER INSERT OR UPDATE ON evaluation_runs FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_run');
CREATE TRIGGER trg_evaluation_scenarios_sync_tags AFTER INSERT OR UPDATE ON evaluation_scenarios FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_scenario');
CREATE TRIGGER trg_evaluation_results_sync_tags AFTER INSERT OR UPDATE ON evaluation_results FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_result');
CREATE TRIGGER trg_evaluation_metrics_sync_tags AFTER INSERT OR UPDATE ON evaluation_metrics FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_metrics');
CREATE TRIGGER trg_evaluation_queues_sync_tags AFTER INSERT OR UPDATE ON evaluation_queues FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('evaluation_queue');

-- Blobs (1 table)
CREATE TRIGGER trg_blobs_sync_tags AFTER INSERT OR UPDATE ON blobs FOR EACH ROW EXECUTE FUNCTION sync_tags_from_entity('blob');
```

