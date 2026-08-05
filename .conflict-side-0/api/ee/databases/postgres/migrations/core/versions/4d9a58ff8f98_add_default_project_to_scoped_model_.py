"""add default project to scoped model entities

Revision ID: 4d9a58ff8f98
Revises: d0b8e05ca190
Create Date: 2024-09-17 07:16:57.740642

"""

from typing import Sequence, Union

from alembic import context

from ee.databases.postgres.migrations.core.data_migrations.projects import (
    add_project_id_to_db_entities,
    remove_project_id_from_db_entities,
    repair_evaluation_scenario_to_have_project_id,
    repair_evaluator_configs_to_have_project_id,
)


# revision identifiers, used by Alembic.
revision: str = "4d9a58ff8f98"
down_revision: Union[str, None] = "d0b8e05ca190"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom command ###
    connection = context.get_bind()  # get database connect from alembic context
    add_project_id_to_db_entities(session=connection)
    repair_evaluation_scenario_to_have_project_id(session=connection)
    repair_evaluator_configs_to_have_project_id(session=connection)
    repair_evaluation_scenario_to_have_project_id(session=connection)
    # ### end custom command ###


def downgrade() -> None:
    # ### custom command ###
    connection = context.get_bind()  # get database connect from alembic context
    remove_project_id_from_db_entities(session=connection)
    # ### end custom command ###
