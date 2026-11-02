"""record how an MCP OAuth authorization attempt ended

The callback used to delete an attempt as it consumed it, so nothing remained to say
whether the consent succeeded. When the popup's message never reached the app, the sheet
could only report a closed window, even over a connection that was authorized. The row
now stays until the expiry sweep with its status and, for a failure, the callback's own
words, and a cancel marks it instead of racing a late callback.

Existing rows are in flight, so they start as `pending`.

Revision ID: oss000000042
Revises: oss000000041
Create Date: 2026-10-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000042"
down_revision: Union[str, None] = "oss000000041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mcps_oauth_attempts",
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
    )
    op.add_column(
        "mcps_oauth_attempts",
        sa.Column("error", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("mcps_oauth_attempts", "error")
    op.drop_column("mcps_oauth_attempts", "status")
