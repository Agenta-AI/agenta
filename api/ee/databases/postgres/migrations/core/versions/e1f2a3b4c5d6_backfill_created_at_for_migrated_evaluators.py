"""backfill created_at for migrated evaluators

Revision ID: e1f2a3b4c5d6
Revises: c9d0e1f2a3b4
Create Date: 2026-02-09 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            WITH evaluator_sources AS (
                SELECT
                    ec.project_id,
                    ec.id AS artifact_id,
                    ec.created_at
                FROM auto_evaluator_configs AS ec
                WHERE ec.project_id IS NOT NULL
                  AND ec.created_at IS NOT NULL
            )
            UPDATE workflow_artifacts AS wa
            SET created_at = es.created_at
            FROM evaluator_sources AS es
            WHERE wa.project_id = es.project_id
              AND wa.id = es.artifact_id
              AND COALESCE((wa.flags->>'is_evaluator')::boolean, FALSE) IS TRUE
              AND wa.created_at IS DISTINCT FROM es.created_at;
            """
        )
    )


def downgrade() -> None:
    pass
