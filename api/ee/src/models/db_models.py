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


class OrganizationDB(OssOrganizationDB):
    is_paying = Column(Boolean, nullable=True, default=False)

    organization_members = relationship(
        "OrganizationMemberDB", back_populates="organization"
    )
    project = relationship(
        "ee.src.models.db_models.ProjectDB",
        back_populates="organization",
        overlaps="organization",
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
        "ee.src.models.db_models.OrganizationDB",
        back_populates="project",
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
