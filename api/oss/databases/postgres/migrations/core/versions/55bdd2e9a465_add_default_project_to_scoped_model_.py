"""add default project to scoped model entities

Revision ID: 55bdd2e9a465
Revises: c00a326c625a
Create Date: 2024-09-12 21:56:38.701088

"""

from typing import Sequence, Union


from oss.databases.postgres.migrations.core.data_migrations.projects import (
    add_project_id_to_db_entities,
    remove_project_id_from_db_entities,
)


# revision identifiers, used by Alembic.
revision: str = "55bdd2e9a465"
down_revision: Union[str, None] = "c00a326c625a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom command ###
    add_project_id_to_db_entities()
    # ### end custom command ###


def downgrade() -> None:
    # ### custom command ###
    remove_project_id_from_db_entities()
    # ### end custom command ###
