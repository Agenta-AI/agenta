"""make webhooks project based

Revision ID: f1g2h3i4j5k6
Revises: e1f2g3h4i5j6
Create Date: 2026-01-07 00:00:00.000000

This migration makes webhooks project-based rather than app-based.
The app_id field is now optional, allowing webhooks to be triggered
for any app/prompt deployment within a project.

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f1g2h3i4j5k6"
down_revision: Union[str, None] = "e1f2g3h4i5j6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make app_id nullable to allow project-scoped webhooks
    op.alter_column(
        "webhooks",
        "app_id",
        existing_type=postgresql.UUID(),
        nullable=True,
        existing_nullable=False,
        postgresql_existing_nullable=False,
    )


def downgrade() -> None:
    # Revert app_id to NOT NULL
    # Note: This will fail if there are webhooks with NULL app_id
    # You should clean those up first
    op.execute("DELETE FROM webhooks WHERE app_id IS NULL")

    op.alter_column(
        "webhooks",
        "app_id",
        existing_type=postgresql.UUID(),
        nullable=False,
        existing_nullable=True,
        postgresql_existing_nullable=True,
    )
