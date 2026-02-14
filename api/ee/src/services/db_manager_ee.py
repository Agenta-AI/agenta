from typing import List, Union, NoReturn, Optional, Tuple
import uuid
from datetime import datetime, timezone

import sendgrid
from fastapi import HTTPException

from sqlalchemy import func
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, load_only
from sqlalchemy.exc import NoResultFound, MultipleResultsFound
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.services import db_manager
from ee.src.models.api.workspace_models import (
    UserRole,
    UpdateWorkspace,
    CreateWorkspace,
    WorkspaceResponse,
)
from ee.src.models.api.organization_models import (
    Organization,
    CreateOrganization,
    OrganizationUpdate,
)
from ee.src.models.shared_models import WorkspaceRole

from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
    ProjectDB,
)

from ee.src.models.db_models import (
    OrganizationMemberDB,
    WorkspaceMemberDB,
    ProjectMemberDB,
)
from oss.src.models.db_models import (
    UserDB,
    InvitationDB,
)

from ee.src.core.organizations.exceptions import (
    OrganizationSlugConflictError,
)

from ee.src.dbs.postgres.organizations.dao import (
    OrganizationProvidersDAO,
    OrganizationDomainsDAO,
)
from ee.src.services.converters import get_workspace_in_format
from ee.src.services.selectors import get_org_default_workspace

from oss.src.utils.env import env


# Initialize sendgrid api client
sg = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)

log = get_module_logger(__name__)


async def get_organization(organization_id: str) -> OrganizationDB:
    """
    Fetches an organization by its ID.

    Args:
        organization_id (str): The ID of the organization to fetch.

    Returns:
        OrganizationDB: The fetched organization.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()
        return organization


async def get_organizations_by_list_ids(organization_ids: List) -> List[OrganizationDB]:
    """
    Retrieve organizations from the database by their IDs.

    Args:
        organization_ids (List): A list of organization IDs to retrieve.

    Returns:
        List: A list of dictionaries representing the retrieved organizations.
    """

    async with engine.core_session() as session:
        organization_uuids = [
            uuid.UUID(organization_id) for organization_id in organization_ids
        ]
        query = select(OrganizationDB).where(OrganizationDB.id.in_(organization_uuids))
        result = await session.execute(query)
        organizations = result.scalars().all()
        return organizations


async def count_organizations_by_owner(owner_id: str) -> int:
    """
    Count the number of organizations owned by a user.

    Args:
        owner_id (str): The ID of the owner.

    Returns:
        int: The count of organizations owned by the user.
    """
    async with engine.core_session() as session:
        result = await session.execute(
            select(func.count(OrganizationDB.id)).where(
                OrganizationDB.owner_id == uuid.UUID(owner_id)
            )
        )
        return result.scalar() or 0


async def get_default_workspace_id(user_id: str) -> str:
    """
    Retrieve the default workspace ID for a user.

    Args:
        user_id (str): The user id.

    Returns:
        str: The default workspace ID.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB)
            .filter_by(user_id=uuid.UUID(user_id), role=WorkspaceRole.OWNER)
            .options(load_only(WorkspaceMemberDB.workspace_id))  # type: ignore
        )
        member_in_workspace = result.scalars().first()
        return str(member_in_workspace.workspace_id)


