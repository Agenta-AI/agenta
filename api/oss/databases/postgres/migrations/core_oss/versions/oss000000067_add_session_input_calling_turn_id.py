"""Add the server-owned calling turn of a child session input.

`calling_turn_id` is the id of the first execution of the calling session's turn that
wrote a child input. The producer of child updates reads the calling turn's row by it.
It is nullable with no default, so the column is added without a table rewrite.
"""

from alembic import op
import sqlalchemy as sa

revision = "oss000000067"
down_revision = "oss000000066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "session_inputs",
        sa.Column("calling_turn_id", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_inputs", "calling_turn_id")
