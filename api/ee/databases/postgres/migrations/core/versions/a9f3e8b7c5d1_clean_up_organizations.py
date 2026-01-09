"""clean up organizations

Revision ID: a9f3e8b7c5d1
Revises: 12d23a8f7dde
Create Date: 2025-12-26 00:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from oss.src.utils.env import env
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
    - Drop type column
    - Convert owner (String) to owner_id (UUID, NOT NULL)
    - Add created_by_id (UUID, NOT NULL)
    - Ensure created_at is NOT NULL, remove default from updated_at
    - Add updated_by_id (UUID, nullable)
    - Add deleted_at (DateTime, nullable)
    - Add deleted_by_id (UUID, nullable)
    - Add role field to organization_members (String, default="member")
    - Populate role='owner' for organization owners
    - Add LegacyLifecycle fields to organization_members (created_at, updated_at, updated_by_id - all nullable)
    - Add updated_by_id to workspace_members (nullable)
    - Add updated_by_id to project_members (nullable)
    - Drop user_organizations table (replaced by organization_members)
    - Drop invitations table (obsolete)

    EE Mode:
    - Organizations with >1 member → is_personal=false
    - Organizations with =1 member and user owns it → is_personal=true
    - Create missing personal orgs for users without one
    - Normalize names: personal orgs → "Personal", slug → NULL
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

    # Step 3: Get member counts for all organizations
    conn.execute(
        text("""
        CREATE TEMP TABLE org_member_counts AS
        SELECT
            o.id as org_id,
            COUNT(om.id) as member_count,
            o.owner as owner_str
        FROM organizations o
        LEFT JOIN organization_members om ON om.organization_id = o.id
        GROUP BY o.id, o.owner
    """)
    )

    # Step 4: Migrate type='view-only' to is_demo=true for all orgs
    # and mark multi-member orgs as is_personal=false
    conn.execute(
        text("""
        UPDATE organizations o
        SET flags = jsonb_build_object(
            'is_demo', CASE WHEN o.type = 'view-only' THEN true ELSE false END,
            'is_personal', false
        )
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count > 1
    """)
    )

    # Step 5: Mark single-member orgs owned by that member as personal
    # NOTE: owner is String type, needs casting for comparison
    conn.execute(
        text("""
        UPDATE organizations o
        SET flags = jsonb_build_object(
            'is_demo', CASE WHEN o.type = 'view-only' THEN true ELSE false END,
            'is_personal', true
        )
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count = 1
        AND EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = o.id
            AND om.user_id::text = o.owner
        )
    """)
    )

    # Step 6: Mark remaining single-member orgs as collaborative (is_personal=false)
    conn.execute(
        text("""
        UPDATE organizations o
        SET flags = jsonb_build_object(
            'is_demo', CASE WHEN o.type = 'view-only' THEN true ELSE false END,
            'is_personal', false
        )
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count = 1
        AND (o.flags IS NULL OR o.flags = '{}'::jsonb)
    """)
    )

    # Step 7: Migrate owner (String) to owner_id (UUID)
    # Set owner_id = owner::uuid for existing orgs
    conn.execute(
        text("""
        UPDATE organizations
        SET owner_id = owner::uuid
        WHERE owner IS NOT NULL
    """)
    )

    # Step 8: Set created_by_id = owner_id for existing orgs
    conn.execute(
        text("""
        UPDATE organizations
        SET created_by_id = owner_id
        WHERE owner_id IS NOT NULL
    """)
    )

    # Step 9: Set updated_by_id = owner_id for existing orgs
    conn.execute(
        text("""
        UPDATE organizations
        SET updated_by_id = owner_id
        WHERE owner_id IS NOT NULL
    """)
    )

    # Step 10: Create missing personal organizations for users without one
    conn.execute(
        text("""
        INSERT INTO organizations (
            id,
            name,
            slug,
            description,
            owner,
            owner_id,
            created_at,
            created_by_id,
            updated_at,
            updated_by_id,
            flags
        )
        SELECT
            gen_random_uuid(),
            'Personal',
            NULL,
            NULL,
            u.id::text,
            u.id,
            NOW(),
            u.id,
            NOW(),
            u.id,
            '{"is_demo": false, "is_personal": true}'::jsonb
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.owner_id = u.id
            AND o.flags->>'is_personal' = 'true'
        )
    """)
    )

    # Step 10b: Add role column to organization_members
    op.add_column(
        "organization_members",
        sa.Column(
            "role",
            sa.String(),
            nullable=False,
            server_default="member",
        ),
    )

    # Step 10c: Set role='owner' for organization owners based on owner_id
    conn.execute(
        text("""
        UPDATE organization_members om
        SET role = 'owner'
        FROM organizations o
        WHERE om.organization_id = o.id
        AND om.user_id = o.owner_id
    """)
    )

    # Step 10d: Add LegacyLifecycle fields to organization_members
    op.add_column(
        "organization_members",
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "organization_members",
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "organization_members",
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
    )

    # Step 10e: Add updated_by_id to workspace_members
    op.add_column(
        "workspace_members",
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
    )

    # Step 10f: Add updated_by_id to project_members
    op.add_column(
        "project_members",
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
    )

    # Step 11: Add users as members to their new personal orgs
    conn.execute(
        text("""
        INSERT INTO organization_members (id, user_id, organization_id, role)
        SELECT
            gen_random_uuid(),
            o.owner_id,
            o.id,
            'owner'
        FROM organizations o
        WHERE o.flags->>'is_personal' = 'true'
        AND NOT EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = o.id
            AND om.user_id = o.owner_id
        )
    """)
    )

    # Step 12: Normalize personal organizations
    conn.execute(
        text("""
        UPDATE organizations
        SET
            name = 'Personal',
            slug = NULL
        WHERE flags->>'is_personal' = 'true'
    """)
    )

    # Step 13: Ensure any remaining orgs have flags set
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

    # Step 13b: Ensure all organizations have complete flag defaults
    # This ensures all auth and access control flags are set with defaults
    allow_email_default = "true" if env.auth.email_enabled else "false"
    allow_social_default = "true" if env.auth.oidc_enabled else "false"
    allow_sso_default = "false"
    allow_root_default = "false"

    conn.execute(
        text(f"""
        UPDATE organizations
        SET flags = flags ||
            jsonb_build_object(
                'allow_email', COALESCE((flags->>'allow_email')::boolean, {allow_email_default}),
                'allow_social', COALESCE((flags->>'allow_social')::boolean, {allow_social_default}),
                'allow_sso', COALESCE((flags->>'allow_sso')::boolean, {allow_sso_default}),
                'allow_root', COALESCE((flags->>'allow_root')::boolean, {allow_root_default}),
                'domains_only', COALESCE((flags->>'domains_only')::boolean, false),
                'auto_join', COALESCE((flags->>'auto_join')::boolean, false)
            )
        WHERE flags IS NOT NULL
    """)
    )

    # Step 13c: Add unique constraint: one personal org per owner
    op.create_index(
        "uq_organizations_owner_personal",
        "organizations",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("(flags->>'is_personal') = 'true'"),
    )

    # Clean up temp table
    conn.execute(text("DROP TABLE IF EXISTS org_member_counts"))

    # Step 14: Ensure created_at has a value for all existing records
    conn.execute(
        text("""
        UPDATE organizations
        SET created_at = COALESCE(created_at, NOW())
        WHERE created_at IS NULL
    """)
    )

    # Step 15: Make owner_id, created_by_id, and created_at NOT NULL; remove updated_at default
    op.alter_column("organizations", "owner_id", nullable=False)
    op.alter_column("organizations", "created_by_id", nullable=False)
    op.alter_column("organizations", "created_at", nullable=False)
    op.alter_column("organizations", "updated_at", server_default=None)

    # Step 16: Add foreign key constraints
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

    # Step 16b: Ensure organization_members cascade on organization delete
    op.drop_constraint(
        "organization_members_organization_id_fkey",
        "organization_members",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "organization_members_organization_id_fkey",
        "organization_members",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Step 16c: Ensure workspaces cascade on organization delete
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

    # Step 16c2: Ensure workspace_members cascade on workspace delete
    if _constraint_exists("workspace_members_workspace_id_fkey"):
        op.drop_constraint(
            "workspace_members_workspace_id_fkey",
            "workspace_members",
            type_="foreignkey",
        )
    if not _constraint_exists("workspace_members_workspace_id_fkey"):
        op.create_foreign_key(
            "workspace_members_workspace_id_fkey",
            "workspace_members",
            "workspaces",
            ["workspace_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Step 16d: Ensure projects cascade on organization delete
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

    # Step 17: Drop type and owner columns
    op.drop_column("organizations", "type")
    op.drop_column("organizations", "owner")

    # Step 18: Drop obsolete tables
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
    op.drop_constraint(
        "organization_members_organization_id_fkey",
        "organization_members",
        type_="foreignkey",
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

    # Restore organization_members FK without cascade
    op.create_foreign_key(
        "organization_members_organization_id_fkey",
        "organization_members",
        "organizations",
        ["organization_id"],
        ["id"],
    )

    # Restore workspaces FK without cascade
    op.drop_constraint(
        "workspaces_organization_id_fkey",
        "workspaces",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "workspaces_organization_id_fkey",
        "workspaces",
        "organizations",
        ["organization_id"],
        ["id"],
    )

    # Restore projects FK without cascade
    op.drop_constraint(
        "projects_organization_id_fkey",
        "projects",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "projects_organization_id_fkey",
        "projects",
        "organizations",
        ["organization_id"],
        ["id"],
    )

    # Drop unique constraint for personal orgs
    op.drop_index(
        "uq_organizations_owner_personal",
        table_name="organizations",
    )

    # Drop role column from organization_members
    op.drop_column("organization_members", "role")

    # Drop LegacyLifecycle columns from organization_members
    op.drop_column("organization_members", "updated_by_id")
    op.drop_column("organization_members", "updated_at")
    op.drop_column("organization_members", "created_at")

    # Drop updated_by_id from workspace_members
    op.drop_column("workspace_members", "updated_by_id")

    # Drop updated_by_id from project_members
    op.drop_column("project_members", "updated_by_id")

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
