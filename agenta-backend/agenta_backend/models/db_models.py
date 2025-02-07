from datetime import datetime, timezone

import uuid_utils.compat as uuid
from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    Boolean,
    ForeignKey,
    Enum,
)
from sqlalchemy.orm import relationship
from sqlalchemy_json import mutable_json_type
from sqlalchemy.dialects.postgresql import UUID, JSONB

from agenta_backend.dbs.postgres.shared.base import Base
from agenta_backend.models.shared_models import TemplateType, AppType


CASCADE_ALL_DELETE = "all, delete-orphan"


class UserDB(Base):
    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    uid = Column(String, unique=True, index=True, default="0")
    username = Column(String, default="agenta")
    email = Column(String, unique=True, default="demo@agenta.ai")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ProjectDB(Base):
    __tablename__ = "projects"

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

    image = relationship("ImageDB", cascade=CASCADE_ALL_DELETE, backref="project")
    app = relationship("AppDB", cascade=CASCADE_ALL_DELETE, backref="project")
    evaluator_config = relationship(
        "EvaluatorConfigDB", cascade=CASCADE_ALL_DELETE, backref="project"
    )
    testset = relationship("TestSetDB", cascade=CASCADE_ALL_DELETE, backref="project")


class ImageDB(Base):
    __tablename__ = "docker_images"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    type = Column(String, default="image")
    template_uri = Column(String, nullable=True)
    docker_id = Column(String, nullable=True, index=True)
    tags = Column(String, nullable=True)
    deletable = Column(Boolean, default=True)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppDB(Base):
    __tablename__ = "app_db"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    app_type = Column(Enum(AppType, name="app_type_enum"), nullable=True)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    modified_by = relationship("UserDB", foreign_keys=[modified_by_id])
    variant = relationship(
        "AppVariantDB", cascade=CASCADE_ALL_DELETE, back_populates="app"
    )
    deployment = relationship(
        "DeploymentDB", cascade=CASCADE_ALL_DELETE, back_populates="app"
    )
    evaluation = relationship("EvaluationDB", cascade=CASCADE_ALL_DELETE, backref="app")
    human_evaluation = relationship(
        "HumanEvaluationDB", cascade=CASCADE_ALL_DELETE, backref="app"
    )


class DeploymentDB(Base):
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    container_name = Column(String)
    container_id = Column(String)
    uri = Column(String)
    status = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project = relationship("ProjectDB")
    app = relationship("AppDB", back_populates="deployment")


