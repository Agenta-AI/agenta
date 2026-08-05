"""add organization scope to secrets

Revision ID: c3b2a1d4e5f6
Revises: a9f3e8b7c5d1
Create Date: 2025-01-10 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c3b2a1d4e5f6"
down_revision: Union[str, None] = "a9f3e8b7c5d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'SSO_PROVIDER'")

    inspector = sa.inspect(connection)
    columns = {col["name"] for col in inspector.get_columns("secrets")}

    if "organization_id" not in columns:
        op.add_column("secrets", sa.Column("organization_id", sa.UUID(), nullable=True))

    op.alter_column("secrets", "project_id", nullable=True)

    op.create_foreign_key(
        "secrets_organization_id_fkey",
        "secrets",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("secrets_organization_id_fkey", "secrets", type_="foreignkey")
    op.drop_column("secrets", "organization_id")
    op.alter_column("secrets", "project_id", nullable=False)
