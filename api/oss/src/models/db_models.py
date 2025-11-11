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

    workspaces_relation = relationship(
        "oss.src.models.db_models.WorkspaceDB", back_populates="organization"
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
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL")
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    projects = relationship(
        "oss.src.models.db_models.ProjectDB",
        cascade="all, delete-orphan",
        back_populates="workspace",
    )
    organization = relationship(
        "oss.src.models.db_models.OrganizationDB", back_populates="workspaces_relation"
    )


# KEEP in oss/
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


# KEEP in oss/
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

    workspace_id = Column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
    )

    workspace = relationship(
        "oss.src.models.db_models.WorkspaceDB", back_populates="projects"
    )
    app = relationship("AppDB", cascade=CASCADE_ALL_DELETE, backref="project")
    evaluator_config = relationship(
        "EvaluatorConfigDB", cascade=CASCADE_ALL_DELETE, backref="project"
    )
    testset = relationship("TestSetDB", cascade=CASCADE_ALL_DELETE, backref="project")


# KEEP in oss/
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
        "oss.src.models.db_models.DeploymentDB",
        cascade=CASCADE_ALL_DELETE,
        back_populates="app",
    )


# KEEP in oss/
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
    uri = Column(String)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    project = relationship("oss.src.models.db_models.ProjectDB")
    app = relationship("AppDB", back_populates="deployment")


# KEEP in oss/
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
    deployment = relationship("oss.src.models.db_models.DeploymentDB")
    project = relationship("oss.src.models.db_models.ProjectDB")


# KEEP in oss/
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
    hidden = Column(Boolean, nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    app = relationship("AppDB", back_populates="variant")
    project = relationship("oss.src.models.db_models.ProjectDB")
    modified_by = relationship("UserDB", foreign_keys=[modified_by_id])
    base = relationship("VariantBaseDB")
    variant_revision = relationship(
        "AppVariantRevisionsDB",
        cascade=CASCADE_ALL_DELETE,
        backref="variant_revision",
    )


# KEEP in oss/
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    modified_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    base_id = Column(UUID(as_uuid=True), ForeignKey("bases.id"))
    hidden = Column(Boolean, nullable=True)
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

    project = relationship("oss.src.models.db_models.ProjectDB")
    modified_by = relationship("UserDB")
    base = relationship("VariantBaseDB")

    def get_config(self) -> dict:
        return {"config_name": self.config_name, "parameters": self.config_parameters}


# KEEP in oss/
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

    project = relationship("oss.src.models.db_models.ProjectDB")
    environment_revisions = relationship(
        "AppEnvironmentRevisionDB", cascade=CASCADE_ALL_DELETE, backref="environment"
    )
    deployed_app_variant = relationship("AppVariantDB")
    deployed_app_variant_revision = relationship("AppVariantRevisionsDB")


# KEEP in oss/
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

    project = relationship("oss.src.models.db_models.ProjectDB")
    modified_by = relationship("UserDB")


# KEEP in oss/
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


# KEEP in oss/
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


# KEEP in oss/ or KILL
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
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    expiration_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user = relationship("UserDB")
    project = relationship("oss.src.models.db_models.ProjectDB")


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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
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

    user = relationship("UserDB", backref="api_key_owner")
    project = relationship(
        "oss.src.models.db_models.ProjectDB", backref="api_key_project"
    )