async def get_organization_workspaces(organization_id: str):
    """
    Retries workspaces belonging to an organization.

    Args:
        organization_id (str): The ID of the organization
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceDB)
            .filter_by(organization_id=uuid.UUID(organization_id))
            .options(  # type: ignore
                load_only(WorkspaceDB.id, WorkspaceDB.organization_id)
            )
        )
        workspaces = result.scalars().all()
        return workspaces


async def get_workspace_members(workspace_id: str) -> List[WorkspaceMemberDB]:
    """
    Return all membership rows for a given workspace.

    Used by RBAC / admin helpers to derive roles and permissions.
    """
    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB).where(
                WorkspaceMemberDB.workspace_id == workspace_id
            )
        )
        return list(result.scalars().all())


async def get_workspace_administrators(workspace: WorkspaceDB) -> List[UserDB]:
    """
    Retrieve the administrators of a workspace.

    Administrators are members whose role is WORKSPACE_ADMIN or OWNER.
    """

    # Fetch all membership rows for this workspace
    members = await get_workspace_members(workspace_id=str(workspace.id))

    admin_user_ids = [
        str(member.user_id)
        for member in members
        if member.role in (WorkspaceRole.WORKSPACE_ADMIN, WorkspaceRole.OWNER)
    ]

    administrators: List[UserDB] = []
    for user_id in admin_user_ids:
        user = await db_manager.get_user_with_id(user_id=user_id)
        if user:
            administrators.append(user)

    return administrators


async def create_project(
    project_name: str,
    workspace_id: str,
    organization_id: str,
    session: AsyncSession,
    *,
    is_default: bool = False,
) -> WorkspaceDB:
    """
    Create a new project.

    Args:
        project_name (str): The name of the project.
        workspace_id (str): The ID of the workspace.
        organization_id (str): The ID of the organization.
        session (AsyncSession): The database session.

    Returns:
        WorkspaceDB: The created project.
    """

    project_db = ProjectDB(
        project_name=project_name,
        is_default=is_default,
        organization_id=uuid.UUID(organization_id),
        workspace_id=uuid.UUID(workspace_id),
    )

    session.add(project_db)

    await session.commit()

    log.info(
        "[scopes] project created",
        organization_id=organization_id,
        workspace_id=workspace_id,
        project_id=project_db.id,
    )

    return project_db


async def create_default_project(
    organization_id: str, workspace_id: str, session: AsyncSession
) -> WorkspaceDB:
    """
    Create a default project for an organization.

    Args:
        organization_id (str): The ID of the organization.
        workspace_id (str): The ID of the workspace.
        session (AsyncSession): The database session.

    Returns:
        WorkspaceDB: The created default project.
    """

    project_db = await create_project(
        "Default",
        workspace_id=workspace_id,
        organization_id=organization_id,
        session=session,
        is_default=True,
    )
    return project_db


async def create_workspace_project(
    project_name: str,
    workspace_id: str,
    *,
    set_default: bool = False,
) -> ProjectDB:
    """
    Create a project for a workspace and sync memberships.
    """

    workspace = await db_manager.get_workspace(workspace_id)
    if workspace is None:
        raise NoResultFound(f"Workspace with ID {workspace_id} not found")

    project = await db_manager.create_workspace_project(
        project_name=project_name,
        workspace_id=workspace_id,
        organization_id=str(workspace.organization_id),
        set_default=set_default,
    )

    await sync_workspace_members_to_project(str(project.id))
    return project


async def sync_workspace_members_to_project(
    project_id: str,
    session: Optional[AsyncSession] = None,
) -> None:
    """
    Ensure all workspace members are mirrored as project members.
    """

    async def _sync(db_session: AsyncSession) -> None:
        project = await db_session.get(ProjectDB, uuid.UUID(project_id))
        if project is None:
            raise NoResultFound(f"Project with ID {project_id} not found")

        workspace_members_result = await db_session.execute(
            select(WorkspaceMemberDB).filter_by(workspace_id=project.workspace_id)
        )
        workspace_members = workspace_members_result.scalars().all()
        if not workspace_members:
            return

        user_ids = [member.user_id for member in workspace_members]
        existing_members_result = await db_session.execute(
            select(ProjectMemberDB).filter(
                ProjectMemberDB.project_id == project.id,
                ProjectMemberDB.user_id.in_(user_ids),
            )
        )
        existing_members = {
            member.user_id: member for member in existing_members_result.scalars().all()
        }

        for member in workspace_members:
            project_member = existing_members.get(member.user_id)
            if project_member:
                if project_member.role != member.role:
                    project_member.role = member.role
                continue

            project_member = ProjectMemberDB(
                user_id=member.user_id,
                project_id=project.id,
                role=member.role,
            )
            db_session.add(project_member)

            await db_session.commit()

            log.info(
                "[scopes] project membership created",
                organization_id=str(project.organization_id),
                workspace_id=str(project.workspace_id),
                project_id=str(project.id),
                user_id=str(member.user_id),
                membership_id=project_member.id,
            )

    if session is not None:
        await _sync(session)
        return

    async with engine.core_session() as new_session:
        await _sync(new_session)


async def get_default_workspace_id_from_organization(
    organization_id: str,
) -> Union[str, NoReturn]:
    """
    Get the default (first) workspace ID belonging to a user from a organization.

    Args:
        organization_id (str): The ID of the organization.

    Returns:
        str: The default (first) workspace ID.
    """

    async with engine.core_session() as session:
        workspace_query = await session.execute(
            select(WorkspaceDB)
            .where(
                WorkspaceDB.organization_id == uuid.UUID(organization_id),
            )
            .options(load_only(WorkspaceDB.id))
        )
        workspace = workspace_query.scalars().first()
        if workspace is None:
            raise NoResultFound(
                f"No default workspace for the provided organization_id {organization_id} found"
            )
        return str(workspace.id)


async def get_project_by_workspace(
    workspace_id: str,
    *,
    use_default: bool = True,
) -> ProjectDB:
    """Get the project from database using the organization id and workspace id.

    Args:
        workspace_id (str): The ID of the workspace

    Returns:
        ProjectDB: The retrieved project
    """

    assert workspace_id is not None, "Workspace ID is required to retrieve project"
    async with engine.core_session() as session:
        stmt = select(ProjectDB).where(
            ProjectDB.workspace_id == uuid.UUID(workspace_id),
        )
        if use_default:
            stmt = stmt.order_by(
                ProjectDB.is_default.desc(), ProjectDB.created_at.asc()
            )
        else:
            stmt = stmt.order_by(ProjectDB.created_at.asc())

        project_query = await session.execute(stmt)
        project = project_query.scalars().first()
        if project is None:
            raise NoResultFound(f"No project with workspace IDs ({workspace_id}) found")
        return project


async def create_project_member(
    user_id: str, project_id: str, role: str, session: AsyncSession
) -> None:
    """
    Create a new project member.

    Args:
        user_id (str): The ID of the user.
        project_id (str): The ID of the project.
        role (str): The role of the user in the workspace.
        session (AsyncSession): The database session.
    """

    project = await db_manager.fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    project_member = ProjectMemberDB(
        user_id=uuid.UUID(user_id),
        project_id=uuid.UUID(project_id),
        role=role,
    )

    session.add(project_member)

    await session.commit()

    log.info(
        "[scopes] project membership created",
        organization_id=project.organization_id,
        workspace_id=project.workspace_id,
        project_id=project_id,
        user_id=user_id,
        membership_id=project_member.id,
    )


async def fetch_project_memberships_by_user_id(
    user_id: str,
) -> List[ProjectMemberDB]:
    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectMemberDB)
            .filter_by(user_id=uuid.UUID(user_id))
            .options(
                joinedload(ProjectMemberDB.project).joinedload(ProjectDB.workspace),
                joinedload(ProjectMemberDB.project).joinedload(ProjectDB.organization),
            )
        )
        project_memberships = result.scalars().all()

        return project_memberships


async def create_workspace_db_object(
    session: AsyncSession,
    payload: CreateWorkspace,
    organization: OrganizationDB,
    user: UserDB,
    return_wrk_prj: bool = False,
) -> WorkspaceDB:
    """Create a new workspace.

    Args:
        payload (Workspace): The workspace payload.
        organization (OrganizationDB): The organization that the workspace belongs to.
        user (UserDB): The user that the workspace belongs to.

    Returns:
        Workspace: The created workspace.
    """

    workspace = WorkspaceDB(
        name=payload.name,
        type=payload.type if payload.type else "",
        description=payload.description if payload.description else "",
        organization_id=organization.id,
    )

    session.add(workspace)

    await session.commit()

    log.info(
        "[scopes] workspace created",
        organization_id=organization.id,
        workspace_id=workspace.id,
    )

    # add user as a member to the workspace with the owner role
    workspace_member = WorkspaceMemberDB(
        user_id=user.id,
        workspace_id=workspace.id,
        role="owner",
    )

    session.add(workspace_member)

    await session.commit()
    await session.refresh(workspace, attribute_names=["organization"])

    log.info(
        "[scopes] workspace membership created",
        organization_id=workspace.organization_id,
        workspace_id=workspace.id,
        user_id=user.id,
        membership_id=workspace_member.id,
    )

    project_db = await create_default_project(
        organization_id=str(organization.id),
        workspace_id=str(workspace.id),
        session=session,
    )

    # add user as a member to the project member with the owner role
    await create_project_member(
        user_id=str(user.id),
        project_id=str(project_db.id),
        role=workspace_member.role,
        session=session,
    )

    # add default testsets and evaluators
    await db_manager.add_default_simple_testsets(
        project_id=str(project_db.id),
        user_id=str(user.id),
    )
    await db_manager.add_default_simple_evaluators(
        project_id=str(project_db.id),
        user_id=str(user.id),
    )

    # add default human evaluator for annotation
    # Import here to avoid circular import at module load time
    from oss.src.core.evaluators.defaults import create_default_human_evaluator

    await create_default_human_evaluator(
        project_id=project_db.id,
        user_id=user.id,
    )

    # Create default project-scoped environments for the default project.
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_environments(
        project_id=project_db.id,
        user_id=user.id,
    )

    if return_wrk_prj:
        return workspace, project_db

    return workspace


async def create_workspace(
    payload: CreateWorkspace, organization_id: str, user_uid: str
) -> WorkspaceResponse:
    """
    Create a new workspace.

    Args:
        payload (CreateWorkspace): The workspace payload.
        organization_id (str): The organization id.
        user_uid (str): The user uid.

    Returns:
        Workspace: The created workspace.

    """
    try:
        user = await db_manager.get_user(user_uid)
        organization = await get_organization(organization_id)

        async with engine.core_session() as session:
            user_result = await session.execute(select(UserDB).filter_by(uid=user_uid))
            user = user_result.scalars().first()

            organization_result = await session.execute(
                select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
            )
            organization = organization_result.scalars().first()

            # create workspace
            workspace_db = await create_workspace_db_object(
                session, payload, organization, user
            )

            return await get_workspace_in_format(workspace_db)
    except Exception as e:
        raise e


async def update_workspace(
    payload: UpdateWorkspace, workspace: WorkspaceDB
) -> WorkspaceResponse:
    """
    Update a workspace's details.

    Args:
        workspace (WorkspaceDB): The workspace to update.
        payload (UpdateWorkspace): The data to update the workspace with.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(WorkspaceDB).filter_by(id=workspace.id))
        workspace = result.scalars().first()

        if not workspace:
            raise NoResultFound(f"Workspace with id {str(workspace.id)} not found")

        for key, value in payload.dict(exclude_unset=True).items():
            if hasattr(workspace, key):
                setattr(workspace, key, value)

        await session.commit()
        await session.refresh(workspace)

        return await get_workspace_in_format(workspace)


