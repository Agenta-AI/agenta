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
    EvaluationStepDBA,
    EvaluationMetricDBA,
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
    )


class EvaluationStepDBE(
    Base,
    ProjectScopeDBA,
    EvaluationStepDBA,
):
    __tablename__ = "evaluation_steps"

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
            "key",
            "retry_id",
            "retry_id",
        ),  # for uniqueness
        Index(
            "ix_evaluation_steps_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_evaluation_steps_run_id",
            "run_id",
        ),  # for filtering
        Index(
            "ix_evaluation_steps_scenario_id",
            "scenario_id",
        ),  # for filtering
    )


class EvaluationMetricDBE(
    Base,
    ProjectScopeDBA,
    EvaluationMetricDBA,
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
    )
