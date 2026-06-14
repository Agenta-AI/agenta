"""add membership tables and align account tables with the EE schema

Creates organization_members / workspace_members / project_members with the
exact shapes the EE database has (multi-org prerequisite, schema parity), and
fixes account-table drift: api_keys.project_id becomes NOT NULL, the duplicate
and misnamed FKs on projects are cleaned up, the redundant uq_projects_id is
dropped, and projects.organization_id / workspace_id become NOT NULL with the
workspace FK cascading (the shape the shared SQLAlchemy model declares).

Revision ID: 0a1b2c3d4e5f
Revises: b3c4d5e6f7a9
Create Date: 2026-06-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0a1b2c3d4e5f"
down_revision: Union[str, None] = "b3c4d5e6f7a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- MEMBERSHIP TABLES (shapes mirror the EE database verbatim) -------------
    op.create_table(
        "organization_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("organization_id", sa.UUID(), nullable=True),
        sa.Column("role", sa.String(), server_default="viewer", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("workspace_id", sa.UUID(), nullable=True),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "project_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("is_demo", sa.Boolean(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # -- API KEYS ---------------------------------------------------------------
    # Pre-project-scoping keys cannot authenticate any scope; drop them.
    op.execute("DELETE FROM api_keys WHERE project_id IS NULL")
    op.alter_column("api_keys", "project_id", existing_type=sa.UUID(), nullable=False)

    # -- PROJECTS ---------------------------------------------------------------
    # Duplicate org FK (SET NULL variant); projects_organization_id_fkey (CASCADE)
    # stays.
    op.drop_constraint("fk_projects_organization_id", "projects", type_="foreignkey")
    op.drop_constraint("fk_projects_workspace_id", "projects", type_="foreignkey")
    op.drop_constraint("uq_projects_id", "projects", type_="unique")

    op.execute(
        """
        UPDATE projects p SET organization_id = w.organization_id
        FROM workspaces w
        WHERE p.workspace_id = w.id AND p.organization_id IS NULL
        """
    )
    # Works with 0, 1, or N orgs: prefer the legacy singleton (slug backfilled
    # by f7a8b9c0d1e2, may be NULL on other orgs), else the oldest org. With
    # 0 orgs this is a no-op and the fresh-replay delete below applies.
    op.execute(
        """
        UPDATE projects SET organization_id = (
            SELECT id FROM organizations
            ORDER BY (slug = 'oss-default') DESC NULLS LAST, created_at
            LIMIT 1
        )
        WHERE organization_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE projects p SET workspace_id = (
            SELECT w.id FROM workspaces w
            WHERE w.organization_id = p.organization_id
            ORDER BY w.created_at LIMIT 1
        )
        WHERE p.workspace_id IS NULL
        """
    )

    # Fresh replays: 911e6034d05e seeds a default project before any
    # organization can exist (orgs are created by the app at signup, which
    # never ran). Seed-only projects are recreated per organization now, so
    # drop them; the user-less guard keeps real deployments failing loudly.
    op.execute(
        """
        DELETE FROM projects
        WHERE (organization_id IS NULL OR workspace_id IS NULL)
          AND NOT EXISTS (SELECT 1 FROM users)
        """
    )

    remaining = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM projects"
                " WHERE organization_id IS NULL OR workspace_id IS NULL"
            )
        )
        .scalar()
    )
    if remaining:
        raise RuntimeError(
            f"{remaining} projects rows still have NULL organization_id/workspace_id"
            " after backfill; resolve them manually before re-running this migration"
        )

    op.alter_column(
        "projects", "organization_id", existing_type=sa.UUID(), nullable=False
    )
    op.alter_column("projects", "workspace_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        "projects_workspace_id_fkey",
        "projects",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("projects_workspace_id_fkey", "projects", type_="foreignkey")
    op.alter_column("projects", "workspace_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column(
        "projects", "organization_id", existing_type=sa.UUID(), nullable=True
    )
    op.create_unique_constraint("uq_projects_id", "projects", ["id"])
    op.create_foreign_key(
        "fk_projects_workspace_id",
        "projects",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_projects_organization_id",
        "projects",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.alter_column("api_keys", "project_id", existing_type=sa.UUID(), nullable=True)

    op.drop_table("project_members")
    op.drop_table("workspace_members")
    op.drop_table("organization_members")