async def check_user_in_workspace_with_email(email: str, workspace_id: str) -> bool:
    """
    Check if a user belongs to a workspace.

    Args:
        email (str): The email of the user to check.
        workspace_id (str): The workspace to check.

    Raises:
        Exception: If there is an error checking if the user belongs to the workspace.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB)
            .join(UserDB, UserDB.id == WorkspaceMemberDB.user_id)
            .where(
                UserDB.email == email,
                WorkspaceMemberDB.workspace_id == uuid.UUID(workspace_id),
            )
        )
        workspace_member = result.scalars().first()
        return False if workspace_member is None else True


async def update_user_roles(
    workspace_id: str,
    payload: UserRole,
    delete: bool = False,
) -> bool:
    """
    Update a user's roles in a workspace.

    Args:
        workspace_id (str): The ID of the workspace.
        payload (UserRole): The payload containing the user email and role to update.
        delete (bool): Whether to delete the user's role or not.

    Returns:
        bool: True if the user's roles were successfully updated, False otherwise.

    Raises:
        Exception: If there is an error updating the user's roles.
    """

    user = await db_manager.get_user_with_email(payload.email)
    projects = await db_manager.fetch_projects_by_workspace(workspace_id)
    if not projects:
        raise NoResultFound(
            f"No projects found for the provided workspace_id {workspace_id}"
        )

    async with engine.core_session() as session:
        workspace_member_result = await session.execute(
            select(WorkspaceMemberDB).filter_by(
                workspace_id=uuid.UUID(workspace_id), user_id=user.id
            )
        )
        workspace_member = workspace_member_result.scalars().first()
        if not workspace_member:
            raise NoResultFound(
                f"User with id {str(user.id)} is not part of the workspace member."
            )

        if workspace_member.role == "owner":
            raise HTTPException(
                403,
                {
                    "message": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        project_ids = [project.id for project in projects]
        project_members_result = await session.execute(
            select(ProjectMemberDB).filter(
                ProjectMemberDB.project_id.in_(project_ids),
                ProjectMemberDB.user_id == user.id,
            )
        )
        project_members = project_members_result.scalars().all()
        if len(project_members) != len(project_ids):
            for project in projects:
                await sync_workspace_members_to_project(
                    str(project.id), session=session
                )

            project_members_result = await session.execute(
                select(ProjectMemberDB).filter(
                    ProjectMemberDB.project_id.in_(project_ids),
                    ProjectMemberDB.user_id == user.id,
                )
            )
            project_members = project_members_result.scalars().all()

        if len(project_members) != len(project_ids):
            raise NoResultFound(
                f"User with id {str(user.id)} is not part of all project memberships."
            )

        if not delete:
            workspace_member.role = payload.role
            for member in project_members:
                member.role = payload.role

        await session.commit()

        default_project_id = next(
            (project.id for project in projects if project.is_default),
            projects[0].id,
        )
        default_project_member = next(
            (
                member
                for member in project_members
                if member.project_id == default_project_id
            ),
            None,
        )
        if default_project_member:
            await session.refresh(default_project_member)

        return True


async def add_user_to_workspace_and_org(
    organization: OrganizationDB,
    workspace: WorkspaceDB,
    user: UserDB,
    project_id: str,
    role: str,
) -> bool:
    project = await db_manager.get_project_by_id(project_id=project_id)
    if project and str(project.workspace_id) != str(workspace.id):
        raise ValueError("Project does not belong to the provided workspace")

    async with engine.core_session() as session:
        # create joined organization for user
        user_organization = OrganizationMemberDB(
            user_id=user.id, organization_id=organization.id
        )

        session.add(user_organization)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization.id,
            user_id=user.id,
            membership_id=user_organization.id,
        )

        # add user to workspace
        workspace_member = WorkspaceMemberDB(
            user_id=user.id,
            workspace_id=workspace.id,
            role=role,
        )

        session.add(workspace_member)

        await session.commit()

        log.info(
            "[scopes] workspace membership created",
            organization_id=organization.id,
            workspace_id=workspace.id,
            user_id=user.id,
            membership_id=workspace_member.id,
        )

        projects = await db_manager.fetch_projects_by_workspace(str(workspace.id))
        if not projects:
            raise NoResultFound(
                f"No projects found for workspace_id {str(workspace.id)}"
            )

        existing_members_result = await session.execute(
            select(ProjectMemberDB).filter(
                ProjectMemberDB.project_id.in_([project.id for project in projects]),
                ProjectMemberDB.user_id == user.id,
            )
        )
        existing_members = {
            member.project_id: member
            for member in existing_members_result.scalars().all()
        }

        for project in projects:
            if project.id in existing_members:
                continue

            project_member = ProjectMemberDB(
                user_id=user.id,
                project_id=project.id,
                role=role,
            )

            session.add(project_member)

            await session.commit()

            log.info(
                "[scopes] project membership created",
                organization_id=str(project.organization_id),
                workspace_id=str(project.workspace_id),
                project_id=str(project.id),
                user_id=str(user.id),
                membership_id=project_member.id,
            )

        return True


async def remove_user_from_workspace(
    workspace_id: str,
    email: str,
) -> WorkspaceResponse:
    """
    Remove a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.
        payload (UserRole): The payload containing the user email and role to remove.

    Returns:
        workspace (WorkspaceResponse): The updated workspace.

    Raises:
        HTTPException -- 403, from fastapi import Request
    """

    user = await db_manager.get_user_with_email(email)
    workspace = await db_manager.get_workspace(workspace_id=workspace_id)
    if workspace is None:
        raise NoResultFound(f"Workspace with ID {workspace_id} not found")

    projects = await db_manager.fetch_projects_by_workspace(workspace_id)
    if not projects:
        raise NoResultFound(
            f"No projects found for the provided workspace_id {workspace_id}"
        )
    project_ids = [project.id for project in projects]

    async with engine.core_session() as session:
        if not user:  # User is an invited user who has not yet created an account and therefore does not have a user object
            pass
        else:
            # Ensure that a user can not remove the owner of the workspace
            workspace_owner_result = await session.execute(
                select(WorkspaceMemberDB)
                .filter_by(workspace_id=workspace.id, user_id=user.id, role="owner")
                .options(
                    load_only(
                        WorkspaceMemberDB.user_id,  # type: ignore
                        WorkspaceMemberDB.role,  # type: ignore
                    )
                )
            )
            workspace_owner = workspace_owner_result.scalars().first()
            if (workspace_owner is not None and user is not None) and (
                user.id == workspace_owner.user_id and workspace_owner.role == "owner"
            ):
                raise HTTPException(
                    status_code=403,
                    detail={
                        "message": "You do not have permission to perform this action. Please contact your Organization Owner"
                    },
                )

            # remove user from workspace
            workspace_member_result = await session.execute(
                select(WorkspaceMemberDB).filter(
                    WorkspaceMemberDB.workspace_id == workspace.id,
                    WorkspaceMemberDB.user_id == user.id,
                )
            )
            workspace_member = workspace_member_result.scalars().first()
            if workspace_member and workspace_member.role != "owner":
                await session.delete(workspace_member)

                log.info(
                    "[scopes] workspace membership deleted",
                    organization_id=str(workspace.organization_id),
                    workspace_id=str(workspace_id),
                    user_id=str(user.id),
                    membership_id=workspace_member.id,
                )

            # remove user from project
            project_member_result = await session.execute(
                select(ProjectMemberDB).filter(
                    ProjectMemberDB.project_id.in_(project_ids),
                    ProjectMemberDB.user_id == user.id,
                    ProjectMemberDB.role != "owner",
                )
            )
            for project_member in project_member_result.scalars().all():
                await session.delete(project_member)

                log.info(
                    "[scopes] project membership deleted",
                    organization_id=str(workspace.organization_id),
                    workspace_id=str(workspace_id),
                    project_id=str(project_member.project_id),
                    user_id=str(user.id),
                    membership_id=project_member.id,
                )

            # remove user from organization
            joined_org_result = await session.execute(
                select(OrganizationMemberDB).filter_by(
                    user_id=user.id, organization_id=workspace.organization_id
                )
            )
            member_joined_org = joined_org_result.scalars().first()
            if member_joined_org:
                await session.delete(member_joined_org)

                log.info(
                    "[scopes] organization membership deleted",
                    organization_id=str(workspace.organization_id),
                    user_id=str(user.id),
                    membership_id=member_joined_org.id,
                )

            await session.commit()

        # If there's an invitation for the provided email address, delete it
        user_workspace_invitations_query = await session.execute(
            select(InvitationDB)
            .filter(
                InvitationDB.project_id.in_(project_ids),
                InvitationDB.email == email,
            )
            .options(
                load_only(
                    InvitationDB.id,  # type: ignore
                    InvitationDB.project_id,  # type: ignore
                )
            )
        )
        user_invitations = user_workspace_invitations_query.scalars().all()
        for invitation in user_invitations:
            await delete_invitation(str(invitation.id))

        workspace_db = await db_manager.get_workspace(workspace_id=workspace_id)
        return await get_workspace_in_format(workspace_db)


async def create_organization(
    payload: CreateOrganization,
    user: UserDB,
    return_org_wrk: Optional[bool] = False,
    return_org_wrk_prj: Optional[bool] = False,
) -> Union[
    OrganizationDB,
    Tuple[OrganizationDB, WorkspaceDB],
    Tuple[OrganizationDB, WorkspaceDB, ProjectDB],
]:
    """Create a new organization.

    Args:
        payload (Organization): The organization payload.

    Returns:
        Organization: The created organization.
        Optional[Workspace]: The created workspace if return_org_wrk is True.

    Raises:
        Exception: If there is an error creating the organization.
    """

    async with engine.core_session() as session:
        create_org_data = payload.model_dump(exclude_unset=True)

        is_demo = create_org_data.pop("is_demo", False)

        create_org_data["flags"] = {
            "is_demo": is_demo,
            "allow_email": env.auth.email_enabled,
            "allow_social": env.auth.oidc_enabled,
            "allow_sso": False,
            "allow_root": False,
            "domains_only": False,
            "auto_join": False,
        }

        # Set required audit fields
        create_org_data["owner_id"] = user.id
        create_org_data["created_by_id"] = user.id

        # create organization
        organization_db = OrganizationDB(**create_org_data)
        session.add(organization_db)

        await session.commit()

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        # create joined organization for user
        user_organization = OrganizationMemberDB(
            user_id=user.id,
            organization_id=organization_db.id,
            role="owner",
        )
        session.add(user_organization)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_db.id,
            user_id=user.id,
            role="owner",
            membership_id=user_organization.id,
        )

        # construct workspace payload
        workspace_payload = CreateWorkspace(
            name="Default",
            type="default",
        )

        # create workspace
        workspace, project = await create_workspace_db_object(
            session,
            workspace_payload,
            organization_db,
            user,
            return_wrk_prj=True,
        )

        if return_org_wrk_prj:
            return organization_db, workspace, project

        if return_org_wrk:
            return organization_db, workspace

        return organization_db


async def update_organization(
    organization_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    """
    Update an organization's details.

    Args:
        organization_id (str): The organization to update.
        payload (OrganizationUpdate): The data to update the organization with.

    Returns:
        Organization: The updated organization.

    Raises:
        Exception: If there is an error updating the organization.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        # Validate slug updates before applying
        payload_dict = payload.model_dump(exclude_unset=True)
        if "slug" in payload_dict:
            new_slug = payload_dict["slug"]

            # Slug format validation: only lowercase letters and hyphens, max 64 characters
            if new_slug is not None:
                import re

                if len(new_slug) > 64:
                    raise ValueError("Organization slug cannot exceed 64 characters.")
                if not re.match(r"^[a-z-]+$", new_slug):
                    raise ValueError(
                        "Organization slug can only contain lowercase letters (a-z) and hyphens (-)."
                    )

            # Slug immutability: once set, cannot be changed
            if organization.slug is not None and new_slug != organization.slug:
                raise ValueError(
                    f"Organization slug cannot be changed once set. "
                    f"Current slug: '{organization.slug}'"
                )

        # Special handling for flags: merge instead of replace
        if "flags" in payload_dict:
            new_flags = payload_dict["flags"]
            if new_flags is not None:
                # Get existing flags or initialize with defaults
                existing_flags = organization.flags or {}

                # Start with complete defaults
                default_flags = {
                    "is_demo": False,
                    "allow_email": env.auth.email_enabled,
                    "allow_social": env.auth.oidc_enabled,
                    "allow_sso": False,
                    "allow_root": False,
                    "domains_only": False,
                    "auto_join": False,
                }

                # Merge: defaults <- existing <- new
                merged_flags = {**default_flags, **existing_flags, **new_flags}

                # VALIDATION: Ensure at least one auth method is enabled OR allow_root is true
                # This prevents organizations from being locked out
                allow_email = merged_flags.get("allow_email", False)
                allow_social = merged_flags.get("allow_social", False)
                allow_sso = merged_flags.get("allow_sso", False)
                allow_root = merged_flags.get("allow_root", False)

                changing_auth_flags = any(
                    key in new_flags
                    for key in ("allow_email", "allow_social", "allow_sso")
                )
                changing_auto_join = "auto_join" in new_flags
                changing_domains_only = "domains_only" in new_flags

                if changing_auth_flags and allow_sso:
                    providers_dao = OrganizationProvidersDAO(session)
                    providers = await providers_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    active_valid = [
                        provider
                        for provider in providers
                        if (provider.flags or {}).get("is_active")
                        and (provider.flags or {}).get("is_valid")
                    ]
                    if not active_valid:
                        raise ValueError(
                            "SSO cannot be enabled until at least one SSO provider is "
                            "active and verified."
                        )
                    if not allow_email and not allow_social:
                        if not active_valid:
                            raise ValueError(
                                "SSO-only authentication requires at least one SSO provider to "
                                "be active and verified."
                            )

                if changing_auto_join and merged_flags.get("auto_join", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Auto-join requires at least one verified domain."
                        )

                if changing_domains_only and merged_flags.get("domains_only", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Domains-only requires at least one verified domain."
                        )

                # Check if all auth methods are disabled
                all_auth_disabled = not (allow_email or allow_social or allow_sso)

                if all_auth_disabled and not allow_root:
                    # Auto-enable allow_root to prevent lockout
                    merged_flags["allow_root"] = True
                    log.warning(
                        f"All authentication methods disabled for organization {organization_id}. "
                        f"Auto-enabling allow_root to prevent lockout."
                    )

                organization.flags = merged_flags
            # Remove flags from payload_dict to avoid setting it again below
            del payload_dict["flags"]

        # Set all other attributes
        for key, value in payload_dict.items():
            if hasattr(organization, key):
                setattr(organization, key, value)

        try:
            await session.commit()
        except Exception as e:
            if isinstance(e, IntegrityError) and "uq_organizations_slug" in str(e):
                raise OrganizationSlugConflictError(
                    slug=payload_dict.get("slug", "unknown")
                ) from e
            raise

        await session.refresh(organization)
        return organization


