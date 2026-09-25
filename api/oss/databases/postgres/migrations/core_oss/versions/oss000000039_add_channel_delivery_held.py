"""add the held channel delivery state

Revision ID: oss000000039
Revises: oss000000038
Create Date: 2026-09-24 00:00:00.000000

WhatsApp only accepts a free-form reply within 24 hours of the customer's last
message. A reply that is ready after that is kept, not sent: the outbox row
moves to HELD and goes out when the customer writes again.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "oss000000039"
down_revision: str | None = "oss000000038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADD VALUE cannot run inside a transaction block on older Postgres; the
    # autocommit block makes it safe on every supported version.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE channeldeliverystate ADD VALUE IF NOT EXISTS 'HELD'")


def downgrade() -> None:
    # Postgres cannot drop an enum value. Rows in HELD are moved to FAILED so
    # an older build never reads a state it does not know; the value stays.
    op.execute("UPDATE channel_outbox_events SET state = 'FAILED' WHERE state = 'HELD'")
