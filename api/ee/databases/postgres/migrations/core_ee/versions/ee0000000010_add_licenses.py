"""add licenses

A self-hosted instance stores the license key an instance admin adds in the app. At
most one row: `PUT /instance/license` replaces it in one transaction. `id` is the key's
`key_id`. `created_by_id` is the instance admin who added it, with no foreign key, so
deleting that user keeps the license.

Revision ID: ee0000000010
Revises: ee0000000009
Create Date: 2026-11-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ee0000000010"
down_revision: Union[str, None] = "ee0000000009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "licenses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("licenses")