async def delete_organization(organization_id: str) -> bool:
    """
    Delete an organization and all its related data.

    Args:
        organization_id (str): The organization ID to delete.

    Returns:
        bool: True if deletion was successful.

    Raises:
        NoResultFound: If organization not found.
    """
    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        await session.delete(organization)
        await session.commit()
        return True


async def delete_invitation(invitation_id: str) -> bool:
    """
    Delete an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.

    Returns:
        bool: True if the invitation was successfully deleted, False otherwise.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table.",
                exc_info=True,
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occured while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        project = await session.execute(
            select(ProjectDB).filter_by(id=invitation.project_id)
        )
        project = project.scalars().one_or_none()

        if not project:
            log.error(f"Project with ID {invitation.project_id} not found.")
            raise Exception(f"No project found with ID {invitation.project_id}")

        await session.delete(invitation)

        log.info(
            "[scopes] invitation deleted",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=invitation.project_id,
            user_id=invitation.user_id,
            membership_id=invitation.id,
        )

        await session.commit()

        return True


async def mark_invitation_as_used(
    project_id: str, user_id: str, invitation: InvitationDB
) -> bool:
    """
    Mark an invitation as used.

    Args:
        project_id (str): The ID of the project.
        user_id (str): the ID of the user.
        invitation (InvitationDB): The invitation to mark as used.

    Returns:
        bool: True if the invitation was successfully marked as used, False otherwise.

    Raises:
        HTTPException: If there is an error marking the invitation as used.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=invitation.token
            )
        )
        organization_invitation = result.scalars().first()
        if not organization_invitation:
            return False

        organization_invitation.used = True
        organization_invitation.user_id = uuid.UUID(user_id)

        await session.commit()
        return True


