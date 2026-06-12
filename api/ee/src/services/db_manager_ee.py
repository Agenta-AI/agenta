from typing import Any, Dict, List, Set, Union, NoReturn, Optional
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from sqlalchemy import delete, update
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, load_only
from sqlalchemy.exc import NoResultFound, MultipleResultsFound
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import (
    get_transactions_engine,
)
from oss.src.services import db_manager
from oss.src.services.db_manager import (  # noqa: F401 — moved OSS-ward, re-exported
    add_user_to_organization,
    add_user_to_workspace,
    add_user_to_project,
    add_user_to_workspace_and_org,
    transfer_organization_ownership,
    count_organizations_by_owner,
    delete_organization,
)
from ee.src.core.workspaces.types import (
    UserRole,
    UpdateWorkspace,
    CreateWorkspace,
    WorkspaceResponse,
)
from ee.src.core.organizations.types import (
    Organization,
    OrganizationUpdate,
)
from ee.src.core.access.permissions.types import Permission, RequiredRole
from ee.src.core.access.controls import (
    get_roles,
    get_role_description,
    get_role_permissions,
)

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
    DeploymentDB,
)

from ee.src.core.organizations.exceptions import (
    OrganizationSlugConflictError,
)

from ee.src.dbs.postgres.organizations.dao import (
    OrganizationProvidersDAO,
    OrganizationDomainsDAO,
)

from oss.src.utils.env import env


log = get_module_logger(__name__)


async def get_organization(organization_id: str) -> OrganizationDB:
    """
    Fetches an organization by its ID.

    Args:
        organization_id (str): The ID of the organization to fetch.

    Returns:
        OrganizationDB: The fetched organization.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
        organization_uuids = [
            uuid.UUID(organization_id) for organization_id in organization_ids
        ]
        query = select(OrganizationDB).where(OrganizationDB.id.in_(organization_uuids))
        result = await session.execute(query)
        organizations = result.scalars().all()
        return organizations


async def get_default_workspace_id(user_id: str) -> str:
    """
    Retrieve the default workspace ID for a user.

    Args:
        user_id (str): The user id.

    Returns:
        str: The default workspace ID.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB)
            .filter_by(user_id=uuid.UUID(user_id))
            .options(  # type: ignore
                load_only(
                    WorkspaceMemberDB.workspace_id,
                    WorkspaceMemberDB.role,
                    WorkspaceMemberDB.created_at,
                )
            )
        )
        memberships = list(result.scalars().all())

        if not memberships:
            raise NoResultFound(f"No workspace membership found for user {user_id}")

        owner_membership = next(
            (
                membership
                for membership in memberships
                if membership.role == RequiredRole.OWNER
            ),
            None,
        )
        if owner_membership is not None:
            return str(owner_membership.workspace_id)

        memberships.sort(
            key=lambda membership: (
                membership.created_at or datetime.min.replace(tzinfo=timezone.utc),
                str(membership.workspace_id),
            )
        )
        return str(memberships[0].workspace_id)


