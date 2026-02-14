"""backfill created_at for migrated applications

Revision ID: f1e2d3c4b5a6
Revises: e1f2a3b4c5d6
Create Date: 2026-02-09 00:05:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            WITH app_artifact_sources AS (
                SELECT
                    app.project_id,
                    app.id AS artifact_id,
                    app.created_at
                FROM app_db AS app
                WHERE app.project_id IS NOT NULL
                  AND app.created_at IS NOT NULL
            )
            UPDATE workflow_artifacts AS wa
            SET created_at = aas.created_at
            FROM app_artifact_sources AS aas
            WHERE wa.project_id = aas.project_id
              AND wa.id = aas.artifact_id
              AND COALESCE((wa.flags->>'is_evaluator')::boolean, FALSE) IS FALSE
              AND wa.created_at IS DISTINCT FROM aas.created_at;
            """
        )
    )

    op.execute(
        sa.text(
            """
            WITH app_variant_sources AS (
                SELECT
                    av.project_id,
                    av.id AS variant_id,
                    av.created_at
                FROM app_variants AS av
                WHERE av.project_id IS NOT NULL
                  AND av.created_at IS NOT NULL
            )
            UPDATE workflow_variants AS wv
            SET created_at = avs.created_at
            FROM app_variant_sources AS avs
            WHERE wv.project_id = avs.project_id
              AND wv.id = avs.variant_id
              AND wv.created_at IS DISTINCT FROM avs.created_at;
            """
        )
    )

    op.execute(
        sa.text(
            """
            WITH app_revision_sources AS (
                SELECT
                    avr.project_id,
                    avr.id AS revision_id,
                    avr.variant_id,
                    avr.created_at
                FROM app_variant_revisions AS avr
                WHERE avr.project_id IS NOT NULL
                  AND avr.created_at IS NOT NULL
            )
            UPDATE workflow_revisions AS wr
            SET created_at = ars.created_at,
                date = ars.created_at
            FROM app_revision_sources AS ars
            WHERE wr.project_id = ars.project_id
              AND wr.id = ars.revision_id
              AND wr.variant_id = ars.variant_id
              AND (
                  wr.created_at IS DISTINCT FROM ars.created_at
                  OR wr.date IS DISTINCT FROM ars.created_at
              );
            """
        )
    )


def downgrade() -> None:
    pass
