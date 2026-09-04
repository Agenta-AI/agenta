"""add session sequence cursors

Revision ID: oss000000005
Revises: oss000000004
Create Date: 2026-09-04 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000005"
down_revision: Union[str, None] = "oss000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_sequence_cursors",
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("latest_sequence", sa.BigInteger(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("session_id"),
    )
    op.add_column("records", sa.Column("sequence", sa.BigInteger(), nullable=True))
    op.create_index(
        "ux_records_session_id_sequence",
        "records",
        ["session_id", "sequence"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_records_session_id_sequence", table_name="records")
    op.drop_column("records", "sequence")
    op.drop_table("session_sequence_cursors")