async def get_organization_workspaces(organization_id: str):
    """
    Retries workspaces belonging to an organization.

    Args:
        organization_id (str): The ID of the organization
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB).where(
                WorkspaceMemberDB.workspace_id == workspace_id
            )
        )
        return list(result.scalars().all())


async def get_workspace_administrators(workspace: WorkspaceDB) -> List[UserDB]:
    """
    Retrieve the administrators of a workspace.

    Administrators are members whose role is ADMIN or OWNER.
    """

    # Fetch all membership rows for this workspace
    members = await get_workspace_members(workspace_id=str(workspace.id))

    admin_user_ids = [
        str(member.user_id)
        for member in members
        if member.role in (RequiredRole.ADMIN, RequiredRole.OWNER)
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

    engine = get_transactions_engine()
    async with engine.session() as new_session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
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
    engine = get_transactions_engine()

    async with engine.session() as session:
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

    # add default testsets
    await db_manager.add_default_simple_testsets(
        project_id=str(project_db.id),
        user_id=str(user.id),
    )

    # Create default evaluators and environments for the new project.
    # Import here to avoid circular import at module load time
    from oss.src.core.evaluators.defaults import create_default_evaluators
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_evaluators(
        project_id=project_db.id,
        user_id=user.id,
    )
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

        engine = get_transactions_engine()

        async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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


async def remove_user_from_workspace(
    workspace_id: str,
    email: str,
) -> bool:
    """
    Remove a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.
        payload (UserRole): The payload containing the user email and role to remove.

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

    engine = get_transactions_engine()

    async with engine.session() as session:
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
                    InvitationDB.user_id,  # type: ignore
                )
            )
        )
        user_invitations = user_workspace_invitations_query.scalars().all()
        for invitation in user_invitations:
            await session.delete(invitation)

            log.info(
                "[scopes] invitation deleted",
                organization_id=str(workspace.organization_id),
                workspace_id=str(workspace_id),
                project_id=str(invitation.project_id),
                user_id=str(invitation.user_id) if invitation.user_id else None,
                membership_id=invitation.id,
            )

        await session.commit()

        return True


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

    engine = get_transactions_engine()

    async with engine.session() as session:
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


