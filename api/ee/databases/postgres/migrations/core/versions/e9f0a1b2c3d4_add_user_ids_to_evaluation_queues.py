"""Add user_ids column to evaluation queues

Revision ID: e9f0a1b2c3d4
Revises: d7e8f9a0b1c2
Create Date: 2026-02-26 13:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "evaluation_queues",
        sa.Column("user_ids", sa.ARRAY(sa.UUID()), nullable=True),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE evaluation_queues
            SET user_ids = (
                SELECT array_agg(DISTINCT uid.value::uuid)
                FROM jsonb_array_elements(
                    COALESCE((evaluation_queues.data -> 'user_ids')::jsonb, '[]'::jsonb)
                ) AS repeat_user_ids(value)
                CROSS JOIN LATERAL jsonb_array_elements_text(repeat_user_ids.value) AS uid(value)
            )
            """
        )
    )

    op.create_index(
        "ix_evaluation_queues_user_ids",
        "evaluation_queues",
        ["user_ids"],
        unique=False,
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_evaluation_queues_user_ids", table_name="evaluation_queues")
    op.drop_column("evaluation_queues", "user_ids")
