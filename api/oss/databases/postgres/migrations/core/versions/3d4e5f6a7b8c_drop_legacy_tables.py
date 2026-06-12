"""drop legacy app-centric tables

The pre-project app ecosystem (apps/variants/bases, deployments, old
environments, old testsets, old evaluations, ids_mapping) is dead code: the
routers were deleted and the data was migrated to the new entities earlier in
this chain. Dropping the tables is the schema-parity fix for the legacy
columns they carried.

Revision ID: 3d4e5f6a7b8c
Revises: 1b2c3d4e5f6a
Create Date: 2026-06-12 00:00:02.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3d4e5f6a7b8c"
down_revision: Union[str, None] = "1b2c3d4e5f6a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LEGACY_TABLES = (
    # old human-eval
    "human_evaluation_variants",
    "human_evaluations_scenarios",
    "human_evaluations",
    # old auto-eval
    "auto_evaluation_scenario_results",
    "auto_evaluation_aggregated_results",
    "auto_evaluation_evaluator_configs",
    "auto_evaluation_scenarios",
    "auto_evaluations",
    "auto_evaluator_configs",
    # old environments
    "environments_revisions",
    "environments",
    # apps/variants
    "app_variant_revisions",
    "app_variants",
    "bases",
    # deploy/infra
    "deployments",
    "docker_images",
    "templates",
    # apps root
    "app_db",
    # old testsets (superseded by testset_artifacts/_revisions/_variants)
    "testsets",
    # Mongo->Postgres migration artifact
    "ids_mapping",
)


def upgrade() -> None:
    for table in LEGACY_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    raise NotImplementedError(
        "Dropping the legacy app-centric tables is irreversible; restore from a backup."
    )
