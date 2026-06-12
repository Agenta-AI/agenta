"""drop legacy app-centric tables

Same drop as the OSS chain (the chains are independent). EE must archive
these tables before this lands in cloud: they also carry the legacy
organization_id/workspace_id columns whose removal is the parity fix.

Revision ID: 4e5f6a7b8c9d
Revises: 2c3d4e5f6a7b
Create Date: 2026-06-12 00:00:02.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4e5f6a7b8c9d"
down_revision: Union[str, None] = "2c3d4e5f6a7b"
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
