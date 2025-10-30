"""migrate nodes to spans

Revision ID: a1b2c3d4e5f6
Revises: fd77265d65dc
Create Date: 2025-10-25 12:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Migrate data from the `nodes` table to the `spans` table.

    This migration transforms the old node-based schema to the new OpenTelemetry-compliant
    spans schema. It maps fields as follows:
    - tree_id -> trace_id
    - node_id -> span_id
    - node_name -> span_name
    - time_start -> start_time (converted to timestamptz)
    - time_end -> end_time (converted to timestamptz)
    - refs -> references
    - otel->kind -> span_kind
    - otel->attributes -> attributes
    - otel->events -> events
    - otel->links -> links
    - status->code -> status_code (mapped to enum)
    - status->message -> status_message
    - tree_type -> trace_type
    - node_type -> span_type
    """

    # Execute raw SQL to migrate data
    conn = op.get_bind()

    # Migration SQL
    migration_sql = """
    INSERT INTO spans (
        project_id,
        created_at,
        updated_at,
        created_by_id,
        updated_by_id,
        trace_id,
        span_id,
        parent_id,
        span_kind,
        span_name,
        start_time,
        end_time,
        status_code,
        status_message,
        attributes,
        events,
        links,
        "references",
        trace_type,
        span_type,
        hashes,
        exception
    )
    SELECT
        project_id,
        created_at,
        updated_at,
        -- Use updated_by_id as created_by_id, or project_id if null
        COALESCE(updated_by_id, project_id) as created_by_id,
        updated_by_id,
        tree_id as trace_id,
        node_id as span_id,
        parent_id,
        -- Extract span_kind from otel field, default to SPAN_KIND_INTERNAL if null
        COALESCE(
            (otel->>'kind')::otelspankind,
            'SPAN_KIND_INTERNAL'::otelspankind
        ) as span_kind,
        node_name as span_name,
        -- Convert timestamp without timezone to timestamptz
        time_start AT TIME ZONE 'UTC' as start_time,
        time_end AT TIME ZONE 'UTC' as end_time,
        -- Map status code from status->code, default to STATUS_CODE_UNSET if null
        CASE
            WHEN status->>'code' = 'OK' THEN 'STATUS_CODE_OK'::otelstatuscode
            WHEN status->>'code' = 'ERROR' THEN 'STATUS_CODE_ERROR'::otelstatuscode
            ELSE 'STATUS_CODE_UNSET'::otelstatuscode
        END as status_code,
        status->>'message' as status_message,
        -- Extract attributes from otel->attributes, or use empty object if null
        COALESCE(otel->'attributes', '{}'::jsonb) as attributes,
        -- Extract events from otel->events, or null if not present
        otel->'events' as events,
        links,
        -- Transform refs from flat object to array of Reference objects
        -- refs structure: {"application.id": "...", "application.slug": "...", "variant.id": "...", ...}
        -- references structure: [{"id": "...", "slug": "...", "version": 1, "attributes": {"key": "application"}}, ...]
        (
            SELECT jsonb_agg(ref_obj)
            FROM (
                SELECT jsonb_build_object(
                    'id', refs->>CONCAT(ref_type, '.id'),
                    'slug', refs->>CONCAT(ref_type, '.slug'),
                    'version', COALESCE((refs->>CONCAT(ref_type, '.version'))::int, 1),
                    'attributes', jsonb_build_object('key', ref_type)
                ) as ref_obj
                FROM unnest(ARRAY['application', 'variant', 'environment']) as ref_type
                WHERE refs ? CONCAT(ref_type, '.id')
            ) refs_array
        ) as "references",
        -- Cast tree_type from treetype to tracetype via text
        (tree_type::text)::tracetype as trace_type,
        -- Cast node_type from nodetype to spantype via text (they have compatible values)
        CASE
            WHEN node_type::text IN ('AGENT', 'WORKFLOW', 'CHAIN', 'TASK', 'TOOL', 'EMBEDDING', 'QUERY', 'COMPLETION', 'CHAT', 'RERANK')
            THEN (node_type::text)::spantype
            ELSE 'UNKNOWN'::spantype
        END as span_type,
        -- Set hashes to null for now
        NULL::jsonb as hashes,
        exception
    FROM nodes
    WHERE NOT EXISTS (
        -- Don't insert if span already exists (idempotency)
        SELECT 1 FROM spans
        WHERE spans.project_id = nodes.project_id
        AND spans.trace_id = nodes.tree_id
        AND spans.span_id = nodes.node_id
    );
    """

    try:
        # Execute migration
        conn.execute(sa.text(migration_sql))
        print("✓ Successfully migrated data from nodes to spans table")

        # Print migration statistics
        result = conn.execute(sa.text("SELECT COUNT(*) FROM spans"))
        spans_count = result.scalar()
        result = conn.execute(sa.text("SELECT COUNT(*) FROM nodes"))
        nodes_count = result.scalar()

        print(f"  - Nodes table: {nodes_count} records")
        print(f"  - Spans table: {spans_count} records (after migration)")

    except Exception as e:
        print(f"✗ Migration failed: {e}")
        raise


def downgrade() -> None:
    """
    Remove migrated data from spans table.

    WARNING: This will delete all spans that were migrated from nodes.
    """
    conn = op.get_bind()

    # Delete only the migrated data (those with matching tree_id/node_id in nodes)
    downgrade_sql = """
    DELETE FROM spans
    WHERE EXISTS (
        SELECT 1 FROM nodes
        WHERE nodes.tree_id = spans.trace_id
        AND nodes.node_id = spans.span_id
        AND nodes.project_id = spans.project_id
    );
    """

    try:
        conn.execute(sa.text(downgrade_sql))
        print("✓ Successfully removed migrated data from spans table")
    except Exception as e:
        print(f"✗ Downgrade failed: {e}")
        raise
