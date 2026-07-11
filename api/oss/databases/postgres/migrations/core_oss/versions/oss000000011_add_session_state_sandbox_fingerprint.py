"""add session state sandbox fingerprint

Revision ID: oss000000011
Revises: oss000000010
Create Date: 2026-07-11 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000011"
down_revision: Union[str, None] = "oss000000010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_states",
        sa.Column("sandbox_fingerprint", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_states", "sandbox_fingerprint")
