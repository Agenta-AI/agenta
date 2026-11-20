"""add instances

`instances` holds one row: this installation's random id, made here with
`gen_random_uuid()`, so no container has to create it and no start-up race exists.
`installed_event_sent_at` and `heartbeat_sent_at` record when the install ping and the
telemetry heartbeat were last accepted by PostHog. `preexisting` is true when the
database already had users or organizations at migration time: the install upgraded
from an older version, so it sends no install ping and is not counted as a new install.

The table is new, so nothing else is locked. Old code ignores it.

Revision ID: oss000000064
Revises: oss000000063
Create Date: 2026-11-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000064"
down_revision: Union[str, None] = "oss000000063"
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
        sa.Column(
            "preexisting",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_instances"),
    )
    op.execute(
        "INSERT INTO instances (id, preexisting) "
        "SELECT gen_random_uuid(), "
        "EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM organizations) "
        "WHERE NOT EXISTS (SELECT 1 FROM instances)"
    )


def downgrade() -> None:
    op.drop_table("instances")
