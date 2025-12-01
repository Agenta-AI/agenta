"""add sync_tags_from_entity trigger function and attach to workflow tables

Revision ID: 0002_add_sync_tags_trigger
Revises: 0001_add_tags
Create Date: 2025-11-27 10:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002_add_sync_tags_trigger"
down_revision: Union[str, None] = "0001_add_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create generic trigger function for syncing entity tags to tags table
    op.execute("""
    CREATE OR REPLACE FUNCTION sync_tags_from_entity()
    RETURNS trigger AS $$
    DECLARE
        k text;
        entity_kind text;
    BEGIN
        -- Get the entity kind from trigger parameter
        entity_kind := TG_ARGV[0];

        -- Only process INSERT and UPDATE operations
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            -- If entity has tags, extract and sync each key
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
    """)

    # Attach triggers to workflow_artifacts
    op.execute("""
    CREATE TRIGGER trg_workflow_artifacts_sync_tags
    AFTER INSERT OR UPDATE ON workflow_artifacts
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)

    # Attach triggers to workflow_variants
    op.execute("""
    CREATE TRIGGER trg_workflow_variants_sync_tags
    AFTER INSERT OR UPDATE ON workflow_variants
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)

    # Attach triggers to workflow_revisions
    op.execute("""
    CREATE TRIGGER trg_workflow_revisions_sync_tags
    AFTER INSERT OR UPDATE ON workflow_revisions
    FOR EACH ROW
    EXECUTE FUNCTION sync_tags_from_entity('workflow');
    """)


def downgrade() -> None:
    # Drop triggers in reverse order
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_revisions_sync_tags ON workflow_revisions")
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_variants_sync_tags ON workflow_variants")
    op.execute("DROP TRIGGER IF EXISTS trg_workflow_artifacts_sync_tags ON workflow_artifacts")

    # Drop function
    op.execute("DROP FUNCTION IF EXISTS sync_tags_from_entity()")
