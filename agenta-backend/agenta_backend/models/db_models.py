from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    Boolean,
    ForeignKey,
    Float,
)
from sqlalchemy.orm import relationship, declarative_base
import uuid_utils.compat as uuid
from sqlalchemy.dialects.postgresql import UUID, JSONB

Base = declarative_base()


class UserDB(Base):
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

    __tablename__ = "users"


# TODO: Rename ImageDB to DockerImageDB ?
class ImageDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    type = Column(String, default="image")
    template_uri = Column(String)
    docker_id = Column(String, index=True)
    tags = Column(String)
    deletable = Column(Boolean, default=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "docker_images"


class AppDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_name = Column(String)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "app_db"


class DeploymentDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
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

    __tablename__ = "deployments"


class VariantBaseDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    base_name = Column(String)
    image_id = Column(UUID(as_uuid=True), ForeignKey("docker_images.id"))
    image = relationship("ImageDB")

    deployment_id = Column(UUID(as_uuid=True), ForeignKey("deployments.id"))
    deployment = relationship("DeploymentDB")

    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "bases"


class AppVariantDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    variant_name = Column(String)
    revision = Column(Integer)
    image_id = Column(UUID(as_uuid=True), ForeignKey("docker_images.id"))
    image = relationship("ImageDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB", foreign_keys=[user_id])
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    modified_by = relationship("UserDB", foreign_keys=[modified_by_id])
    base_name = Column(String)
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    base = relationship("VariantBaseDB")
    config_name = Column(String, nullable=False)
    config_parameters = Column(JSONB, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "app_variants"


class AppVariantRevisionsDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    revision = Column(Integer)
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    modified_by = relationship("UserDB")
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    base = relationship("VariantBaseDB")
    config_name = Column(String, nullable=False)
    config_parameters = Column(JSONB, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "app_variant_revisions"


class AppEnvironmentDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    name = Column(String)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    revision = Column(Integer)
    deployed_app_variant_id = Column(Integer)  # TODO: check missing relationship

    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")

    deployment_id = Column(UUID(as_uuid=True), ForeignKey("deployments.id"))
    deployment = relationship("DeploymentDB")

    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "environments"


class AppEnvironmentRevisionDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    environment_id = Column(UUID(as_uuid=True), ForeignKey("environments.id"))
    environment = relationship("AppEnvironmentDB")
    revision = Column(Integer)
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    modified_by = relationship("UserDB")
    deployed_app_variant_revision_id = Column(Integer)
    deployment_id = Column(Integer)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "environments_revisions"


class TemplateDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    type = Column(String, default="image")
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

    __tablename__ = "templates"


class TestSetDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String)
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    csvdata = Column(JSONB)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "testsets"


class EvaluatorConfigDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(UUID(as_uuid=True), ForeignKey("evaluations.id"))
    evaluation = relationship("EvaluationDB", back_populates="evaluator_configs")
    evaluation_scenario_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluation_scenarios.id")
    )
    evaluation_scenario = relationship(
        "EvaluationScenarioDB", back_populates="evaluator_configs"
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(JSONB, default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "evaluators_configs"


class HumanEvaluationDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    status = Column(String)
    evaluation_type = Column(String)
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    variant_revision = relationship("AppVariantRevisionsDB")
    testset_id = Column(UUID(as_uuid=True), ForeignKey("testsets.id"))
    testset = relationship("TestSetDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "human_evaluations"


class HumanEvaluationScenarioDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    evaluation_id = Column(UUID(as_uuid=True), ForeignKey("human_evaluations.id"))
    evaluation = relationship("HumanEvaluationDB")
    inputs = relationship("HumanEvaluationScenarioInputsDB", backref="scenario")
    outputs = relationship("HumanEvaluationScenarioOutputsDB", backref="scenario")
    vote = Column(String)
    score = Column(JSONB)
    correct_answer = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_pinned = Column(Boolean)
    note = Column(String)
    __tablename__ = "human_evaluations_scenarios"


class HumanEvaluationScenarioInputsDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    scenario_id = Column(
        UUID(as_uuid=True), ForeignKey("human_evaluations_scenarios.id")
    )
    input_name = Column(String)
    input_value = Column(String)

    __tablename__ = "human_evaluation_scenario_inputs"


class HumanEvaluationScenarioOutputsDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    scenario_id = Column(
        UUID(as_uuid=True), ForeignKey("human_evaluations_scenarios.id")
    )
    variant_id = Column(String)
    variant_output = Column(String)

    __tablename__ = "human_evaluation_scenario_outputs"


class EvaluationDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    app_id = Column(UUID(as_uuid=True), ForeignKey("app_db.id"))
    app = relationship("AppDB")
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    status = Column(JSONB)
    testset_id = Column(UUID(as_uuid=True), ForeignKey("testsets.id"))
    testset = relationship("TestSetDB")
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    variant_revision = relationship("AppVariantRevisionsDB")
    evaluator_configs = relationship("EvaluatorConfigDB", back_populates="evaluation")
    aggregated_results = Column(JSONB)  # List of AggregatedResult
    average_cost = Column(JSONB)
    total_cost = Column(JSONB)
    average_latency = Column(JSONB)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "evaluations"


class EvaluationScenarioDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    evaluation_id = Column(UUID(as_uuid=True), ForeignKey("evaluations.id"))
    evaluation = relationship("EvaluationDB")
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    inputs = relationship("EvaluationScenarioInputDB", backref="scenario")
    outputs = relationship("EvaluationScenarioOutputDB", backref="scenario")
    correct_answers = Column(JSONB)  # List of CorrectAnswer
    is_pinned = Column(Boolean)
    note = Column(String)
    evaluator_configs = relationship(
        "EvaluatorConfigDB", back_populates="evaluation_scenario"
    )
    results = Column(JSONB)  # List of EvaluationScenarioResult
    latency = Column(Integer)
    cost = Column(Integer)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __tablename__ = "evaluation_scenarios"


class EvaluationScenarioInputDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    scenario_id = Column(UUID(as_uuid=True), ForeignKey("evaluation_scenarios.id"))
    name = Column(String)
    type = Column(String)
    value = Column(String)

    __tablename__ = "evaluation_scenario_inputs"


class EvaluationScenarioOutputDB(Base):
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    scenario_id = Column(UUID(as_uuid=True), ForeignKey("evaluation_scenarios.id"))
    result = Column(JSONB)
    cost = Column(Float)
    latency = Column(Float)

    __tablename__ = "evaluation_scenario_outputs"
