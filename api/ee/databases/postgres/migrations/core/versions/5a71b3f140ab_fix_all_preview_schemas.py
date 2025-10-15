"""fix all preview schemas

Revision ID: 5a71b3f140ab
Revises: 8089ee7692d1
Create Date: 2025-09-03 14:28:06.362553

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "5a71b3f140ab"
down_revision: Union[str, None] = "8089ee7692d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # EVALUATION RUNS ----------------------------------------------------------

    op.add_column(
        "evaluation_runs",
        sa.Column(
            "references",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_evaluation_runs_references",
        "evaluation_runs",
        ["references"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"references": "jsonb_path_ops"},
    )
    op.create_index(
        "ix_evaluation_runs_flags",
        "evaluation_runs",
        ["flags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_runs_tags",
        "evaluation_runs",
        ["tags"],
        unique=False,
        postgresql_using="gin",
    )

    # EVALUATION SCENARIOS -----------------------------------------------------

    op.add_column(
        "evaluation_scenarios",
        sa.Column(
            "interval",
            postgresql.INTEGER(),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_evaluation_scenarios_timestamp_interval",
        "evaluation_scenarios",
        ["timestamp", "interval"],
        unique=False,
    )
    op.create_index(
        "ix_evaluation_scenarios_flags",
        "evaluation_scenarios",
        ["flags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_scenarios_tags",
        "evaluation_scenarios",
        ["tags"],
        unique=False,
        postgresql_using="gin",
    )

    # EVALUATION RESULTS -------------------------------------------------------

    op.alter_column(
        "evaluation_steps",
        "timestamp",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=True,
    )
    op.add_column(
        "evaluation_steps",
        sa.Column(
            "interval",
            postgresql.INTEGER(),
            nullable=True,
        ),
    )

    op.create_unique_constraint(
        "uq_evaluation_steps_project_run_scenario_step_repeat",
        "evaluation_steps",
        ["project_id", "run_id", "scenario_id", "step_key", "repeat_idx"],
    )

    op.create_index(
        "ix_evaluation_steps_tags",
        "evaluation_steps",
        ["tags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_steps_flags",
        "evaluation_steps",
        ["flags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_steps_timestamp_interval",
        "evaluation_steps",
        ["timestamp", "interval"],
        unique=False,
    )
    op.create_index(
        "ix_evaluation_steps_repeat_idx",
        "evaluation_steps",
        ["repeat_idx"],
        unique=False,
    )
    op.create_index(
        "ix_evaluation_steps_step_key",
        "evaluation_steps",
        ["step_key"],
        unique=False,
    )

    op.rename_table("evaluation_steps", "evaluation_results")

    op.execute(
        "ALTER TABLE evaluation_results RENAME CONSTRAINT "
        "uq_evaluation_steps_project_run_scenario_step_repeat TO "
        "uq_evaluation_results_project_run_scenario_step_repeat"
    )

    op.execute(
        "ALTER INDEX ix_evaluation_steps_project_id RENAME TO ix_evaluation_results_project_id"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_run_id RENAME TO ix_evaluation_results_run_id"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_scenario_id RENAME TO ix_evaluation_results_scenario_id"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_step_key RENAME TO ix_evaluation_results_step_key"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_repeat_idx RENAME TO ix_evaluation_results_repeat_idx"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_timestamp_interval RENAME TO ix_evaluation_results_timestamp_interval"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_flags RENAME TO ix_evaluation_results_flags"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_steps_tags RENAME TO ix_evaluation_results_tags"
    )

    # EVALUATION METRICS -------------------------------------------------------

    op.add_column(
        "evaluation_metrics",
        sa.Column(
            "interval",
            postgresql.INTEGER(),
            nullable=True,
        ),
    )

    op.drop_constraint(
        op.f("evaluation_metrics_project_id_run_id_scenario_id_key"),
        "evaluation_metrics",
        type_="unique",
    )

    op.create_unique_constraint(
        "uq_evaluation_metrics_project_run_scenario_timestamp_interval",
        "evaluation_metrics",
        ["project_id", "run_id", "scenario_id", "timestamp", "interval"],
    )

    op.create_index(
        "ix_evaluation_metrics_timestamp_interval",
        "evaluation_metrics",
        ["timestamp", "interval"],
        unique=False,
    )
    op.create_index(
        "ix_evaluation_metrics_flags",
        "evaluation_metrics",
        ["flags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_metrics_tags",
        "evaluation_metrics",
        ["tags"],
        unique=False,
        postgresql_using="gin",
    )

    # EVALUATION QUEUES --------------------------------------------------------

    op.add_column(
        "evaluation_queues",
        sa.Column(
            "name",
            sa.String(),
            nullable=True,
        ),
    )
    op.add_column(
        "evaluation_queues",
        sa.Column(
            "description",
            sa.String(),
            nullable=True,
        ),
    )
    op.add_column(
        "evaluation_queues",
        sa.Column(
            "status",
            sa.VARCHAR(),
            nullable=False,
            server_default=sa.text("'pending'::varchar"),
        ),
    )

    op.create_index(
        "ix_evaluation_queues_flags",
        "evaluation_queues",
        ["flags"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_evaluation_queues_tags",
        "evaluation_queues",
        ["tags"],
        unique=False,
        postgresql_using="gin",
    )

    # --------------------------------------------------------------------------


def downgrade() -> None:
    # EVALUATION QUEUES --------------------------------------------------------

    op.drop_index(
        "ix_evaluation_queues_tags",
        table_name="evaluation_queues",
    )
    op.drop_index(
        "ix_evaluation_queues_flags",
        table_name="evaluation_queues",
    )

    op.drop_column(
        "evaluation_queues",
        "status",
    )
    op.drop_column(
        "evaluation_queues",
        "description",
    )
    op.drop_column(
        "evaluation_queues",
        "name",
    )

    # EVALUATION METRICS -------------------------------------------------------

    op.drop_index(
        "ix_evaluation_metrics_tags",
        table_name="evaluation_metrics",
    )
    op.drop_index(
        "ix_evaluation_metrics_flags",
        table_name="evaluation_metrics",
    )
    op.drop_index(
        "ix_evaluation_metrics_timestamp_interval",
        table_name="evaluation_metrics",
    )

    op.drop_constraint(
        "uq_evaluation_metrics_project_run_scenario_timestamp_interval",
        "evaluation_metrics",
        type_="unique",
    )

    op.create_unique_constraint(
        op.f("evaluation_metrics_project_id_run_id_scenario_id_key"),
        "evaluation_metrics",
        ["project_id", "run_id", "scenario_id"],
        postgresql_nulls_not_distinct=False,
    )

    op.drop_column("evaluation_metrics", "interval")

    # EVALUATION RESULTS -------------------------------------------------------

    op.execute(
        "ALTER INDEX ix_evaluation_results_tags RENAME TO ix_evaluation_steps_tags"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_flags RENAME TO ix_evaluation_steps_flags"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_timestamp_interval RENAME TO ix_evaluation_steps_timestamp_interval"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_repeat_idx RENAME TO ix_evaluation_steps_repeat_idx"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_step_key RENAME TO ix_evaluation_steps_step_key"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_scenario_id RENAME TO ix_evaluation_steps_scenario_id"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_run_id RENAME TO ix_evaluation_steps_run_id"
    )
    op.execute(
        "ALTER INDEX ix_evaluation_results_project_id RENAME TO ix_evaluation_steps_project_id"
    )

    op.execute(
        "ALTER TABLE evaluation_results RENAME CONSTRAINT uq_evaluation_results_project_run_scenario_step_repeat "
        "TO uq_evaluation_steps_project_run_scenario_step_repeat"
    )

    op.rename_table("evaluation_results", "evaluation_steps")

    op.drop_index(
        "ix_evaluation_steps_tags",
        table_name="evaluation_steps",
    )
    op.drop_index(
        "ix_evaluation_steps_flags",
        table_name="evaluation_steps",
    )
    op.drop_index(
        "ix_evaluation_steps_timestamp_interval",
        table_name="evaluation_steps",
    )
    op.drop_index(
        "ix_evaluation_steps_repeat_idx",
        table_name="evaluation_steps",
    )
    op.drop_index(
        "ix_evaluation_steps_step_key",
        table_name="evaluation_steps",
    )

    op.drop_constraint(
        "uq_evaluation_steps_project_run_scenario_step_repeat",
        "evaluation_steps",
        type_="unique",
    )

    op.alter_column(
        "evaluation_steps",
        "timestamp",
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=False,
    )

    op.drop_column("evaluation_steps", "interval")

    # EVALUATION SCENARIOS -----------------------------------------------------

    op.drop_index(
        "ix_evaluation_scenarios_tags",
        table_name="evaluation_scenarios",
    )
    op.drop_index(
        "ix_evaluation_scenarios_flags",
        table_name="evaluation_scenarios",
    )
    op.drop_index(
        "ix_evaluation_scenarios_timestamp_interval",
        table_name="evaluation_scenarios",
    )

    op.drop_column("evaluation_scenarios", "interval")

    # EVALUATION RUNS ----------------------------------------------------------

    op.drop_index(
        "ix_evaluation_runs_tags",
        table_name="evaluation_runs",
    )
    op.drop_index(
        "ix_evaluation_runs_flags",
        table_name="evaluation_runs",
    )
    op.drop_index(
        "ix_evaluation_runs_references",
        table_name="evaluation_runs",
    )

    op.drop_column("evaluation_runs", "references")

    # --------------------------------------------------------------------------
