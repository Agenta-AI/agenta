"""add organization kind

Revision ID: a9f3e8b7c5d1
Revises: 12d23a8f7dde
Create Date: 2025-12-26 00:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a9f3e8b7c5d1"
down_revision: Union[str, None] = "12d23a8f7dde"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add organization kind column for OSS mode.

    OSS Mode:
    - Must have exactly 1 organization (fail-fast if not)
    - Set kind = collaborative
    - No personal organizations (OSS does not support them)
    """
    conn = op.get_bind()

    # OSS: Must have exactly 1 organization
    org_count = conn.execute(text("SELECT COUNT(*) FROM organizations")).scalar()

    if org_count == 0:
        raise ValueError("OSS mode: No organizations found. Cannot proceed with migration.")
    elif org_count > 1:
        raise ValueError(
            f"OSS mode: Found {org_count} organizations. OSS supports exactly 1 collaborative organization. "
            "Please consolidate organizations before migrating."
        )

    # Step 1: Add kind column
    op.add_column("organizations", sa.Column("kind", sa.String(), nullable=True))

    # Step 2: Set the single organization to collaborative
    conn.execute(
        text("UPDATE organizations SET kind = 'collaborative' WHERE kind IS NULL")
    )

    # Step 3: Make kind NOT NULL
    op.alter_column("organizations", "kind", nullable=False)

    # Step 4: Create index
    op.create_index("ix_organizations_kind", "organizations", ["kind"])

    # Step 5: Add check constraint
    op.create_check_constraint(
        "ck_organizations_kind",
        "organizations",
        "kind IN ('personal', 'collaborative')"
    )


def downgrade() -> None:
    """Remove organization kind column."""
    op.drop_constraint("ck_organizations_kind", "organizations")
    op.drop_index("ix_organizations_kind", "organizations")
    op.drop_column("organizations", "kind")
