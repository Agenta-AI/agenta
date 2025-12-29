"""add sso oidc tables

Revision ID: 59b85eb7516c
Revises: 80910d2fa9a4
Create Date: 2025-12-10 08:53:56.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "59b85eb7516c"
down_revision: Union[str, None] = "80910d2fa9a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. user_identities table
    op.create_table(
        "user_identities",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "method",
            sa.String(),
            nullable=False,
        ),
        sa.Column(
            "subject",
            sa.String(),
            nullable=False,
        ),
        sa.Column(
            "domain",
            sa.String(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "updated_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "deleted_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "method",
            "subject",
            name="uq_user_identities_method_subject",
        ),
        sa.Index(
            "ix_user_identities_user_method",
            "user_id",
            "method",
        ),
        sa.Index(
            "ix_user_identities_domain",
            "domain",
        ),
    )

    # EE-only tables (organization_policies, organization_domains, organization_providers, organization_invitations)
    # are defined in the EE migration version of this file

    # 2. Add is_active to users table
    op.add_column(
        "users",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )


def downgrade() -> None:
    # Drop in reverse order
    op.drop_column("users", "is_active")

    # EE-only table drops are in the EE migration version of this file

    op.drop_index(
        "ix_user_identities_domain",
        table_name="user_identities",
    )
    op.drop_index(
        "ix_user_identities_user_method",
        table_name="user_identities",
    )
    op.drop_table("user_identities")
