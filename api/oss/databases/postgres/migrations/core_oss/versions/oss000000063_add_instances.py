"""add instances

`instances` holds one row: this installation's random id, made here with
`gen_random_uuid()`, so no container has to create it and no start-up race exists.
`installed_event_sent_at` and `heartbeat_sent_at` record when the install ping and the
telemetry heartbeat were last accepted by PostHog.

The table is new, so nothing else is locked. Old code ignores it.

Revision ID: oss000000063
Revises: oss000000062
Create Date: 2026-11-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000063"
down_revision: Union[str, None] = "oss000000062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "installed_event_sent_at", sa.TIMESTAMP(timezone=True), nullable=True
        ),
        sa.Column("heartbeat_sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_instances"),
    )
    op.execute(
        "INSERT INTO instances (id) "
        "SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM instances)"
    )


def downgrade() -> None:
    op.drop_table("instances")