async def get_org_details(
    organization: Organization,
) -> dict:
    """
    Retrieve details of an organization.

    Args:
        organization (Organization): The organization to retrieve details for.

    Returns:
        dict: A dictionary containing the organization's details.
    """

    # Skip members for demo organizations to avoid returning thousands of users
    is_demo = organization.flags.get("is_demo", False) if organization.flags else False

    default_workspace_db = await get_org_default_workspace(organization)
    default_workspace = (
        await get_workspace_details(default_workspace_db, include_members=not is_demo)
        if default_workspace_db is not None
        else None
    )
    workspaces = await get_organization_workspaces(organization_id=str(organization.id))

    sample_organization = {
        "id": str(organization.id),
        "slug": organization.slug,
        "name": organization.name,
        "description": organization.description,
        "flags": organization.flags,
        "owner_id": str(organization.owner_id),
        "workspaces": [str(workspace.id) for workspace in workspaces],
        "default_workspace": default_workspace,
    }
    return sample_organization


async def get_workspace_details(
    workspace: WorkspaceDB, include_members: bool = True
) -> WorkspaceResponse:
    """
    Retrieve details of a workspace.

    Args:
        workspace (Workspace): The workspace to retrieve details for.
        include_members (bool): Whether to include workspace members. Defaults to True.

    Returns:
        dict: A dictionary containing the workspace's details.

    Raises:
        Exception: If there is an error retrieving the workspace details.
    """

    try:
        workspace_response = await get_workspace_in_format(
            workspace, include_members=include_members
        )
        return workspace_response
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise e


