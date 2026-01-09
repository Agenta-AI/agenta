from typing import Optional, Literal, Any
from uuid import UUID

from pydantic import BaseModel
import uuid_utils.compat as uuid
from sqlalchemy.future import select

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee

from oss.src.dbs.postgres.shared.engine import engine

from oss.src.models.db_models import UserDB
from oss.src.services.api_key_service import create_api_key

from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
    ProjectDB,
)

from ee.src.models.db_models import (
    OrganizationMemberDB as OrganizationMembershipDB,
    WorkspaceMemberDB as WorkspaceMembershipDB,
    ProjectMemberDB as ProjectMembershipDB,
)

log = get_module_logger(__name__)


class Reference(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class UserRequest(BaseModel):
    name: str
    email: str


Tier = str


class OrganizationRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    #
    is_demo: bool = False
    is_personal: bool = False
    #
    owner_id: UUID


class WorkspaceRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    #
    is_default: bool
    #
    organization_ref: Reference


class ProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    #
    is_default: bool
    #
    workspace_ref: Reference
    organization_ref: Reference


OrganizationRole = Literal[
    "owner",
    "viewer",
    "editor",
    "evaluator",
    "workspace_admin",
    "deployment_manager",
]  # update list


class OrganizationMembershipRequest(BaseModel):
    role: OrganizationRole
    is_demo: bool
    #
    user_ref: Reference
    organization_ref: Reference


WorkspaceRole = Literal[  # update list
    "owner",
    "viewer",
    "editor",
    "evaluator",
    "workspace_admin",
    "deployment_manager",
]


class WorkspaceMembershipRequest(BaseModel):
    role: WorkspaceRole
    is_demo: bool
    #
    user_ref: Reference
    workspace_ref: Reference


ProjectRole = Literal[  # update list
    "owner",
    "viewer",
    "editor",
    "evaluator",
    "workspace_admin",
    "deployment_manager",
]


class ProjectMembershipRequest(BaseModel):
    role: ProjectRole
    is_demo: bool
    #
    user_ref: Reference
    project_ref: Reference


Credentials = str


async def check_user(
    request: UserRequest,
) -> Optional[UserRequest]:
    async with engine.core_session() as session:
        result = await session.execute(
            select(UserDB).filter_by(
                email=request.email,
            )
        )

        user_db = result.scalars().first()

        reference = Reference(id=user_db.id) if user_db else None

        return reference


async def create_user(
    request: UserRequest,
) -> Reference:
    async with engine.core_session() as session:
        user_db = UserDB(
            # id=uuid7()  # use default
            #
            uid=str(uuid.uuid7()),
            username=request.name,  # rename to 'name'
            email=request.email,
        )

        session.add(user_db)

        await session.commit()

        log.info(
            "[scopes] user created",
            user_id=user_db.id,
        )

        response = Reference(id=user_db.id)

        return response


async def create_organization(
    request: OrganizationRequest,
) -> Reference:
    async with engine.core_session() as session:
        organization_db = OrganizationDB(
            name=request.name,
            description=request.description,
            flags={
                "is_demo": False,
                "is_personal": request.is_personal,
            },
            owner_id=request.owner_id,
            created_by_id=request.owner_id,
        )

        session.add(organization_db)

        await session.commit()

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        response = Reference(id=organization_db.id)

        return response


async def create_workspace(
    request: WorkspaceRequest,
) -> Reference:
    async with engine.core_session() as session:
        workspace_db = WorkspaceDB(
            # id=uuid7()  # use default
            #
            name=request.name,
            description=request.description,
            type=("default" if request.is_default else None),  # rename to 'is_default'
            #
            organization_id=request.organization_ref.id,
        )

        session.add(workspace_db)

        await session.commit()

        log.info(
            "[scopes] workspace created",
            organization_id=workspace_db.organization_id,
            workspace_id=workspace_db.id,
        )

        response = Reference(id=workspace_db.id)

        return response


async def create_project(
    request: ProjectRequest,
) -> Reference:
    async with engine.core_session() as session:
        project_db = ProjectDB(
            # id=uuid7()  # use default
            #
            project_name=request.name,  # rename to 'name'
            # description=...  # missing 'description'
            is_default=request.is_default,
            #
            workspace_id=request.workspace_ref.id,
            organization_id=request.organization_ref.id,
        )

        session.add(project_db)

        await session.commit()

        log.info(
            "[scopes] project created",
            organization_id=project_db.organization_id,
            workspace_id=project_db.workspace_id,
            project_id=project_db.id,
        )

        response = Reference(id=project_db.id)

        return response


async def create_organization_membership(
    request: OrganizationMembershipRequest,
) -> Reference:
    async with engine.core_session() as session:
        membership_db = OrganizationMembershipDB(
            # id=uuid7()  # use default
            #
            # role=request.role,  # move 'owner' from organization to here as 'role'
            # is_demo=request.is_demo,  # add 'is_demo'
            #
            user_id=request.user_ref.id,
            organization_id=request.organization_ref.id,
        )

        session.add(membership_db)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=request.organization_ref.id,
            user_id=request.user_ref.id,
            membership_id=membership_db.id,
        )

        if request.role == "owner":
            result = await session.execute(
                select(OrganizationDB).filter_by(
                    id=request.organization_ref.id,
                )
            )

            organization_db = result.scalars().first()

            organization_db.owner_id = request.user_ref.id

            await session.commit()

        response = Reference(id=membership_db.id)

        return response


async def create_workspace_membership(
    request: WorkspaceMembershipRequest,
) -> Reference:
    async with engine.core_session() as session:
        workspace = await session.execute(
            select(WorkspaceDB).filter_by(
                id=request.workspace_ref.id,
            )
        )
        workspace_db = workspace.scalars().first()

        membership_db = WorkspaceMembershipDB(
            # id=uuid7()  # use default
            #
            role=request.role,
            # is_demo=request.is_demo,  # add 'is_demo'
            #
            user_id=request.user_ref.id,
            workspace_id=request.workspace_ref.id,
        )

        session.add(membership_db)

        await session.commit()

        log.info(
            "[scopes] workspace membership created",
            organization_id=workspace_db.organization_id,
            workspace_id=request.workspace_ref.id,
            user_id=request.user_ref.id,
            membership_id=membership_db.id,
        )

        response = Reference(id=membership_db.id)

        return response


async def create_project_membership(
    request: ProjectMembershipRequest,
) -> Reference:
    async with engine.core_session() as session:
        project = await session.execute(
            select(ProjectDB).filter_by(
                id=request.project_ref.id,
            )
        )
        project_db = project.scalars().first()

        membership_db = ProjectMembershipDB(
            # id=uuid7()  # use default
            #
            role=request.role,
            is_demo=request.is_demo,
            #
            user_id=request.user_ref.id,
            project_id=request.project_ref.id,
        )

        session.add(membership_db)

        await session.commit()

        log.info(
            "[scopes] project membership created",
            organization_id=project_db.organization_id,
            workspace_id=project_db.workspace_id,
            project_id=request.project_ref.id,
            user_id=request.user_ref.id,
            membership_id=membership_db.id,
        )

        response = Reference(id=membership_db.id)

        return response


async def create_credentials(
    user_id: UUID,
    project_id: UUID,
) -> Credentials:
    apikey_token = await create_api_key(
        user_id=str(user_id),
        project_id=str(project_id),
    )

    credentials = f"ApiKey {apikey_token}"

    return credentials
