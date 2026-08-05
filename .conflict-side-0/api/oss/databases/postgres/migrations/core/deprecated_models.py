from datetime import datetime, timezone

import uuid_utils.compat as uuid
from sqlalchemy.orm import declarative_base
from sqlalchemy_json import mutable_json_type
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import (
    Column,
    String,
    DateTime,
    ForeignKey,
    Boolean,
    Integer,
    Enum,
    JSON,
    Table,
)

from oss.src.models.shared_models import AppType


DeprecatedBase = declarative_base()
AltDeprecatedBase = declarative_base()

# Final shapes of the legacy app-centric tables dropped in 3d4e5f6a7b8c /
# 4e5f6a7b8c9d, frozen here because earlier migrations still query them.
# Separate base: extend_existing on DeprecatedBase would merge these columns
# into the older partial shapes above.
DroppedBase = declarative_base()

# FK targets referenced by the frozen classes; the ORM resolves them from this
# metadata at flush time (the live tables are mapped elsewhere).
Table(
    "projects", DroppedBase.metadata, Column("id", UUID(as_uuid=True), primary_key=True)
)
Table("users", DroppedBase.metadata, Column("id", UUID(as_uuid=True), primary_key=True))
Table(
    "folders", DroppedBase.metadata, Column("id", UUID(as_uuid=True), primary_key=True)
)


class ProjectScopedAppDB(DeprecatedBase):
    __tablename__ = "app_db"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )


class DeprecatedOrganizationDB(DeprecatedBase):
    __tablename__ = "organizations"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String, default="agenta")
    description = Column(
        String,
        default="The open-source LLM developer platform for cross-functional teams.",
    )
    type = Column(String, nullable=True)
    owner = Column(String, nullable=True)  # TODO: deprecate and remove
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedAppDB(DeprecatedBase):
    __tablename__ = "app_db"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedTestsetDB(DeprecatedBase):
    __tablename__ = "testsets"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    csvdata = Column(mutable_json_type(dbtype=JSONB, nested=True))
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedAppVariantDB(DeprecatedBase):
    __tablename__ = "app_variants"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    variant_name = Column(String)
    revision = Column(Integer)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_name = Column(String)
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSONB, nested=True),  # type: ignore
        nullable=False,
        default=dict,
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedAppVariantRevisionsDB(DeprecatedBase):
    __tablename__ = "app_variant_revisions"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="CASCADE")
    )
    revision = Column(Integer)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSONB, nested=True),  # type: ignore
        nullable=False,
        default=dict,
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedAppEnvironmentRevisionDB(DeprecatedBase):
    __tablename__ = "environments_revisions"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    environment_id = Column(
        UUID(as_uuid=True), ForeignKey("environments.id", ondelete="CASCADE")
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    revision = Column(Integer)
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )
    deployment_id = Column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedEvaluatorConfigDBwApp(AltDeprecatedBase):
    __tablename__ = "evaluators_configs"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )

    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="SET NULL"))
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(mutable_json_type(dbtype=JSONB, nested=True), default=dict)  # type: ignore
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedEvaluatorConfigDBwProject(DeprecatedBase):
    __tablename__ = "evaluators_configs"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )

    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(mutable_json_type(dbtype=JSONB, nested=True), default=dict)  # type: ignore
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )


class DeprecatedAutoEvaluatorConfigDBwProject(DeprecatedBase):
    __tablename__ = "auto_evaluator_configs"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )

    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(mutable_json_type(dbtype=JSONB, nested=True), default=dict)  # type: ignore
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )


class DeprecatedProjectDB(DeprecatedBase):
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    project_name = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedHumanEvaluationVariantDB(DeprecatedBase):
    __tablename__ = "human_evaluation_variants"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    human_evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("human_evaluations.id", ondelete="CASCADE")
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="SET NULL")
    )
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )


class DeprecatedHumanEvaluationDB(DeprecatedBase):
    __tablename__ = "human_evaluations"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    status = Column(String)
    evaluation_type = Column(String)
    testset_id = Column(UUID(as_uuid=True), ForeignKey("testsets.id"))
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedHumanEvaluationScenarioDB(DeprecatedBase):
    __tablename__ = "human_evaluations_scenarios"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("human_evaluations.id", ondelete="CASCADE")
    )
    inputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)  # type: ignore
    )  # List of HumanEvaluationScenarioInput
    outputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)  # type: ignore
    )  # List of HumanEvaluationScenarioOutput
    vote = Column(String)
    score = Column(String)
    correct_answer = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_pinned = Column(Boolean)
    note = Column(String)


