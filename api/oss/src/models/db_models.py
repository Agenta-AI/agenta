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
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy_json import mutable_json_type
from sqlalchemy.dialects.postgresql import UUID, JSONB

from oss.src.dbs.postgres.shared.base import Base
from oss.src.models.shared_models import AppType


CASCADE_ALL_DELETE = "all, delete-orphan"


class OrganizationDB(Base):
    __tablename__ = "organizations"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    slug = Column(
        String,
        unique=True,
        nullable=True,
    )
    #
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    #
    flags = Column(JSONB, nullable=True)
    tags = Column(JSONB, nullable=True)
    meta = Column(JSONB, nullable=True)
    #
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    #
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    #
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=True,
    )
    deleted_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    deleted_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class WorkspaceDB(Base):
    __tablename__ = "workspaces"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    name = Column(String)
    type = Column(String, nullable=True)
    description = Column(String, nullable=True)
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    organization = relationship(
        "oss.src.models.db_models.OrganizationDB",
    )


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

    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )

    organization = relationship(
        "oss.src.models.db_models.OrganizationDB",
    )
    workspace = relationship(
        "oss.src.models.db_models.WorkspaceDB",
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

    modified_by = relationship(
        "oss.src.models.db_models.UserDB",
        foreign_keys=[modified_by_id],
    )

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    variant = relationship(
        "oss.src.models.db_models.AppVariantDB",
        cascade=CASCADE_ALL_DELETE,
        back_populates="app",
    )
    deployment = relationship(
        "oss.src.models.db_models.DeploymentDB",
        cascade=CASCADE_ALL_DELETE,
        back_populates="app",
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    app = relationship(
        "oss.src.models.db_models.AppDB",
        back_populates="deployment",
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

    app = relationship(
        "oss.src.models.db_models.AppDB",
    )
    deployment = relationship(
        "oss.src.models.db_models.DeploymentDB",
    )
    project = relationship(
        "oss.src.models.db_models.ProjectDB",
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

    app = relationship(
        "oss.src.models.db_models.AppDB",
        back_populates="variant",
    )
    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    modified_by = relationship(
        "oss.src.models.db_models.UserDB", foreign_keys=[modified_by_id]
    )
    base = relationship(
        "oss.src.models.db_models.VariantBaseDB",
    )
    variant_revision = relationship(
        "oss.src.models.db_models.AppVariantRevisionsDB",
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    modified_by = relationship(
        "oss.src.models.db_models.UserDB",
        foreign_keys=[modified_by_id],
    )
    base = relationship(
        "oss.src.models.db_models.VariantBaseDB",
    )

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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    environment_revisions = relationship(
        "oss.src.models.db_models.AppEnvironmentRevisionDB",
        cascade=CASCADE_ALL_DELETE,
        backref="environment",
    )
    deployed_app_variant = relationship(
        "oss.src.models.db_models.AppVariantDB",
    )
    deployed_app_variant_revision = relationship(
        "oss.src.models.db_models.AppVariantRevisionsDB"
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    modified_by = relationship(
        "oss.src.models.db_models.UserDB",
    )


class TestsetDB(Base):
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )


class EvaluatorConfigDB(Base):
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
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


class InvitationDB(Base):
    __tablename__ = "project_invitations"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    token = Column(String, unique=True, nullable=False)
    email = Column(String, nullable=False)
    used = Column(Boolean, default=False)
    role = Column(String, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    expiration_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user = relationship(
        "oss.src.models.db_models.UserDB",
    )
    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )


class APIKeyDB(Base):
    __tablename__ = "api_keys"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    prefix = Column(String)
    hashed_key = Column(String)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rate_limit = Column(Integer, default=0)
    hidden = Column(Boolean, default=False)
    expiration_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user = relationship(
        "oss.src.models.db_models.UserDB",
        backref="api_key_owner",
    )
    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )


class EvaluationAggregatedResultDB(Base):
    __tablename__ = "auto_evaluation_aggregated_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("auto_evaluations.id", ondelete="CASCADE")
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auto_evaluator_configs.id", ondelete="SET NULL"),
    )
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result

    evaluator_config = relationship(
        "oss.src.models.db_models.EvaluatorConfigDB",
        backref="evaluator_config",
    )


class EvaluationScenarioResultDB(Base):
    __tablename__ = "auto_evaluation_scenario_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_scenario_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auto_evaluation_scenarios.id", ondelete="CASCADE"),
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auto_evaluator_configs.id", ondelete="SET NULL"),
    )
    result = Column(mutable_json_type(dbtype=JSONB, nested=True))  # Result


class EvaluationDB(Base):
    __tablename__ = "auto_evaluations"

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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    testset = relationship(
        "oss.src.models.db_models.TestsetDB",
    )
    variant = relationship(
        "oss.src.models.db_models.AppVariantDB",
    )
    variant_revision = relationship(
        "oss.src.models.db_models.AppVariantRevisionsDB",
    )
    aggregated_results = relationship(
        "oss.src.models.db_models.EvaluationAggregatedResultDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation",
    )
    evaluation_scenarios = relationship(
        "oss.src.models.db_models.EvaluationScenarioDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation",
    )
    evaluator_configs = relationship(
        "oss.src.models.db_models.EvaluationEvaluatorConfigDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation",
    )


class EvaluationEvaluatorConfigDB(Base):
    __tablename__ = "auto_evaluation_evaluator_configs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    evaluation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auto_evaluations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    evaluator_config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auto_evaluator_configs.id", ondelete="SET NULL"),
        primary_key=True,
    )


class EvaluationScenarioDB(Base):
    __tablename__ = "auto_evaluation_scenarios"

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
    evaluation_id = Column(
        UUID(as_uuid=True), ForeignKey("auto_evaluations.id", ondelete="CASCADE")
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

    project = relationship(
        "oss.src.models.db_models.ProjectDB",
    )
    variant = relationship(
        "oss.src.models.db_models.AppVariantDB",
    )
    results = relationship(
        "oss.src.models.db_models.EvaluationScenarioResultDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation_scenario",
    )