async def delete_invitation(invitation_id: str) -> bool:
    """
    Delete an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.

    Returns:
        bool: True if the invitation was successfully deleted, False otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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

    engine = get_transactions_engine()

    async with engine.session() as session:
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


async def get_all_workspace_roles() -> List[dict]:
    """Return the effective workspace role catalog.

    Resolved via access-controls (env-overridable via `AGENTA_ACCESS_ROLES`).
    Each entry is a dict with `role`, `description`, and `permissions`.
    """
    return get_roles("workspace")


# ---------------------------------------------------------------------------
# Platform Admin helpers
# ---------------------------------------------------------------------------


async def admin_delete_org_membership(membership_id: uuid.UUID) -> bool:
    """Delete an org membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_delete_workspace_membership(membership_id: uuid.UUID) -> bool:
    """Delete a workspace membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_delete_project_membership(membership_id: uuid.UUID) -> bool:
    """Delete a project membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(ProjectMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_get_member_org_ids(
    user_id: uuid.UUID,
    org_ids: List[uuid.UUID],
) -> Set[uuid.UUID]:
    """Return the subset of org_ids where the user has a membership row."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB.organization_id).where(
                        OrganizationMemberDB.user_id == user_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        return set(rows)


async def admin_swap_org_memberships(
    org_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap org membership roles between source and target.

    Pre-condition: only acts on orgs where BOTH source and target already have
    a membership row.  For each qualifying org, target gets source's role and
    source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == source_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == target_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_org = {row.organization_id: row.role for row in source_rows}
        target_by_org = {row.organization_id: row.role for row in target_rows}

        for org_id in set(source_by_org) & set(target_by_org):
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == target_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=source_by_org[org_id])
            )
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == source_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=target_by_org[org_id])
            )

        await session.commit()


async def admin_swap_workspace_memberships(
    workspace_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap workspace membership roles between source and target.

    Pre-condition: only acts on workspaces where BOTH source and target already
    have a membership row.  For each qualifying workspace, target gets source's
    role and source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(WorkspaceMemberDB).where(
                        WorkspaceMemberDB.user_id == source_id,
                        WorkspaceMemberDB.workspace_id.in_(workspace_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(WorkspaceMemberDB).where(
                        WorkspaceMemberDB.user_id == target_id,
                        WorkspaceMemberDB.workspace_id.in_(workspace_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_ws = {row.workspace_id: row.role for row in source_rows}
        target_by_ws = {row.workspace_id: row.role for row in target_rows}

        for ws_id in set(source_by_ws) & set(target_by_ws):
            await session.execute(
                update(WorkspaceMemberDB)
                .where(
                    WorkspaceMemberDB.user_id == target_id,
                    WorkspaceMemberDB.workspace_id == ws_id,
                )
                .values(role=source_by_ws[ws_id])
            )
            await session.execute(
                update(WorkspaceMemberDB)
                .where(
                    WorkspaceMemberDB.user_id == source_id,
                    WorkspaceMemberDB.workspace_id == ws_id,
                )
                .values(role=target_by_ws[ws_id])
            )

        await session.commit()


async def admin_swap_project_memberships(
    project_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap project membership roles between source and target.

    Pre-condition: only acts on projects where BOTH source and target already
    have a membership row.  For each qualifying project, target gets source's
    role and source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == source_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == target_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_proj = {row.project_id: row.role for row in source_rows}
        target_by_proj = {row.project_id: row.role for row in target_rows}

        for proj_id in set(source_by_proj) & set(target_by_proj):
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == target_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=source_by_proj[proj_id])
            )
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == source_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=target_by_proj[proj_id])
            )

        await session.commit()


async def admin_delete_user_memberships(user_id: uuid.UUID) -> None:
    """Delete all org/workspace/project memberships for a user.

    Called before hard-deleting a user so FK constraints are not violated.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(
            delete(OrganizationMemberDB).where(OrganizationMemberDB.user_id == user_id)
        )
        await session.execute(
            delete(WorkspaceMemberDB).where(WorkspaceMemberDB.user_id == user_id)
        )
        await session.execute(
            delete(ProjectMemberDB).where(ProjectMemberDB.user_id == user_id)
        )
        await session.commit()


# Merged from ee/src/services/selectors.py
async def get_user_org_and_workspace_id(user_uid) -> Dict[str, Union[str, List[str]]]:
    """
    Retrieves the user ID and organization IDs associated with a given user UID.

    Args:
        user_uid (str): The UID of the user.

    Returns:
        dict: A dictionary containing the user UID, ID, list of workspace IDS and list of organization IDS associated with a user.
              If the user is not found, returns None

    Example Usage:
        result = await get_user_org_and_workspace_id("user123")

    Output:
        { "id": "123", "uid": "user123", "organization_ids": [], "workspace_ids": []}
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        user = await db_manager.get_user_with_id(user_id=user_uid)
        if not user:
            raise NoResultFound(f"User with uid {user_uid} not found")

        user_org_result = await session.execute(
            select(OrganizationMemberDB)
            .filter_by(user_id=user.id)
            .options(load_only(OrganizationMemberDB.organization_id))  # type: ignore
        )
        orgs = user_org_result.scalars().all()
        organization_ids = [str(user_org.organization_id) for user_org in orgs]

        member_in_workspaces_result = await session.execute(
            select(WorkspaceMemberDB)
            .filter_by(user_id=user.id)
            .options(load_only(WorkspaceMemberDB.workspace_id))  # type: ignore
        )
        workspaces_ids = [
            str(user_workspace.workspace_id)
            for user_workspace in member_in_workspaces_result.scalars().all()
        ]

        return {
            "id": str(user.id),
            "uid": str(user.uid),
            "workspace_ids": workspaces_ids,
            "organization_ids": organization_ids,
        }


async def user_exists(user_email: str) -> bool:
    """Check if user exists in the database.

    Arguments:
        user_email (str): The email address of the logged-in user

    Returns:
        bool: confirming if the user exists or not.
    """

    user = await db_manager.get_user_with_email(email=user_email)
    return False if not user else True


async def get_org_default_workspace(organization: Organization) -> WorkspaceDB:
    """Get's the default workspace for an organization from the database.

    Arguments:
        organization (Organization): The organization

    Returns:
        WorkspaceDB: Instance of WorkspaceDB
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceDB).filter_by(
                organization_id=organization.id,
                type="default",
            )
        )
        workspace = result.scalars().first()
        if workspace is not None:
            return workspace

        result = await session.execute(
            select(WorkspaceDB).filter_by(
                organization_id=organization.id,
            )
        )
        return result.scalars().first()


