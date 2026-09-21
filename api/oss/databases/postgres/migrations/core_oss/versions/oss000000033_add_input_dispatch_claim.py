"""Persist a one-shot dispatch claim for server-started session inputs."""

from alembic import op
import sqlalchemy as sa

revision = "oss000000033"
down_revision = "oss000000032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Bounded wait, for the same reason revision 032 states. `ALTER TABLE ... ADD COLUMN` needs
    # ACCESS EXCLUSIVE on `session_inputs`, which every chat turn writes and `promote_next` holds
    # rows of under `SELECT ... FOR UPDATE SKIP LOCKED`. With an unbounded `lock_timeout` this
    # queues behind any open transaction on the table, and every new query on the table then
    # queues behind it, stalling the send path for everyone. The DDL itself is milliseconds;
    # failing and being re-run is the better outcome.
    op.get_bind().execute(sa.text("SET LOCAL lock_timeout = '5s'"))

    op.add_column(
        "session_inputs",
        sa.Column(
            "dispatch_claimed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("session_inputs", "dispatch_claimed")
