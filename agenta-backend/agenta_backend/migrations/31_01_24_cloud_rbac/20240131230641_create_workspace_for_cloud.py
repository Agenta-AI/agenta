from enum import Enum
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field
from beanie import Document, Link, PydanticObjectId

from beanie import free_fall_migration


class WorkspaceRole(str, Enum):
    OWNER = "owner"
    VIEWER = "viewer"
    EDITOR = "editor"
    EVALUATOR = "evaluator"
    WORKSPACE_ADMIN = "workspace_admin"
    DEPLOYMENT_MANAGER = "deployment_manager"

    @classmethod
    def get_description(cls, role):
        descriptions = {
            cls.OWNER: "Can fully manage the workspace, including adding and removing members.",
            cls.VIEWER: "Can view the workspace content but cannot make changes.",
            cls.EDITOR: "Can edit workspace content, but cannot manage members or roles.",
            cls.EVALUATOR: "Can evaluate models and provide feedback within the workspace.",
            cls.WORKSPACE_ADMIN: "Can manage workspace settings and members but cannot delete the workspace.",
            cls.DEPLOYMENT_MANAGER: "Can manage model deployments within the workspace.",
        }
        return descriptions.get(role, "Description not available, Role not found")


class Permission(str, Enum):
    # general
    READ_SYSTEM = "read_system"

    # App and variants
    VIEW_APPLICATION = "view_application"
    EDIT_APPLICATION = "edit_application"
    CREATE_APPLICATION = "create_application"
    DELETE_APPLICATION = "delete_application"
    CREATE_APP_VARAIANT = "create_app_variant"
    DELETE_APP_VARIANT = "delete_app_variant"
    MODIFY_VARIANT_CONFIGURATIONS = "modify_variant_configurations"
    DELETE_APPLICATION_VARIANT = "delete_application_variant"

    # Testset
    VIEW_TESTSET = "view_testset"
    EDIT_TESTSET = "edit_testset"
    CREATE_TESTSET = "create_testset"
    DELETE_TESTSET = "delete_testset"

    # Evaluation
    VIEW_EVALUATION = "view_evaluation"
    RUN_EVALUATIONS = "run_evaluations"
    EDIT_EVALUATION = "edit_evaluation"
    CREATE_EVALUATION = "create_evaluation"
    DELETE_EVALUATION = "delete_evaluation"

    # Deployment
    DEPLOY_APPLICATION = "deploy_application"

    # Workspace
    VIEW_WORKSPACE = "view_workspace"
    EDIT_WORKSPACE = "edit_workspace"
    CREATE_WORKSPACE = "create_workspace"
    DELETE_WORKSPACE = "delete_workspace"
    MODIFY_USER_ROLES = "modify_user_roles"
    ADD_USER_TO_WORKSPACE = "add_new_user_to_workspace"

    # Organization
    EDIT_ORGANIZATION = "edit_organization"
    DELETE_ORGANIZATION = "delete_organization"
    ADD_USER_TO_ORGANIZATION = "add_new_user_to_organization"

    @classmethod
    def default_permissions(cls, role):
        defaults = {
            WorkspaceRole.OWNER: cls,
            WorkspaceRole.VIEWER: [
                cls.READ_SYSTEM,
                cls.VIEW_APPLICATION,
                cls.VIEW_TESTSET,
                cls.VIEW_EVALUATION,
            ],
            WorkspaceRole.EDITOR: [
                p
                for p in cls
                if p
                not in [
                    cls.DELETE_TESTSET,
                    cls.DELETE_WORKSPACE,
                    cls.CREATE_WORKSPACE,
                    cls.EDIT_ORGANIZATION,
                    cls.DELETE_EVALUATION,
                    cls.MODIFY_USER_ROLES,
                    cls.DELETE_APPLICATION,
                    cls.DELETE_ORGANIZATION,
                    cls.ADD_USER_TO_WORKSPACE,
                    cls.ADD_USER_TO_ORGANIZATION,
                ]
            ],
            WorkspaceRole.DEPLOYMENT_MANAGER: [cls.READ_SYSTEM, cls.DEPLOY_APPLICATION],
            WorkspaceRole.WORKSPACE_ADMIN: [
                p
                for p in cls
                if p
                not in [
                    cls.DELETE_WORKSPACE,
                    cls.DELETE_ORGANIZATION,
                    cls.EDIT_ORGANIZATION,
                    cls.ADD_USER_TO_ORGANIZATION,
                ]
            ],
            WorkspaceRole.EVALUATOR: [cls.READ_SYSTEM, cls.RUN_EVALUATIONS],
        }

        return defaults.get(role, [])


class WorkspacePermissionDB(BaseModel):
    role_name: WorkspaceRole
    permissions: List[Permission]


class WorkspaceMemberDB(BaseModel):
    user_id: PydanticObjectId
    roles: List[WorkspacePermissionDB]

class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    organization_id: str
    workspace_id: str
    workspace_roles: Optional[List[WorkspaceRole]]
    expiration_date: datetime = Field(default="0")
    used: bool = False
    created_at: Optional[datetime] = datetime.utcnow()


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "organizations"


class WorkspaceDB(Document):
    name: str
    type: Optional[str]
    description: Optional[str] = Field(default="")
    organization: Optional[Link[OrganizationDB]]
    members: Optional[List[WorkspaceMemberDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    def get_member_roles(
        self, user_id: PydanticObjectId
    ) -> Optional[List[WorkspacePermissionDB]]:
        for member in self.members:
            if member.user_id == user_id:
                return member.roles
        return None

    def get_member_role_names(self, user_id: PydanticObjectId) -> List[str]:
        roles = self.get_member_roles(user_id)
        return [role.role_name for role in roles] if roles else []

    def get_all_members(self) -> List[PydanticObjectId]:
        return [member.user_id for member in self.members]

    def get_member_with_roles(
        self, user_id: PydanticObjectId
    ) -> Optional[WorkspaceMemberDB]:
        for member in self.members:
            if member.user_id == user_id:
                return member
        return None

    def get_member_permissions(
        self, user_id: PydanticObjectId, role_to_check: WorkspaceRole
    ) -> List[Permission]:
        roles = self.get_member_roles(user_id)
        if roles:
            for role in roles:
                if role.role_name == role_to_check:
                    return role.permissions
        return []

    def has_permission(self, user_id: PydanticObjectId, permission: Permission) -> bool:
        roles = self.get_member_roles(user_id)
        if roles:
            for role in roles:
                if permission in role.permissions:
                    return True
        return False

    def has_role(self, user_id: PydanticObjectId, role_to_check: WorkspaceRole) -> bool:
        roles = self.get_member_roles(user_id)
        if roles:
            for role in roles:
                if role.role_name == role_to_check:
                    return True
        return False

    def is_owner(self, user_id: PydanticObjectId) -> bool:
        for member in self.members:
            if (
                member.user_id == user_id
                and WorkspaceRole.OWNER in self.get_member_role_names(user_id)
            ):
                return True
        return False

    class Settings:
        name = "workspaces"



class Forward:

    @free_fall_migration(document_models=[WorkspaceDB])
    async def create_workspace_db(self, session):
        pass

class Backward:
    pass