async def get_project_invitations(project_id: str, **kwargs):
    """
    Gets the project invitations.

    Args:
        project_id (str): The ID of the project
    """

    async with engine.core_session() as session:
        stmt = select(InvitationDB).filter(
            InvitationDB.project_id == uuid.UUID(project_id)
        )
        if kwargs.get("has_pending", False):
            stmt = stmt.filter(InvitationDB.used == kwargs["invitation_used"])

        result = await session.execute(stmt)
        invitations = result.scalars().all()
        return invitations


async def get_all_pending_invitations(email: str):
    """
    Gets all pending invitations for a given email.

    Args:
        email (str): The email address of the user.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter(
                InvitationDB.email == email,
                InvitationDB.used == False,  # noqa: E712
            )
        )
        invitations = result.scalars().all()
        return invitations


async def get_project_invitation(
    project_id: str, token: str, email: str
) -> InvitationDB:
    """Get project invitation by project ID, token and email.

    Args:
        project_id (str): The ID of the project.
        token (str): The invitation token.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token, email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_project_members(project_id: str):
    """Gets the members of a project.

    Args:
        project_id (str): The ID of the project
    """

    async with engine.core_session() as session:
        members_query = await session.execute(
            select(ProjectMemberDB)
            .filter(ProjectMemberDB.project_id == uuid.UUID(project_id))
            .options(joinedload(ProjectMemberDB.user))
        )
        project_members = members_query.scalars().all()
        return project_members


