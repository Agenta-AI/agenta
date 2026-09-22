"""Persist a one-shot dispatch claim for server-started session inputs."""

from alembic import op
import sqlalchemy as sa

revision = "oss000000033"
down_revision = "oss000000032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "session_inputs",
        sa.Column(
            "dispatch_claimed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("session_inputs", "dispatch_claimed")