# Merged from ee/src/services/db_manager.py
async def create_deployment(
    app_id: str,
    project_id: str,
    uri: str,
) -> DeploymentDB:
    """Create a new deployment.
    Args:
        app_id (str): The app variant to create the deployment for.
        project_id (str): The project variant to create the deployment for.
        uri (str): The URI of the service.
    Returns:
        DeploymentDB: The created deployment.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        try:
            deployment = DeploymentDB(
                app_id=uuid.UUID(app_id),
                project_id=uuid.UUID(project_id),
                uri=uri,
            )

            session.add(deployment)
            await session.commit()
            await session.refresh(deployment)

            return deployment
        except Exception as e:
            raise Exception(f"Error while creating deployment: {e}")


# Merged from ee/src/services/converters.py
def _role_slug(role: Any) -> str:
    """Normalize an enum or string role to its slug form."""
    return role.value if hasattr(role, "value") else str(role)


def _expand_permissions(slugs: List[str]) -> List[str]:
    """Expand the `"*"` wildcard to the full list of Permission enum values.

    Why: `WorkspacePermission.permissions` is typed as `List[Permission]` and
    the owner role stores `["*"]` as a wildcard. Pydantic rejects `"*"` since
    it's not an enum member, so we materialize it at the API boundary.
    """
    if "*" not in slugs:
        return slugs
    return [p.value for p in Permission]


async def get_workspace_in_format(
    workspace: WorkspaceDB,
    include_members: bool = True,
) -> WorkspaceResponse:
    """Converts the workspace object to the WorkspaceResponse model.

    Arguments:
        workspace (WorkspaceDB): The workspace object
        include_members (bool): Whether to include workspace members. Defaults to True.

    Returns:
        WorkspaceResponse: The workspace object in the WorkspaceResponse model
    """

    members = []

    if include_members:
        project = await get_project_by_workspace(workspace_id=str(workspace.id))
        project_members = await get_project_members(project_id=str(project.id))
        invitations = await get_project_invitations(
            project_id=str(project.id), invitation_used=False
        )

        if len(invitations) > 0:
            for invitation in invitations:
                if not invitation.used and str(invitation.project_id) == str(
                    project.id
                ):
                    user = await db_manager.get_user_with_email(invitation.email)
                    member_dict = {
                        "user": {
                            "id": str(user.id) if user else invitation.email,
                            "email": user.email if user else invitation.email,
                            "username": (
                                user.username
                                if user
                                else invitation.email.split("@")[0]
                            ),
                            "status": (
                                "pending"
                                if invitation.expiration_date
                                > datetime.now(timezone.utc)
                                else "expired"
                            ),
                            "created_at": (
                                str(user.created_at)
                                if user
                                else (
                                    str(invitation.created_at)
                                    if str(invitation.created_at)
                                    else None
                                )
                            ),
                        },
                        "roles": [
                            {
                                "role_name": invitation.role,
                                "role_description": get_role_description(
                                    "workspace", _role_slug(invitation.role)
                                ),
                            }
                        ],
                    }
                    members.append(member_dict)

        for project_member in project_members:
            member_role = project_member.role
            member_dict = {
                "user": {
                    "id": str(project_member.user.id),
                    "email": project_member.user.email,
                    "username": project_member.user.username,
                    "status": "member",
                    "created_at": str(project_member.user.created_at),
                },
                "roles": (
                    [
                        {
                            "role_name": member_role,
                            "role_description": get_role_description(
                                "project", _role_slug(member_role)
                            ),
                            "permissions": _expand_permissions(
                                get_role_permissions("project", _role_slug(member_role))
                            ),
                        }
                    ]
                    if member_role
                    else []
                ),
            }
            members.append(member_dict)

    workspace_response = WorkspaceResponse(
        id=str(workspace.id),
        name=workspace.name,
        description=workspace.description,
        type=workspace.type,
        members=members,
        organization=str(workspace.organization_id),
        created_at=str(workspace.created_at),
        updated_at=str(workspace.updated_at),
    )
    return workspace_response
