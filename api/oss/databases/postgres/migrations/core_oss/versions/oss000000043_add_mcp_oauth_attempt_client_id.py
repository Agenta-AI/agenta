"""record which OAuth client an MCP authorization attempt signs in as

A connection's OAuth client can change while a consent is in flight: the person enters
their own app, or removes it. The callback has to know which client the code was issued
to, so it can refuse to bind a grant once the connection selects a different one.

Existing rows are in flight and carry no client, so they finish as before.

Revision ID: oss000000043
Revises: oss000000042
Create Date: 2026-10-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000043"
down_revision: Union[str, None] = "oss000000042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mcps_oauth_attempts",
        sa.Column("client_id", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("mcps_oauth_attempts", "client_id")
