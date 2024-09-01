"""Assign a default project to all existing apps after adding the 'project_id' column to the 'apps' table.

Revision ID: 3df0ehd312c1
Revises: 2f6bd6e0d582
Create Date: 2024-08-31 23:01:12.522990

"""

from typing import Sequence, Union

from agenta_backend.migrations.postgres.data_migrations.projects import (
    assign_default_project,
    revert_default_project,
)


# revision identifiers, used by Alembic.
revision: str = "3df0ehd312c1"
down_revision: Union[str, None] = "2f6bd6e0d582"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------- Assign default project to all existing apps -------- #
    assign_default_project()
    # -------- End assigning default project to all existing apps -------- #


def downgrade() -> None:
    # -------- Revert default project from all existing apps -------- #
    revert_default_project()
    # -------- End reverting default project from all existing apps --------
