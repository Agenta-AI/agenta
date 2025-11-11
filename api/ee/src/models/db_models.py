from typing import Optional, List, Sequence
from datetime import datetime, timezone

import uuid_utils.compat as uuid
from sqlalchemy.orm import relationship, backref
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Integer

from ee.src.models.shared_models import (
    WorkspaceRole,
    Permission,
)
from oss.src.models.db_models import (
    ProjectDB as OssProjectDB,
    WorkspaceDB as OssWorkspaceDB,
    OrganizationDB as OssOrganizationDB,
    DeploymentDB as OssDeploymentDB,
    # dependency
    CASCADE_ALL_DELETE,
    mutable_json_type,
)
from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.observability.dbes import NodesDBE


class OrganizationDB(OssOrganizationDB):
    is_paying = Column(Boolean, nullable=True, default=False)

    organization_members = relationship(
        "OrganizationMemberDB", back_populates="organization"
    )


class WorkspaceDB(OssWorkspaceDB):
    pass

    members = relationship("WorkspaceMemberDB", back_populates="workspace")
    projects = relationship(
        "ee.src.models.db_models.ProjectDB",
        cascade="all, delete-orphan",
        back_populates="workspace",
        overlaps="workspace",
    )
    organization = relationship(
        "ee.src.models.db_models.OrganizationDB", back_populates="workspaces_relation"
    )

    def get_member_role(self, user_id: str) -> Optional[str]:
        member: Optional[WorkspaceMemberDB] = next(
            (member for member in self.members if str(member.user_id) == user_id),
            None,
        )
        return member.role if member else None  # type: ignore

    def get_member_role_name(self, user_id: str) -> Optional[str]:
        role = self.get_member_role(user_id)
        return role

    def get_all_members(self) -> List[str]:
        return [str(member.user_id) for member in self.members]

    def get_member_with_roles(self, user_id: str) -> Optional["WorkspaceMemberDB"]:
        return next(
            (member for member in self.members if str(member.user_id) == user_id),
            None,
        )

    def get_member_permissions(self, user_id: str) -> List[Permission]:
        user_role = self.get_member_role(user_id)
        if user_role:
            return Permission.default_permissions(user_role)
        return []

    def has_permission(self, user_id: str, permission: Permission) -> bool:
        user_role = self.get_member_role(user_id)
        if user_role and permission in Permission.default_permissions(user_role):
            return True
        return False

    def has_role(self, user_id: str, role_to_check: WorkspaceRole) -> bool:
        user_role = self.get_member_role(user_id)
        if user_role:
            return user_role == role_to_check
        return False

    def is_owner(self, user_id: str) -> bool:
        return any(
            str(member.user_id) == user_id
            and WorkspaceRole.OWNER == self.get_member_role_name(user_id)
            for member in self.members
        )


class ProjectDB(OssProjectDB):
    workspace = relationship(
        "ee.src.models.db_models.WorkspaceDB",
        back_populates="projects",
        overlaps="projects",
    )
    organization = relationship(
        "ee.src.models.db_models.OrganizationDB", backref="project"
    )
    project_members = relationship(
        "ProjectMemberDB", cascade="all, delete-orphan", back_populates="project"
    )
    invitations = relationship(
        "InvitationDB", cascade="all, delete-orphan", back_populates="project"
    )

    def get_member_role(
        self, user_id: str, members: Sequence["ProjectMemberDB"]
    ) -> Optional[str]:
        member: Optional["ProjectMemberDB"] = next(
            (member for member in members if str(member.user_id) == user_id),
            None,
        )
        return member.role if member else None  # type: ignore

    def get_member_role_name(
        self, user_id: str, members: Sequence["ProjectMemberDB"]
    ) -> Optional[str]:
        role = self.get_member_role(user_id=user_id, members=members)
        return role

    def get_all_members(self) -> List[str]:
        return [str(member.user_id) for member in self.project_members]

    def get_member_with_roles(self, user_id: str) -> Optional["ProjectMemberDB"]:
        return next(
            (
                member
                for member in self.project_members
                if str(member.user_id) == user_id
            ),
            None,
        )

    def get_member_permissions(
        self, user_id: str, members: Sequence["ProjectMemberDB"]
    ) -> List[Permission]:
        user_role = self.get_member_role(user_id, members)
        if user_role:
            return Permission.default_permissions(user_role)
        return []

    def has_permission(
        self, user_id: str, permission: Permission, members: Sequence["ProjectMemberDB"]
    ) -> bool:
        user_role = self.get_member_role(user_id, members)
        if user_role and permission in Permission.default_permissions(user_role):
            return True
        return False

    def has_role(
        self,
        user_id: str,
        role_to_check: WorkspaceRole,
        members: Sequence["ProjectMemberDB"],
    ) -> bool:
        user_role = self.get_member_role(user_id, members)
        if user_role:
            return user_role == role_to_check
        return False

    def is_owner(self, user_id: str, members: Sequence["ProjectMemberDB"]) -> bool:
        return any(
            str(member.user_id) == user_id
            and WorkspaceRole.OWNER == self.get_member_role_name(user_id, members)
            for member in members
        )


class WorkspaceMemberDB(Base):
    __tablename__ = "workspace_members"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("workspaces.id"))
    role = Column(String, default="viewer")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user = relationship(
        "UserDB", backref=backref("workspace_memberships", lazy="dynamic")
    )
    workspace = relationship(
        "ee.src.models.db_models.WorkspaceDB", back_populates="members"
    )


class OrganizationMemberDB(Base):
    __tablename__ = "organization_members"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"))

    user = relationship(
        "UserDB", backref=backref("organization_members", lazy="dynamic")
    )
    organization = relationship(
        "ee.src.models.db_models.OrganizationDB", back_populates="organization_members"
    )


class ProjectMemberDB(Base):
    __tablename__ = "project_members"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    role = Column(String, default="viewer")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_demo = Column(Boolean, nullable=True)

    user = relationship("UserDB")
    project = relationship("ee.src.models.db_models.ProjectDB")


class DeploymentDB(OssDeploymentDB):
    pass


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

    evaluator_config = relationship("EvaluatorConfigDB", backref="evaluator_config")


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

    project = relationship("ee.src.models.db_models.ProjectDB")
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
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
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

    project = relationship("ee.src.models.db_models.ProjectDB")
    variant = relationship("AppVariantDB")
    results = relationship(
        "EvaluationScenarioResultDB",
        cascade=CASCADE_ALL_DELETE,
        backref="evaluation_scenario",
    )
