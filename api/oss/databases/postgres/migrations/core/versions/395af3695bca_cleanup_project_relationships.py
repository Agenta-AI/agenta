"""Cleanup project relationships

Revision ID: 395af3695bca
Revises: baa02d66a365
Create Date: 2025-11-26 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "395af3695bca"
down_revision: Union[str, None] = "baa02d66a365"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES_WITHOUT_PROJECT_FK = ["api_keys", "nodes", "secrets"]

TABLES_WITH_PROJECT_ID_NULLABLE = [
    "app_db",
    "app_variant_revisions",
    "app_variants",
    "auto_evaluation_scenarios",
    "auto_evaluations",
    "auto_evaluator_configs",
    "bases",
    "deployments",
    "docker_images",
    "environments",
    "environments_revisions",
    "human_evaluations",
    "human_evaluations_scenarios",
    "project_invitations",
    "testsets",
]


def upgrade() -> None:
    conn = op.get_bind()
    uuid_type = postgresql.UUID()

    # 1) Delete any rows with project_id IS NULL in all project-scoped tables
    for table in TABLES_WITH_PROJECT_ID_NULLABLE:
        conn.execute(sa.text(f"DELETE FROM {table} WHERE project_id IS NULL"))

    # 2) Enforce NOT NULL on project_id for those tables
    for table in TABLES_WITH_PROJECT_ID_NULLABLE:
        op.alter_column(
            table,
            "project_id",
            existing_type=uuid_type,
            nullable=False,
        )

    # 3) Fix missing ON DELETE CASCADE on project_invitations
    op.drop_constraint(
        "project_invitations_project_id_fkey",
        "project_invitations",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_invitations_project_id_fkey",
        "project_invitations",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 4) Remove orphan rows that reference non-existent projects
    for table in TABLES_WITHOUT_PROJECT_FK:
        conn.execute(
            sa.text(
                f"""
                DELETE FROM {table} t
                WHERE NOT EXISTS (
                    SELECT 1 FROM projects p WHERE p.id = t.project_id
                )
                """
            )
        )

    # 5) Create FKs with ON DELETE CASCADE
    op.create_foreign_key(
        "nodes_project_id_fkey",
        "nodes",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_foreign_key(
        "secrets_project_id_fkey",
        "secrets",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    uuid_type = postgresql.UUID()

    # 1) Drop FKs again (schema-only rollback)
    op.drop_constraint("secrets_project_id_fkey", "secrets", type_="foreignkey")
    op.drop_constraint("nodes_project_id_fkey", "nodes", type_="foreignkey")

    # 2) Reverse FK CASCADE → NO ACTION
    op.drop_constraint(
        "project_invitations_project_id_fkey",
        "project_invitations",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_invitations_project_id_fkey",
        "project_invitations",
        "projects",
        ["project_id"],
        ["id"],
        ondelete=None,
    )

    # 3) Allow NULLs again on project_id (schema-only rollback)
    for table in TABLES_WITH_PROJECT_ID_NULLABLE:
        op.alter_column(
            table,
            "project_id",
            existing_type=uuid_type,
            nullable=True,
        )
