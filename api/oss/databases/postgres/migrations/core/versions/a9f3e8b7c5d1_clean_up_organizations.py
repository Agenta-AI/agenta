"""clean up organizations

Revision ID: a9f3e8b7c5d1
Revises: 12d23a8f7dde
Create Date: 2025-12-26 00:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9f3e8b7c5d1"
down_revision: Union[str, None] = "12d23a8f7dde"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Clean up organizations table and introduce new schema.

    Changes:
    - Add flags (JSONB, nullable) with is_personal and is_demo fields
    - Migrate type='view-only' to flags.is_demo=true
    - Set is_personal=false for the single organization
    - Drop type column
    - Convert owner (String) to owner_id (UUID, NOT NULL)
    - Add created_by_id (UUID, NOT NULL)
    - Ensure created_at is NOT NULL, remove default from updated_at
    - Add updated_by_id (UUID, nullable)
    - Add deleted_at (DateTime, nullable)
    - Add deleted_by_id (UUID, nullable)
    - Drop user_organizations table
    - Drop invitations table (obsolete)

    OSS Mode:
    - Must have exactly 1 organization (fail-fast if not)
    - Set is_personal=false (no personal organizations in OSS)
    """
    conn = op.get_bind()

    def _constraint_exists(constraint_name: str) -> bool:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = :constraint_name
                    """
                ),
                {"constraint_name": constraint_name},
            ).scalar()
        )

    # OSS: Must have exactly 1 organization
    org_count = conn.execute(text("SELECT COUNT(*) FROM organizations")).scalar()

    if org_count == 0:
        raise ValueError(
            "OSS mode: No organizations found. Cannot proceed with migration."
        )
    elif org_count > 1:
        raise ValueError(
            f"OSS mode: Found {org_count} organizations. OSS supports exactly 1 collaborative organization. "
            "Please consolidate organizations before migrating."
        )

    # Step 1: Add JSONB columns (flags, tags, meta - all nullable)
    op.add_column(
        "organizations",
        sa.Column(
            "flags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )

    # Step 2: Add new UUID columns (all nullable initially for migration)
    op.add_column(
        "organizations",
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # Step 3: Migrate type='view-only' to is_demo=true, set is_personal=false
    conn.execute(
        text("""
        UPDATE organizations
        SET flags = jsonb_build_object(
            'is_demo', CASE WHEN type = 'view-only' THEN true ELSE false END,
            'is_personal', false
        )
        WHERE flags IS NULL OR flags = '{}'::jsonb
    """)
    )

    # Step 4: Migrate owner (String) to owner_id (UUID)
    # Set owner_id = owner::uuid for existing org
    conn.execute(
        text("""
        UPDATE organizations
        SET owner_id = owner::uuid
        WHERE owner IS NOT NULL
    """)
    )

    # Step 5: Set created_by_id = owner_id for existing org
    conn.execute(
        text("""
        UPDATE organizations
        SET created_by_id = owner_id
        WHERE owner_id IS NOT NULL
    """)
    )

    # Step 6: Set updated_by_id = owner_id for existing org
    conn.execute(
        text("""
        UPDATE organizations
        SET updated_by_id = owner_id
        WHERE owner_id IS NOT NULL
    """)
    )

    # Step 7: Ensure created_at has a value for all existing records
    conn.execute(
        text("""
        UPDATE organizations
        SET created_at = COALESCE(created_at, NOW())
        WHERE created_at IS NULL
    """)
    )

    # Step 8: Make owner_id, created_by_id, and created_at NOT NULL; remove updated_at default
    op.alter_column("organizations", "owner_id", nullable=False)
    op.alter_column("organizations", "created_by_id", nullable=False)
    op.alter_column("organizations", "created_at", nullable=False)
    op.alter_column("organizations", "updated_at", server_default=None)

    # Step 9: Add foreign key constraints
    op.create_foreign_key(
        "fk_organizations_owner_id_users",
        "organizations",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_organizations_created_by_id_users",
        "organizations",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_organizations_updated_by_id_users",
        "organizations",
        "users",
        ["updated_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_organizations_deleted_by_id_users",
        "organizations",
        "users",
        ["deleted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Step 9b: Ensure workspaces cascade on organization delete
    if _constraint_exists("workspaces_organization_id_fkey"):
        op.drop_constraint(
            "workspaces_organization_id_fkey",
            "workspaces",
            type_="foreignkey",
        )
    if not _constraint_exists("workspaces_organization_id_fkey"):
        op.create_foreign_key(
            "workspaces_organization_id_fkey",
            "workspaces",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Step 9c: Ensure projects cascade on organization delete
    if _constraint_exists("projects_organization_id_fkey"):
        op.drop_constraint(
            "projects_organization_id_fkey",
            "projects",
            type_="foreignkey",
        )
    if not _constraint_exists("projects_organization_id_fkey"):
        op.create_foreign_key(
            "projects_organization_id_fkey",
            "projects",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Note: Other tables (testsets, evaluations, scenarios, etc.) are linked to
    # organizations via projects, so they will cascade delete through projects.
    # They should keep SET NULL on organization_id for direct references.

    # Step 10: Drop type and owner columns
    op.drop_column("organizations", "type")
    op.drop_column("organizations", "owner")

    # Step 11: Drop obsolete tables
    conn.execute(text("DROP TABLE IF EXISTS user_organizations CASCADE"))
    conn.execute(text("DROP TABLE IF EXISTS invitations CASCADE"))


def downgrade() -> None:
    """Restore organizations type and owner columns and revert schema changes."""
    conn = op.get_bind()

    # Drop foreign key constraints
    op.drop_constraint(
        "fk_organizations_deleted_by_id_users", "organizations", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_organizations_updated_by_id_users", "organizations", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_organizations_created_by_id_users", "organizations", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_organizations_owner_id_users", "organizations", type_="foreignkey"
    )

    # Recreate type column
    op.add_column("organizations", sa.Column("type", sa.String(), nullable=True))

    # Migrate flags back to type
    conn.execute(
        text("""
        UPDATE organizations
        SET type = CASE
            WHEN flags->>'is_demo' = 'true' THEN 'view-only'
            ELSE 'default'
        END
    """)
    )

    op.alter_column("organizations", "type", nullable=False)

    # Recreate owner column
    op.add_column("organizations", sa.Column("owner", sa.String(), nullable=True))

    # Migrate owner_id back to owner (UUID to String)
    conn.execute(
        text("""
        UPDATE organizations
        SET owner = owner_id::text
        WHERE owner_id IS NOT NULL
    """)
    )

    # Restore updated_at default
    conn.execute(
        text("""
        UPDATE organizations
        SET updated_at = COALESCE(updated_at, NOW())
        WHERE updated_at IS NULL
    """)
    )
    op.alter_column(
        "organizations",
        "updated_at",
        server_default=sa.text("NOW()"),
        nullable=False,
    )

    # Drop new columns
    op.drop_column("organizations", "deleted_by_id")
    op.drop_column("organizations", "deleted_at")
    op.drop_column("organizations", "updated_by_id")
    op.drop_column("organizations", "created_by_id")
    op.drop_column("organizations", "owner_id")
    op.drop_column("organizations", "meta")
    op.drop_column("organizations", "tags")
    op.drop_column("organizations", "flags")

    # Note: We don't recreate user_organizations and invitations tables
    # as they contain no data at this point
