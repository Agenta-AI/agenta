"""add folder_id column to artifact tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-01-21 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ARTIFACT_TABLES = [
    "workflow_artifacts",
    "testset_artifacts",
    "query_artifacts",
]


def upgrade() -> None:
    for table in ARTIFACT_TABLES:
        op.add_column(
            table,
            sa.Column("folder_id", sa.UUID(), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_folder_id_folders",
            table,
            "folders",
            ["folder_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            f"ix_{table}_folder_id",
            table,
            ["folder_id"],
        )


def downgrade() -> None:
    for table in ARTIFACT_TABLES:
        op.drop_index(f"ix_{table}_folder_id", table_name=table)
        op.drop_constraint(
            f"fk_{table}_folder_id_folders",
            table,
            type_="foreignkey",
        )
        op.drop_column(table, "folder_id")
