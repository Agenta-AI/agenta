"""add custom_secret kind and secrets.slug

Adds the CUSTOM_SECRET member to the shared secretkind_enum (so the vault can
store arbitrary user-named secrets) and a nullable `slug` column on `secrets`
with a partial unique index (unique per project where set). The slug is the
URL-safe, project-unique handle for addressing custom secrets.

This lives in the shared core_oss chain (runs in both editions); the enum and
the secrets table are OSS/shared objects, so there is no EE-only copy.

Revision ID: oss000000005
Revises: oss000000004
Create Date: 2026-06-26 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "oss000000005"
down_revision: Union[str, None] = "oss000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CUSTOM_SECRET'")

    op.add_column("secrets", sa.Column("slug", sa.String(), nullable=True))
    op.create_index(
        "uq_secrets_project_id_slug",
        "secrets",
        ["project_id", "slug"],
        unique=True,
        postgresql_where=sa.text("slug IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_secrets_project_id_slug", table_name="secrets")
    op.drop_column("secrets", "slug")
    # PostgreSQL cannot drop an enum value; the CUSTOM_SECRET label stays.