async def project_member_exists(
    *,
    project_id: str,
    user_id: str,
) -> bool:
    """Check whether a user is a member of a project.

    Uses an EXISTS sub-query so the database can stop at the first
    matching row instead of materialising the full member list.

    Args:
        project_id: The project to check.
        user_id: The user to look for.

    Returns:
        True if the user belongs to the project, False otherwise.
    """

    async with engine.core_session() as session:
        stmt = select(
            select(ProjectMemberDB.id)
            .filter(
                ProjectMemberDB.project_id == uuid.UUID(project_id),
                ProjectMemberDB.user_id == uuid.UUID(user_id),
            )
            .exists()
        )
        result = await session.execute(stmt)
        return result.scalar() or False


async def workspace_member_exists(
    *,
    workspace_id: str,
    user_id: str,
) -> bool:
    """Check whether a user is a member of a workspace.

    Uses an EXISTS sub-query so the database can stop at the first
    matching row instead of materialising the full member list.

    Args:
        workspace_id: The workspace to check.
        user_id: The user to look for.

    Returns:
        True if the user belongs to the workspace, False otherwise.
    """

    async with engine.core_session() as session:
        stmt = select(
            select(WorkspaceMemberDB.id)
            .filter(
                WorkspaceMemberDB.workspace_id == uuid.UUID(workspace_id),
                WorkspaceMemberDB.user_id == uuid.UUID(user_id),
            )
            .exists()
        )
        result = await session.execute(stmt)
        return result.scalar() or False


async def create_org_workspace_invitation(
    workspace_role: str,
    token: str,
    email: str,
    project_id: str,
    expiration_date,
) -> InvitationDB:
    """
    Create an organization invitation.

    Args:
    - workspace_role (str): The role to assign the invited user in the project/workspace.
    - token (str): The token for the invitation.
    - email (str): The email address of the invited user.
    - expiration_date: The expiration date of the invitation.

    Returns:
    InvitationDB: The created invitation.

    """

    user = await db_manager.get_user_with_email(email=email)

    user_id = None
    if user:
        user_id = user.id

    project = await db_manager.fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    async with engine.core_session() as session:
        invitation = InvitationDB(
            token=token,
            email=email,
            project_id=uuid.UUID(project_id),
            expiration_date=expiration_date,
            role=workspace_role,
            used=False,
        )

        session.add(invitation)

        log.info(
            "[scopes] invitation created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return invitation


async def get_all_workspace_roles() -> List[WorkspaceRole]:
    """
    Retrieve all workspace roles.

    Returns:
        List[WorkspaceRole]: A list of all workspace roles in the DB.
    """
    workspace_roles = list(WorkspaceRole)
    return workspace_roles


async def add_user_to_organization(
    organization_id: str,
    user_id: str,
    role: str = "member",
    # is_demo: bool = False,
) -> None:
    async with engine.core_session() as session:
        organization_member = OrganizationMemberDB(
            user_id=user_id,
            organization_id=organization_id,
            role=role,
        )

        session.add(organization_member)

        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            membership_id=organization_member.id,
        )


