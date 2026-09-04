"""add incomplete-history marker to session_streams

Revision ID: oss000000025
Revises: oss000000021
Create Date: 2026-09-03 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000025"
down_revision: Union[str, None] = "oss000000021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_streams",
        sa.Column("history_incomplete", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_streams", "history_incomplete")
