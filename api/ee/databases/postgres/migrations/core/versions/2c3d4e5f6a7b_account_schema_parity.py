"""align account tables with the shared SQLAlchemy model (schema parity)

api_keys.created_by_id becomes nullable with an ON DELETE SET NULL FK to users
(the model's shape; OSS already has both), and projects.organization_id /
workspace_id become NOT NULL with the workspace FK cascading.

Revision ID: 2c3d4e5f6a7b
Revises: a2b3c4d5e6f8
Create Date: 2026-06-12 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "2c3d4e5f6a7b"
down_revision: Union[str, None] = "a2b3c4d5e6f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- API KEYS ---------------------------------------------------------------
    op.alter_column("api_keys", "created_by_id", existing_type=sa.UUID(), nullable=True)
    # NOT VALID first so the ADD takes no long lock on a large table.
    op.execute(
        "ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_id_fkey"
        " FOREIGN KEY (created_by_id) REFERENCES users(id)"
        " ON DELETE SET NULL NOT VALID"
    )
    op.execute(
        """
        UPDATE api_keys SET created_by_id = NULL
        WHERE created_by_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = created_by_id)
        """
    )
    op.execute("ALTER TABLE api_keys VALIDATE CONSTRAINT api_keys_created_by_id_fkey")

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

    op.drop_constraint("api_keys_created_by_id_fkey", "api_keys", type_="foreignkey")
    op.execute("DELETE FROM api_keys WHERE created_by_id IS NULL")
    op.alter_column(
        "api_keys", "created_by_id", existing_type=sa.UUID(), nullable=False
    )
