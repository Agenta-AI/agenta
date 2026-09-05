"""add session sequence cursors

Revision ID: oss000000006
Revises: oss000000005
Create Date: 2026-09-04 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000006"
down_revision: Union[str, None] = "oss000000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_sequence_cursors",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("latest_sequence", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.PrimaryKeyConstraint("project_id", "session_id"),
    )
    op.add_column("records", sa.Column("sequence", sa.BigInteger(), nullable=True))
    op.create_index(
        "ux_records_session_id_sequence",
        "records",
        ["project_id", "session_id", "sequence"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_records_session_id_sequence", table_name="records")
    op.drop_column("records", "sequence")
    op.drop_table("session_sequence_cursors")
