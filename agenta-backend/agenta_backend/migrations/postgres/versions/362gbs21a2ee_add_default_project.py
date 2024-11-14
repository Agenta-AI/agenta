"""Add default project to database

Revision ID: 362gbs21a2ee
Revises: c5ae28e37102
Create Date: 2024-09-04 14:28:06.934841

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from agenta_backend.migrations.postgres.data_migrations.projects import (
    create_default_project,
    remove_default_project,
)


# revision identifiers, used by Alembic.
revision: str = "362gbs21a2ee"
down_revision: Union[str, None] = "c5ae28e37102"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom command ###
    create_default_project()
    # ### end custom command ###


def downgrade() -> None:
    # ### custom command ###
    remove_default_project()
    # ### end custom command ###
