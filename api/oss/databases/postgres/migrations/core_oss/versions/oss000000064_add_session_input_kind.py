"""Add the server-owned kind of a queued session input.

`kind` says what the input is: `message`, or `child_update` for a server input. It is
nullable with no default, so the column is added without a table rewrite, and a row
written before it (or by an older pod) reads as `message`.
"""

from alembic import op
import sqlalchemy as sa

revision = "oss000000064"
down_revision = "oss000000063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "session_inputs",
        sa.Column("kind", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_inputs", "kind")
