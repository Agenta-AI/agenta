"""align account tables with the shared SQLAlchemy model (schema parity)

api_keys.created_by_id becomes nullable (no FK: lifecycle actor columns stay
loose by convention; OSS drops its legacy FK in the cleanup migration), and
projects.organization_id / workspace_id become NOT NULL with the workspace FK
cascading.

Revision ID: 2c3d4e5f6a7b
Revises: b3c4d5e6f7a9
Create Date: 2026-06-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "2c3d4e5f6a7b"
down_revision: Union[str, None] = "b3c4d5e6f7a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- API KEYS ---------------------------------------------------------------
    op.alter_column("api_keys", "created_by_id", existing_type=sa.UUID(), nullable=True)

    # -- PROJECTS ---------------------------------------------------------------
    op.drop_constraint("projects_workspace_id_fkey", "projects", type_="foreignkey")
    op.create_foreign_key(
        "projects_workspace_id_fkey",
        "projects",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.execute(
        """
        UPDATE projects p SET organization_id = w.organization_id
        FROM workspaces w
        WHERE p.workspace_id = w.id AND p.organization_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE projects p SET organization_id = (
            SELECT om.organization_id
            FROM project_members pm
            JOIN organization_members om ON om.user_id = pm.user_id
            WHERE pm.project_id = p.id AND om.organization_id IS NOT NULL
            LIMIT 1
        )
        WHERE p.organization_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE projects p SET workspace_id = (
            SELECT w.id FROM workspaces w
            WHERE w.organization_id = p.organization_id
            ORDER BY w.created_at LIMIT 1
        )
        WHERE p.workspace_id IS NULL AND p.organization_id IS NOT NULL
        """
    )

    # Fresh replays: the chain seeds a default project before any organization
    # can exist (orgs are created by the app at signup, which never ran).
    # Seed-only projects are recreated per organization, so drop them; the
    # user-less guard keeps real deployments failing loudly.
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


def downgrade() -> None:
    op.alter_column("projects", "workspace_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column(
        "projects", "organization_id", existing_type=sa.UUID(), nullable=True
    )
    op.drop_constraint("projects_workspace_id_fkey", "projects", type_="foreignkey")
    op.create_foreign_key(
        "projects_workspace_id_fkey",
        "projects",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute("DELETE FROM api_keys WHERE created_by_id IS NULL")
    op.alter_column(
        "api_keys", "created_by_id", existing_type=sa.UUID(), nullable=False
    )
