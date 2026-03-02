from typing import Optional, Literal, Any, Union
from uuid import UUID

from pydantic import BaseModel

import uuid_utils.compat as uuid

from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.services import db_manager

from oss.src.models.db_models import UserDB
from oss.src.services.api_key_service import create_api_key


from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
    ProjectDB,
)


log = get_module_logger(__name__)


class CreateOrganization(BaseModel):
    name: str
    description: Optional[str] = None
    #
    is_demo: bool = False
    #
    owner_id: UUID


class CreateWorkspace(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = None


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


async def legacy_create_organization(
    payload: CreateOrganization,
    user: UserDB,
    return_org_wrk: bool = False,
    return_org_wrk_prj: bool = False,
) -> Union[OrganizationDB, WorkspaceDB]:
    async with engine.core_session() as session:
        create_org_data = payload.model_dump(exclude_unset=True)

        create_org_data["flags"] = {
            "is_demo": payload.is_demo,
        }

        # Set required audit fields
        create_org_data["owner_id"] = user.id
        create_org_data["created_by_id"] = user.id

        # create organization
        organization_db = OrganizationDB(**create_org_data)

        session.add(organization_db)

        await session.commit()

        # construct workspace payload
        workspace_payload = CreateWorkspace(
            name=payload.name,
            type="default",
        )

        # create workspace
        workspace, project = await legacy_create_workspace(
            session, workspace_payload, organization_db, user
        )

        return organization_db, workspace, project


async def legacy_create_workspace(
    session: AsyncSession,
    payload: CreateWorkspace,
    organization: OrganizationDB,
    user: UserDB,
) -> WorkspaceDB:
    workspace = WorkspaceDB(
        name=payload.name,
        type=payload.type if payload.type else "",
        description=payload.description if payload.description else "",
        organization_id=organization.id,
    )

    session.add(workspace)

    await session.commit()

    await session.refresh(workspace, attribute_names=["organization"])

    project_db = await legacy_create_project(
        project_name="Default",
        organization_id=str(organization.id),
        workspace_id=str(workspace.id),
        session=session,
    )

    # Keep legacy bootstrap aligned with project-level default environments.
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_environments(
        project_id=project_db.id,
        user_id=user.id,
    )

    return workspace, project_db


async def legacy_create_project(
    project_name: str,
    workspace_id: str,
    organization_id: str,
    session: AsyncSession,
) -> WorkspaceDB:
    project_db = ProjectDB(
        project_name=project_name,
        is_default=True,
        organization_id=uuid.UUID(organization_id),
        workspace_id=uuid.UUID(workspace_id),
    )

    session.add(project_db)

    await session.commit()

    return project_db


async def user_exists(user_email: str) -> bool:
    user = await db_manager.get_user_with_email(email=user_email)
    return False if not user else True


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
    created_by_id: uuid.UUID,
) -> Reference:
    async with engine.core_session() as session:
        organization_db = OrganizationDB(
            name=request.name,
            description=request.description,
            flags={"is_demo": False},
            owner_id=created_by_id,
            created_by_id=created_by_id,
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