async def add_user_to_workspace(
    workspace_id: str,
    user_id: str,
    role: str,
    # is_demo: bool = False,
) -> None:
    async with engine.core_session() as session:
        # fetch workspace by workspace_id (SQL)
        stmt = select(WorkspaceDB).filter_by(id=workspace_id)
        workspace = await session.execute(stmt)
        workspace = workspace.scalars().first()

        if not workspace:
            raise Exception(f"No workspace found with ID {workspace_id}")

        workspace_member = WorkspaceMemberDB(
            user_id=user_id,
            workspace_id=workspace_id,
            role=role,
        )

        session.add(workspace_member)

        await session.commit()

        log.info(
            "[scopes] workspace membership created",
            organization_id=workspace.organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            membership_id=workspace_member.id,
        )


async def add_user_to_project(
    project_id: str,
    user_id: str,
    role: str,
    is_demo: bool = False,
) -> None:
    project = await db_manager.fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    async with engine.core_session() as session:
        project_member = ProjectMemberDB(
            user_id=user_id,
            project_id=project_id,
            role=role,
            is_demo=is_demo,
        )

        session.add(project_member)

        await session.commit()

        log.info(
            "[scopes] project membership created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            membership_id=project_member.id,
        )


async def transfer_organization_ownership(
    organization_id: str,
    new_owner_id: str,
    current_user_id: str,
) -> OrganizationDB:
    """Transfer organization ownership to another member.

    Args:
        organization_id: The ID of the organization
        new_owner_id: The UUID of the new owner
        current_user_id: The UUID of the current user (initiating the transfer)

    Returns:
        OrganizationDB: The updated organization

    Raises:
        ValueError: If new owner is not a member of the organization
    """
    async with engine.core_session() as session:
        # Verify organization exists
        org_result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = org_result.scalars().first()
        if not organization:
            raise ValueError(f"Organization {organization_id} not found")

        # Check if new owner is a member
        member_result = await session.execute(
            select(OrganizationMemberDB).filter_by(
                user_id=uuid.UUID(new_owner_id),
                organization_id=uuid.UUID(organization_id),
            )
        )
        member = member_result.scalars().first()
        if not member:
            raise ValueError("The new owner must be a member of the organization")

        # Swap organization roles between current owner and new owner
        current_owner_org_member_result = await session.execute(
            select(OrganizationMemberDB).filter_by(
                user_id=uuid.UUID(current_user_id),
                organization_id=uuid.UUID(organization_id),
            )
        )
        current_owner_org_member = current_owner_org_member_result.scalars().first()

        if current_owner_org_member:
            # Swap org roles
            current_owner_org_old_role = current_owner_org_member.role
            new_owner_org_old_role = member.role

            current_owner_org_member.role = new_owner_org_old_role
            member.role = current_owner_org_old_role

            log.info(
                "[organization] roles swapped",
                organization_id=organization_id,
                current_owner_id=current_user_id,
                current_owner_old_role=current_owner_org_old_role,
                current_owner_new_role=new_owner_org_old_role,
                new_owner_id=new_owner_id,
                new_owner_old_role=new_owner_org_old_role,
                new_owner_new_role=current_owner_org_old_role,
            )

        # Get all workspaces in this organization
        workspaces_result = await session.execute(
            select(WorkspaceDB).filter_by(organization_id=uuid.UUID(organization_id))
        )
        workspaces = workspaces_result.scalars().all()

        # Update workspace roles for both users in all workspaces - swap their roles
        for workspace in workspaces:
            # Get both members' workspace roles
            current_owner_member_result = await session.execute(
                select(WorkspaceMemberDB).filter_by(
                    user_id=uuid.UUID(current_user_id),
                    workspace_id=workspace.id,
                )
            )
            current_owner_member = current_owner_member_result.scalars().first()

            new_owner_member_result = await session.execute(
                select(WorkspaceMemberDB).filter_by(
                    user_id=uuid.UUID(new_owner_id),
                    workspace_id=workspace.id,
                )
            )
            new_owner_member = new_owner_member_result.scalars().first()

            # Swap roles between the two users
            if current_owner_member and new_owner_member:
                current_owner_old_role = current_owner_member.role
                new_owner_old_role = new_owner_member.role

                # Swap the roles
                current_owner_member.role = new_owner_old_role
                new_owner_member.role = current_owner_old_role

                log.info(
                    "[workspace] roles swapped",
                    workspace_id=str(workspace.id),
                    current_owner_id=current_user_id,
                    current_owner_old_role=current_owner_old_role,
                    current_owner_new_role=new_owner_old_role,
                    new_owner_id=new_owner_id,
                    new_owner_old_role=new_owner_old_role,
                    new_owner_new_role=current_owner_old_role,
                )
            elif current_owner_member:
                # Only current owner is a member - keep their role
                log.info(
                    "[workspace] new owner not a member",
                    workspace_id=str(workspace.id),
                    user_id=new_owner_id,
                )
            elif new_owner_member:
                # Only new owner is a member - keep their role
                log.info(
                    "[workspace] current owner not a member",
                    workspace_id=str(workspace.id),
                    user_id=current_user_id,
                )

        # Transfer ownership
        organization.owner_id = uuid.UUID(new_owner_id)
        organization.updated_at = datetime.now(timezone.utc)
        organization.updated_by_id = uuid.UUID(current_user_id)

        await session.commit()
        await session.refresh(organization)

        log.info(
            "[organization] ownership transferred",
            organization_id=organization_id,
            old_owner_id=current_user_id,
            new_owner_id=new_owner_id,
        )

        return organization
