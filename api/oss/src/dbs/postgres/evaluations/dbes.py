from sqlalchemy import (
    PrimaryKeyConstraint,
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA
from oss.src.dbs.postgres.evaluations.dbas import (
    EvaluationRunDBA,
    EvaluationScenarioDBA,
    EvaluationResultDBA,
    EvaluationMetricsDBA,
    EvaluationQueueDBA,
)


class EvaluationRunDBE(
    Base,
    ProjectScopeDBA,
    EvaluationRunDBA,
):
    __tablename__ = "evaluation_runs"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),  # for uniqueness
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),  # for project scope
        Index(
            "ix_evaluation_runs_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_runs_flags",
            "flags",
            postgresql_using="gin",
        ),  # for filtering§
        Index(
            "ix_evaluation_runs_tags",
            "tags",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_evaluation_runs_references",
            "references",
            postgresql_using="gin",
            postgresql_ops={"references": "jsonb_path_ops"},
        ),  # for filtering
    )


class EvaluationScenarioDBE(
    Base,
    ProjectScopeDBA,
    EvaluationScenarioDBA,
):
    __tablename__ = "evaluation_scenarios"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),  # for uniqueness
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "run_id"],
            ["evaluation_runs.project_id", "evaluation_runs.id"],
            ondelete="CASCADE",
        ),  # for project scope
        Index(
            "ix_evaluation_scenarios_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_scenarios_run_id",
            "run_id",
        ),  # for filtering
        Index(
            "ix_evaluation_scenarios_timestamp_interval",
            "timestamp",
            "interval",
        ),  # for filtering
        Index(
            "ix_evaluation_scenarios_flags",
            "flags",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_evaluation_scenarios_tags",
            "tags",
            postgresql_using="gin",
        ),  # for filtering
    )


class EvaluationResultDBE(
    Base,
    ProjectScopeDBA,
    EvaluationResultDBA,
):
    __tablename__ = "evaluation_results"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),  # for uniqueness
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "run_id"],
            ["evaluation_runs.project_id", "evaluation_runs.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "scenario_id"],
            ["evaluation_scenarios.project_id", "evaluation_scenarios.id"],
            ondelete="CASCADE",
        ),  # for project scope
        UniqueConstraint(
            "project_id",
            "run_id",
            "scenario_id",
            "step_key",
            "repeat_idx",
        ),  # for uniqueness
        Index(
            "ix_evaluation_results_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_results_run_id",
            "run_id",
        ),  # for filtering
        Index(
            "ix_evaluation_results_scenario_id",
            "scenario_id",
        ),  # for filtering
        Index(
            "ix_evaluation_results_step_key",
            "step_key",
        ),  # for filtering
        Index(
            "ix_evaluation_results_repeat_idx",
            "repeat_idx",
        ),  # for filtering
        Index(
            "ix_evaluation_results_timestamp_interval",
            "timestamp",
            "interval",
        ),  # for filtering
        Index(
            "ix_evaluation_results_flags",
            "flags",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_evaluation_results_tags",
            "tags",
            postgresql_using="gin",
        ),  # for filtering
    )


class EvaluationMetricsDBE(
    Base,
    ProjectScopeDBA,
    EvaluationMetricsDBA,
):
    __tablename__ = "evaluation_metrics"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),  # for uniqueness
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "run_id"],
            ["evaluation_runs.project_id", "evaluation_runs.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "scenario_id"],
            ["evaluation_scenarios.project_id", "evaluation_scenarios.id"],
            ondelete="CASCADE",
        ),  # for project scope
        UniqueConstraint(
            "project_id",
            "run_id",
            "scenario_id",
            "timestamp",
        ),  # for uniqueness
        Index(
            "ix_evaluation_metrics_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_metrics_run_id",
            "run_id",
        ),  # for filtering
        Index(
            "ix_evaluation_metrics_scenario_id",
            "scenario_id",
        ),  # for filtering
        Index(
            "ix_evaluation_metrics_timestamp_interval",
            "timestamp",
            "interval",
        ),  # for filtering
        Index(
            "ix_evaluation_metrics_flags",
            "flags",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_evaluation_metrics_tags",
            "tags",
            postgresql_using="gin",
        ),  # for filtering
    )


class EvaluationQueueDBE(
    Base,
    ProjectScopeDBA,
    EvaluationQueueDBA,
):
    __tablename__ = "evaluation_queues"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "id",
        ),  # for uniqueness
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),  # for project scope
        ForeignKeyConstraint(
            ["project_id", "run_id"],
            ["evaluation_runs.project_id", "evaluation_runs.id"],
            ondelete="CASCADE",
        ),  # for project scope
        Index(
            "ix_evaluation_queues_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_queues_run_id",
            "run_id",
        ),  # for filtering
        Index(
            "ix_evaluation_queues_flags",
            "flags",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_evaluation_queues_tags",
            "tags",
            postgresql_using="gin",
        ),  # for filtering
    )
