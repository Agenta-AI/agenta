"""add folder_id column to workflow_artifacts table

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


def upgrade() -> None:
    # Add folder_id column to workflow_artifacts
    op.add_column(
        "workflow_artifacts",
        sa.Column("folder_id", sa.UUID(), nullable=True),
    )

    # Add foreign key constraint
    op.create_foreign_key(
        "fk_workflow_artifacts_folder_id_folders",
        "workflow_artifacts",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Add index for folder_id
    op.create_index(
        "ix_workflow_artifacts_folder_id",
        "workflow_artifacts",
        ["folder_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_workflow_artifacts_folder_id", table_name="workflow_artifacts")
    op.drop_constraint(
        "fk_workflow_artifacts_folder_id_folders",
        "workflow_artifacts",
        type_="foreignkey",
    )
    op.drop_column("workflow_artifacts", "folder_id")
