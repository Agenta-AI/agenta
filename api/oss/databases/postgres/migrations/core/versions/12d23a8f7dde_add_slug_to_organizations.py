"""add slug to organizations

Revision ID: 12d23a8f7dde
Revises: 59b85eb7516c
Create Date: 2025-12-25 00:00:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "12d23a8f7dde"
down_revision: Union[str, None] = "59b85eb7516c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add slug column to organizations table
    op.add_column(
        "organizations",
        sa.Column(
            "slug",
            sa.String(),
            nullable=True,
        ),
    )

    # Add unique constraint on slug
    op.create_unique_constraint(
        "uq_organizations_slug",
        "organizations",
        ["slug"],
    )

    # Add index for faster lookups
    op.create_index(
        "ix_organizations_slug",
        "organizations",
        ["slug"],
    )


def downgrade() -> None:
    # Drop in reverse order
    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_constraint("uq_organizations_slug", "organizations", type_="unique")
    op.drop_column("organizations", "slug")