class DeprecatedEvaluationAggregatedResultDB(DeprecatedBase):
    __tablename__ = "evaluation_aggregated_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluations.id", ondelete="CASCADE")
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluators_configs.id", ondelete="SET NULL")
    )
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # type: ignore # Result


class DeprecatedEvaluationScenarioResultDB(DeprecatedBase):
    __tablename__ = "evaluation_scenario_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_scenario_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluation_scenarios.id", ondelete="CASCADE")
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluators_configs.id", ondelete="SET NULL")
    )
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # type: ignore # Result


class DeprecatedEvaluationDB(DeprecatedBase):
    __tablename__ = "evaluations"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    status = Column(mutable_json_type(dbtype=JSONB, nested=True))  # type: ignore # Result
    testset_id = Column(
        UUID(as_uuid=True), ForeignKey("testsets.id", ondelete="SET NULL")
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="SET NULL")
    )
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )
    average_cost = Column(mutable_json_type(dbtype=JSONB, nested=True))  # type: ignore #  Result
    total_cost = Column(mutable_json_type(dbtype=JSONB, nested=True))  # type: ignore #  Result
    average_latency = Column(mutable_json_type(dbtype=JSONB, nested=True))  #  type: ignore # Result
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeprecatedEvaluationEvaluatorConfigDB(DeprecatedBase):
    __tablename__ = "evaluation_evaluator_configs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("evaluations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("evaluators_configs.id", ondelete="SET NULL"),
        primary_key=True,
    )


class DeprecatedEvaluationScenarioDB(DeprecatedBase):
    __tablename__ = "evaluation_scenarios"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluations.id", ondelete="CASCADE")
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="SET NULL")
    )
    inputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)  # type: ignore
    )  # List of EvaluationScenarioInput
    outputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)  # type: ignore
    )  # List of EvaluationScenarioOutput
    correct_answers = Column(
        mutable_json_type(dbtype=JSONB, nested=True)  # type: ignore
    )  # List of CorrectAnswer
    is_pinned = Column(Boolean)
    note = Column(String)
    latency = Column(Integer)
    cost = Column(Integer)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppDB(DroppedBase):
    __tablename__ = "app_db"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    app_type = Column(Enum(AppType, name="app_type_enum"), nullable=True)  # type: ignore
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    folder_id = Column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DeploymentDB(DroppedBase):
    __tablename__ = "deployments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    uri = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class VariantBaseDB(DroppedBase):
    __tablename__ = "bases"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    base_name = Column(String)
    deployment_id = Column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppVariantDB(DroppedBase):
    __tablename__ = "app_variants"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    variant_name = Column(String)
    revision = Column(Integer)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_name = Column(String)
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSON, nested=True),  # type: ignore
        nullable=False,
        default=dict,
    )
    hidden = Column(Boolean, nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppVariantRevisionsDB(DroppedBase):
    __tablename__ = "app_variant_revisions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="CASCADE")
    )
    revision = Column(Integer)
    commit_message = Column(String(length=255), nullable=True)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    hidden = Column(Boolean, nullable=True)
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSON, nested=True),  # type: ignore
        nullable=False,
        default=dict,
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppEnvironmentDB(DroppedBase):
    __tablename__ = "environments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id", ondelete="CASCADE"))
    name = Column(String)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision = Column(Integer)
    deployed_app_variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="SET NULL")
    )
    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )
    deployment_id = Column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppEnvironmentRevisionDB(DroppedBase):
    __tablename__ = "environments_revisions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    environment_id = Column(
        UUID(as_uuid=True), ForeignKey("environments.id", ondelete="CASCADE")
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision = Column(Integer)
    commit_message = Column(String(length=255), nullable=True)
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )
    deployment_id = Column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TestsetDB(DroppedBase):
    __tablename__ = "testsets"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    csvdata = Column(mutable_json_type(dbtype=JSONB, nested=True))
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class EvaluatorConfigDB(DroppedBase):
    __tablename__ = "auto_evaluator_configs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )

    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(mutable_json_type(dbtype=JSONB, nested=True), default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
