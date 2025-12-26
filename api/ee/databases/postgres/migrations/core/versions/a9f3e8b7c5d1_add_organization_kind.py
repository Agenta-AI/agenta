"""add organization kind

Revision ID: a9f3e8b7c5d1
Revises: 7990f1e12f47
Create Date: 2025-12-26 00:00:00.000000

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import select, update, func, text
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9f3e8b7c5d1"
down_revision: Union[str, None] = "7990f1e12f47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add organization kind column and migrate existing data.

    EE Mode:
    - Organizations with >1 member → collaborative
    - Organizations with =1 member and user owns it → personal
    - Create missing personal orgs for users without one
    - Normalize names: personal orgs → "Personal", slug → NULL

    OSS Mode:
    - Must have exactly 1 organization (fail-fast if not)
    - Set kind = collaborative
    - No personal organizations created
    """
    conn = op.get_bind()

    # Check if we're in OSS or EE mode by checking for license env var
    # This is a simplification - in practice, check deployment metadata
    is_ee = True  # TODO: Determine from env or config

    # Step 1: Add kind column (temporarily nullable)
    op.add_column("organizations", sa.Column("kind", sa.String(), nullable=True))

    # Step 2: OSS-specific validation and migration
    if not is_ee:
        # OSS: Must have exactly 1 organization
        org_count = conn.execute(text("SELECT COUNT(*) FROM organizations")).scalar()

        if org_count == 0:
            raise ValueError("OSS mode: No organizations found. Cannot proceed with migration.")
        elif org_count > 1:
            raise ValueError(
                f"OSS mode: Found {org_count} organizations. OSS supports exactly 1 collaborative organization. "
                "Please consolidate organizations before migrating."
            )

        # Set the single organization to collaborative
        conn.execute(
            text("UPDATE organizations SET kind = 'collaborative' WHERE kind IS NULL")
        )

        # Make kind NOT NULL
        op.alter_column("organizations", "kind", nullable=False)

        # Create indexes
        op.create_index("ix_organizations_kind", "organizations", ["kind"])

        return

    # Step 3: EE-specific migration
    # Get member counts for all organizations
    conn.execute(text("""
        CREATE TEMP TABLE org_member_counts AS
        SELECT
            o.id as org_id,
            COUNT(om.id) as member_count,
            o.owner as owner_id
        FROM organizations o
        LEFT JOIN organization_members om ON om.organization_id = o.id
        GROUP BY o.id, o.owner
    """))

    # Step 4: Mark multi-member orgs as collaborative
    conn.execute(text("""
        UPDATE organizations o
        SET kind = 'collaborative'
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count > 1
    """))

    # Step 5: Mark single-member orgs owned by that member as personal
    # This requires checking if the sole member is also the owner
    conn.execute(text("""
        UPDATE organizations o
        SET kind = 'personal'
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count = 1
        AND EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = o.id
            AND om.user_id = o.owner
        )
    """))

    # Step 6: Mark remaining single-member orgs as collaborative
    # (cases where owner is not a member, or other edge cases)
    conn.execute(text("""
        UPDATE organizations o
        SET kind = 'collaborative'
        FROM org_member_counts omc
        WHERE o.id = omc.org_id
        AND omc.member_count = 1
        AND o.kind IS NULL
    """))

    # Step 7: Create missing personal organizations for users without one
    # Get users who don't have a personal org
    conn.execute(text("""
        INSERT INTO organizations (id, name, slug, description, type, owner, created_at, updated_at, kind)
        SELECT
            gen_random_uuid(),
            'Personal',
            NULL,
            NULL,
            'default',  -- Assuming 'default' is a valid type
            u.id,
            NOW(),
            NOW(),
            'personal'
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.owner = u.id
            AND o.kind = 'personal'
        )
    """))

    # Step 8: Add users as members to their new personal orgs
    conn.execute(text("""
        INSERT INTO organization_members (id, user_id, organization_id, role, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            o.owner,
            o.id,
            'owner',  -- Assuming 'owner' is a valid role
            NOW(),
            NOW()
        FROM organizations o
        WHERE o.kind = 'personal'
        AND NOT EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = o.id
            AND om.user_id = o.owner
        )
    """))

    # Step 9: Normalize personal organizations
    conn.execute(text("""
        UPDATE organizations
        SET
            name = 'Personal',
            slug = NULL
        WHERE kind = 'personal'
    """))

    # Step 10: Ensure collaborative orgs have slug = NULL (initial state)
    conn.execute(text("""
        UPDATE organizations
        SET slug = NULL
        WHERE kind = 'collaborative'
        AND slug IS NULL
    """))

    # Clean up temp table
    conn.execute(text("DROP TABLE IF EXISTS org_member_counts"))

    # Step 11: Make kind NOT NULL
    op.alter_column("organizations", "kind", nullable=False)

    # Step 12: Create indexes
    op.create_index("ix_organizations_kind", "organizations", ["kind"])

    # Step 13: Add check constraint
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