class VariantBaseDB(Base):
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    base_name = Column(String)
    image_id = Column(
        UUID(as_uuid=True), ForeignKey("docker_images.id", ondelete="SET NULL")
    )
    deployment_id = Column(
        UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    app = relationship("AppDB")
    image = relationship("ImageDB")
    deployment = relationship("DeploymentDB")
    project = relationship("ProjectDB")


class AppVariantDB(Base):
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
    image_id = Column(
        UUID(as_uuid=True),
        ForeignKey("docker_images.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_name = Column(String)
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSONB, nested=True), nullable=False, default=dict
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    image = relationship("ImageDB")
    app = relationship("AppDB", back_populates="variant")
    project = relationship("ProjectDB")
    modified_by = relationship("UserDB", foreign_keys=[modified_by_id])
    base = relationship("VariantBaseDB")
    variant_revision = relationship(
        "AppVariantRevisionsDB",
        cascade=CASCADE_ALL_DELETE,
        backref="variant_revision",
    )


class AppVariantRevisionsDB(Base):
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
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    config_name = Column(String, nullable=False)
    config_parameters = Column(
        mutable_json_type(dbtype=JSONB, nested=True), nullable=False, default=dict
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project = relationship("ProjectDB")
    modified_by = relationship("UserDB")
    base = relationship("VariantBaseDB")

    def get_config(self) -> dict:
        return {"config_name": self.config_name, "parameters": self.config_parameters}


class AppEnvironmentDB(Base):
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
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

    project = relationship("ProjectDB")
    environment_revisions = relationship(
        "AppEnvironmentRevisionDB", cascade=CASCADE_ALL_DELETE, backref="environment"
    )
    deployed_app_variant = relationship("AppVariantDB")
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")


class AppEnvironmentRevisionDB(Base):
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

    project = relationship("ProjectDB")
    modified_by = relationship("UserDB")


class TemplateDB(Base):
    __tablename__ = "templates"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    type = Column(Enum(TemplateType), default=TemplateType.IMAGE, nullable=False)
    template_uri = Column(String)
    tag_id = Column(Integer)
    name = Column(String, unique=True)
    repo_name = Column(String)
    title = Column(String)
    description = Column(String)
    size = Column(Integer)
    digest = Column(String)  # sha256 hash of image digest
    last_pushed = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TestSetDB(Base):
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    csvdata = Column(mutable_json_type(dbtype=JSONB, nested=True))
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class EvaluatorConfigDB(Base):
    __tablename__ = "evaluators_configs"

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
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(mutable_json_type(dbtype=JSONB, nested=True), default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class HumanEvaluationVariantDB(Base):
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

    variant = relationship("AppVariantDB", backref="evaluation_variant")
    variant_revision = relationship(
        "AppVariantRevisionsDB", backref="evaluation_variant_revision"
    )


class HumanEvaluationDB(Base):
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

    testset = relationship("TestSetDB")
    evaluation_variant = relationship(
        "HumanEvaluationVariantDB",
        cascade=CASCADE_ALL_DELETE,
        backref="human_evaluation",
    )
    evaluation_scenario = relationship(
        "HumanEvaluationScenarioDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation_scenario",
    )


class HumanEvaluationScenarioDB(Base):
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
        mutable_json_type(dbtype=JSONB, nested=True)
    )  # List of HumanEvaluationScenarioInput
    outputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)
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


class EvaluationAggregatedResultDB(Base):
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
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result

    evaluator_config = relationship("EvaluatorConfigDB", backref="evaluator_config")


class EvaluationScenarioResultDB(Base):
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
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result


class EvaluationDB(Base):
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
    status = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result
    testset_id = Column(
        UUID(as_uuid=True), ForeignKey("testsets.id", ondelete="SET NULL")
    )
    variant_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variants.id", ondelete="SET NULL")
    )
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id", ondelete="SET NULL")
    )
    average_cost = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result
    total_cost = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result
    average_latency = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project = relationship("ProjectDB")
    testset = relationship("TestSetDB")
    variant = relationship("AppVariantDB")
    variant_revision = relationship("AppVariantRevisionsDB")
    aggregated_results = relationship(
        "EvaluationAggregatedResultDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation",
    )
    evaluation_scenarios = relationship(
        "EvaluationScenarioDB", cascade=CASCADE_ALL_DELETE, backref="evaluation"
    )
    evaluator_configs = relationship(
        "EvaluationEvaluatorConfigDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation",
    )


class EvaluationEvaluatorConfigDB(Base):
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


class EvaluationScenarioDB(Base):
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
        mutable_json_type(dbtype=JSONB, nested=True)
    )  # List of EvaluationScenarioInput
    outputs = Column(
        mutable_json_type(dbtype=JSONB, nested=True)
    )  # List of EvaluationScenarioOutput
    correct_answers = Column(
        mutable_json_type(dbtype=JSONB, nested=True)
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

    project = relationship("ProjectDB")
    variant = relationship("AppVariantDB")
    results = relationship(
        "EvaluationScenarioResultDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation_scenario",
    )


class IDsMappingDB(Base):
    __tablename__ = "ids_mapping"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    table_name = Column(String, nullable=False)
    objectid = Column(String, nullable=False)
    uuid = Column(UUID(as_uuid=True), nullable=False)
