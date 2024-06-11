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
    Enum,
)
from sqlalchemy.orm import relationship, declarative_base
import uuid_utils.compat as uuid
from sqlalchemy.dialects.postgresql import UUID, JSONB

from agenta_backend.models.shared_models import TemplateType
from agenta_backend.models.base import Base


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


# TODO: Rename ImageDB to DockerImageDB ?
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
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
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


class VariantBaseDB(Base):
    __tablename__ = "bases"

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


class AppVariantDB(Base):
    __tablename__ = "app_variants"

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


class AppVariantRevisionsDB(Base):
    __tablename__ = "app_variant_revisions"

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


class AppEnvironmentDB(Base):
    __tablename__ = "environments"

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

    deployed_app_variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    deployed_app_variant = relationship("AppVariantDB")

    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")

    deployment_id = Column(UUID(as_uuid=True), ForeignKey("deployments.id"))
    deployment = relationship("DeploymentDB")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AppEnvironmentRevisionDB(Base):
    __tablename__ = "environments_revisions"

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

    deployed_app_variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")

    deployment_id = Column(UUID(as_uuid=True), ForeignKey("deployments.id"))
    deployment = relationship("DeploymentDB")

    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


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


class EvaluatorConfigDB(Base):
    __tablename__ = "evaluators_configs"

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
    name = Column(String)
    evaluator_key = Column(String)
    settings_values = Column(JSONB, default=dict)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
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


class HumanEvaluationScenarioDB(Base):
    __tablename__ = "human_evaluations_scenarios"

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
    inputs = Column(JSONB)  # List of HumanEvaluationScenarioInput
    outputs = Column(JSONB)  # List of HumanEvaluationScenarioOutput
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


class EvaluationAggregatedResultDB(Base):
    __tablename__ = "evaluation_aggregated_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(UUID(as_uuid=True), ForeignKey("evaluations.id"))
    evaluation = relationship("EvaluationDB", back_populates="aggregated_results")
    evaluator_config_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluators_configs.id")
    )
    evaluator_config = relationship("EvaluatorConfigDB")
    result = Column(JSONB)  # Result


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
        UUID(as_uuid=True), ForeignKey("evaluation_scenarios.id")
    )
    evaluation_scenario = relationship("EvaluationScenarioDB", back_populates="results")
    evaluator_config_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluators_configs.id")
    )
    evaluator_config = relationship("EvaluatorConfigDB")
    result = Column(JSONB)  # Result


class EvaluationDB(Base):
    __tablename__ = "evaluations"

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
    status = Column(JSONB)  # Result
    testset_id = Column(UUID(as_uuid=True), ForeignKey("testsets.id"))
    testset = relationship("TestSetDB")
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    variant_revision_id = Column(
        UUID(as_uuid=True), ForeignKey("app_variant_revisions.id")
    )
    variant_revision = relationship("AppVariantRevisionsDB")
    aggregated_results = relationship(
        "EvaluationAggregatedResultDB", back_populates="evaluation"
    )
    average_cost = Column(JSONB)  # Result
    total_cost = Column(JSONB)  # Result
    average_latency = Column(JSONB)  # Result
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class EvaluationEvaluatorConfigDB(Base):
    __tablename__ = "evaluation_evaluator_configs"

    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluations.id"), primary_key=True
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True), ForeignKey("evaluators_configs.id"), primary_key=True
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
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    user = relationship("UserDB")
    evaluation_id = Column(UUID(as_uuid=True), ForeignKey("evaluations.id"))
    evaluation = relationship("EvaluationDB")
    variant_id = Column(UUID(as_uuid=True), ForeignKey("app_variants.id"))
    variant = relationship("AppVariantDB")
    inputs = Column(JSONB)  # List of EvaluationScenarioInput
    outputs = Column(JSONB)  # List of EvaluationScenarioOutput
    correct_answers = Column(JSONB)  # List of CorrectAnswer
    is_pinned = Column(Boolean)
    note = Column(String)
    results = relationship(
        "EvaluationScenarioResultDB", back_populates="evaluation_scenario"
    )
    latency = Column(Integer)
    cost = Column(Integer)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class IDsMappingDB(Base):
    __tablename__ = "ids_mapping"

    table_name = Column(String, nullable=False)
    objectid = Column(String, primary_key=True)
    uuid = Column(UUID(as_uuid=True), nullable=False)
