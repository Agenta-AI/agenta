"""add name/description header to session_streams

Revision ID: oss000000015
Revises: oss000000014
Create Date: 2026-07-17 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000015"
down_revision: Union[str, None] = "oss000000014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_streams",
        sa.Column("name", sa.String(), nullable=True),
    )
    op.add_column(
        "session_streams",
        sa.Column("description", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_streams", "description")
    op.drop_column("session_streams", "name")
