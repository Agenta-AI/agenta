"""Drop corrupted metrics for some runs

Revision ID: a1b2c3d4e5f6
Revises: 652f6113b5f5
Create Date: 2025-11-28 00:00:00

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "652f6113b5f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    batch_size = 100

    # ------------------------------------------------------------------
    # 1) Drop metrics for runs where flags.has_human = true (batched)
    # ------------------------------------------------------------------
    while True:
        # Grab up to batch_size metric IDs whose run has has_human = true
        rows = conn.execute(
            sa.text(
                """
                SELECT em.id
                FROM evaluation_metrics AS em
                JOIN evaluation_runs AS er
                  ON er.project_id = em.project_id
                 AND er.id = em.run_id
                WHERE er.flags::jsonb ->> 'has_human' = 'true'
                LIMIT :batch_size
                """
            ),
            {"batch_size": batch_size},
        ).fetchall()

        if not rows:
            break

        ids = [row[0] for row in rows]

        conn.execute(
            sa.text(
                """
                DELETE FROM evaluation_metrics
                WHERE id = ANY(:ids)
                """
            ),
            {"ids": ids},
        )

    # ------------------------------------------------------------------
    # 2) Drop metrics whose data has at least one 2nd-level key
    #    that does NOT start with 'attribute' (batched)
    # ------------------------------------------------------------------
    while True:
        rows = conn.execute(
            sa.text(
                """
                SELECT id
                FROM evaluation_metrics AS em
                WHERE EXISTS (
                    SELECT 1
                    FROM json_each(
                             CASE
                                 WHEN json_typeof(em.data) = 'object'
                                 THEN em.data
                                 ELSE '{}'::json
                             END
                         ) AS top(top_key, top_value)
                    CROSS JOIN LATERAL json_each(
                             CASE
                                 WHEN json_typeof(top_value) = 'object'
                                 THEN top_value
                                 ELSE '{}'::json
                             END
                         ) AS second(second_key, second_value)
                    WHERE second_key NOT LIKE 'attribute%'
                )
                LIMIT :batch_size
                """
            ),
            {"batch_size": batch_size},
        ).fetchall()

        if not rows:
            break

        ids = [row[0] for row in rows]

        conn.execute(
            sa.text(
                """
                DELETE FROM evaluation_metrics
                WHERE id = ANY(:ids)
                """
            ),
            {"ids": ids},
        )


def downgrade() -> None:
    # Data-destructive; nothing to restore
    pass
