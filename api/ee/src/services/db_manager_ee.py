import uuid
from typing import List, Dict, Union, Any, NoReturn, Optional, Tuple

import sendgrid
from fastapi import HTTPException
from sendgrid.helpers.mail import Mail

from sqlalchemy import func
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, load_only, aliased
from sqlalchemy.exc import NoResultFound, MultipleResultsFound

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.db.postgres_engine import db_engine
from oss.src.services import db_manager, evaluator_manager
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
from ee.src.models.db_models import (
    ProjectDB,
    WorkspaceDB,
    EvaluationDB,
    OrganizationDB,
    ProjectMemberDB,
    WorkspaceMemberDB,
    HumanEvaluationDB,
    OrganizationMemberDB,
    EvaluationScenarioDB,
    HumanEvaluationScenarioDB,
    HumanEvaluationVariantDB,
    EvaluationScenarioResultDB,
    EvaluationEvaluatorConfigDB,
    EvaluationAggregatedResultDB,
)
from oss.src.models.db_models import (
    AppVariantDB,
    UserDB,
    AppDB,
    TestSetDB,
    InvitationDB,
    EvaluatorConfigDB,
    AppVariantRevisionsDB,
)
from oss.src.models.shared_models import (
    Result,
    CorrectAnswer,
    AggregatedResult,
    EvaluationScenarioResult,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    HumanEvaluationScenarioInput,
)
from ee.src.services.converters import get_workspace_in_format
from ee.src.services.selectors import get_org_default_workspace

from oss.src.utils.env import env


# Initialize sendgrid api client
sg = sendgrid.SendGridAPIClient(api_key=env.SENDGRID_API_KEY)

log = get_module_logger(__name__)


async def get_organization(organization_id: str) -> OrganizationDB:
    """
    Fetches an organization by its ID.

    Args:
        organization_id (str): The ID of the organization to fetch.

    Returns:
        OrganizationDB: The fetched organization.
    """

    async with db_engine.get_core_session() as session:
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

    async with db_engine.get_core_session() as session:
        organization_uuids = [uuid.UUID(org_id) for org_id in organization_ids]
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

    async with db_engine.get_core_session() as session:
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

    async with db_engine.get_core_session() as session:
        result = await session.execute(
            select(WorkspaceDB)
            .filter_by(organization_id=uuid.UUID(organization_id))
            .options(load_only(WorkspaceDB.organization_id))  # type: ignore
        )
        workspaces = result.scalars().all()
        return workspaces


async def get_workspace_administrators(workspace: WorkspaceDB) -> List[UserDB]:
    """
    Retrieve the administrators of a workspace.

    Args:
        workspace (WorkspaceDB): The workspace to retrieve the administrators for.

    Returns:
        List[UserDB]: A list of UserDB objects representing the administrators of the workspace.
    """

    administrators = []
    for member in workspace.members:
        if workspace.has_role(
            member.user_id, WorkspaceRole.WORKSPACE_ADMIN
        ) or workspace.has_role(member.user_id, WorkspaceRole.OWNER):
            user = await db_manager.get_user_with_id(member.user_id)
            administrators.append(user)
    return administrators


async def create_project(
    project_name: str, workspace_id: str, organization_id: str, session: AsyncSession
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
        is_default=True,
        organization_id=uuid.UUID(organization_id),
        workspace_id=uuid.UUID(workspace_id),
    )

    session.add(project_db)

    log.info(
        "[scopes] project created",
        organization_id=organization_id,
        workspace_id=workspace_id,
        project_id=project_db.id,
    )

    await session.commit()

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
    )
    return project_db


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

    async with db_engine.get_core_session() as session:
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


async def get_project_by_workspace(workspace_id: str) -> ProjectDB:
    """Get the project from database using the organization id and workspace id.

    Args:
        workspace_id (str): The ID of the workspace

    Returns:
        ProjectDB: The retrieved project
    """

    assert workspace_id is not None, "Workspace ID is required to retrieve project"
    async with db_engine.get_core_session() as session:
        project_query = await session.execute(
            select(ProjectDB).where(
                ProjectDB.workspace_id == uuid.UUID(workspace_id),
            )
        )
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

    log.info(
        "[scopes] project membership created",
        organization_id=project.organization_id,
        workspace_id=project.workspace_id,
        project_id=project_id,
        user_id=user_id,
        membership_id=project_member.id,
    )

    await session.commit()


async def fetch_project_memberships_by_user_id(
    user_id: str,
) -> List[ProjectMemberDB]:
    async with db_engine.get_core_session() as session:
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

    log.info(
        "[scopes] workspace created",
        organization_id=organization.id,
        workspace_id=workspace.id,
    )

    await session.commit()

    # add user as a member to the workspace with the owner role
    workspace_member = WorkspaceMemberDB(
        user_id=user.id,
        workspace_id=workspace.id,
        role="owner",
    )
    session.add(workspace_member)

    log.info(
        "[scopes] workspace membership created",
        organization_id=workspace.organization_id,
        workspace_id=workspace.id,
        user_id=user.id,
        membership_id=workspace_member.id,
    )

    await session.commit()

    await session.refresh(workspace, attribute_names=["organization"])

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

    # add default testset and evaluators
    await db_manager.add_testset_to_app_variant(
        template_name="completion",  # type: ignore
        app_name="completion",  # type: ignore
        project_id=str(project_db.id),
    )
    await evaluator_manager.create_ready_to_use_evaluators(
        project_id=str(project_db.id)
    )
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

        async with db_engine.get_core_session() as session:
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

    async with db_engine.get_core_session() as session:
        result = await session.execute(select(WorkspaceDB).filter_by(id=workspace.id))
        workspace = result.scalars().first()

        if not workspace:
            raise NoResultFound(f"Workspace with id {str(workspace.id)} not found")

        for key, value in payload.dict(exclude_unset=True):
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

    async with db_engine.get_core_session() as session:
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
    project_id = await db_manager.get_default_project_id_from_workspace(
        workspace_id=workspace_id
    )

    async with db_engine.get_core_session() as session:
        # Ensure that an admin can not remove the owner of the workspace/project
        project_owner_result = await session.execute(
            select(ProjectMemberDB)
            .filter_by(project_id=uuid.UUID(project_id), role="owner")
            .options(
                load_only(
                    ProjectMemberDB.user_id,  # type: ignore
                    ProjectMemberDB.role,  # type: ignore
                )
            )
        )
        project_owner = project_owner_result.scalars().first()
        if user.id == project_owner.user_id and project_owner.role == "owner":
            raise HTTPException(
                403,
                {
                    "message": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        project_member_result = await session.execute(
            select(ProjectMemberDB).filter_by(
                project_id=uuid.UUID(project_id), user_id=user.id
            )
        )
        project_member = project_member_result.scalars().first()
        if not project_member:
            raise NoResultFound(
                f"User with id {str(user.id)} is not part of the workspace member."
            )

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

        if not delete:
            # Update the member's role
            project_member.role = payload.role
            workspace_member.role = payload.role

        await session.commit()
        await session.refresh(project_member)
        return True


async def add_user_to_workspace_and_org(
    organization: OrganizationDB,
    workspace: WorkspaceDB,
    user: UserDB,
    project_id: str,
    role: str,
) -> bool:
    async with db_engine.get_core_session() as session:
        # create joined organization for user
        user_organization = OrganizationMemberDB(
            user_id=user.id, organization_id=organization.id
        )
        session.add(user_organization)

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

        log.info(
            "[scopes] workspace membership created",
            organization_id=organization.id,
            workspace_id=workspace.id,
            user_id=user.id,
            membership_id=workspace_member.id,
        )

        # add user to project
        await create_project_member(
            user_id=str(user.id), project_id=project_id, role=role, session=session
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
    project_id = await db_manager.get_default_project_id_from_workspace(
        workspace_id=workspace_id
    )
    project = await db_manager.get_project_by_id(project_id=project_id)

    async with db_engine.get_core_session() as session:
        if (
            not user
        ):  # User is an invited user who has not yet created an account and therefore does not have a user object
            pass
        else:
            # Ensure that a user can not remove the owner of the workspace
            workspace_owner_result = await session.execute(
                select(WorkspaceMemberDB)
                .filter_by(
                    workspace_id=project.workspace_id, user_id=user.id, role="owner"
                )
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
                    WorkspaceMemberDB.workspace_id == project.workspace_id,
                    WorkspaceMemberDB.user_id == user.id,
                    WorkspaceMemberDB.role != "owner",
                )
            )
            workspace_member = workspace_member_result.scalars().first()
            if workspace_member:
                await session.delete(workspace_member)

                log.info(
                    "[scopes] workspace membership deleted",
                    organization_id=project.organization_id,
                    workspace_id=workspace_id,
                    user_id=user.id,
                    membership_id=workspace_member.id,
                )

            # remove user from project
            project_member_result = await session.execute(
                select(ProjectMemberDB).filter(
                    ProjectMemberDB.project_id == project.id,
                    ProjectMemberDB.user_id == user.id,
                    ProjectMemberDB.role != "owner",
                )
            )
            project_member = project_member_result.scalars().first()
            if project_member:
                await session.delete(project_member)

                log.info(
                    "[scopes] project membership deleted",
                    organization_id=project.organization_id,
                    workspace_id=project.workspace_id,
                    project_id=project.id,
                    user_id=user.id,
                    membership_id=project_member.id,
                )

            # remove user from organization
            joined_org_result = await session.execute(
                select(OrganizationMemberDB).filter_by(
                    user_id=user.id, organization_id=project.organization_id
                )
            )
            member_joined_org = joined_org_result.scalars().first()
            if member_joined_org:
                await session.delete(member_joined_org)

                log.info(
                    "[scopes] organization membership deleted",
                    organization_id=project.organization_id,
                    user_id=user.id,
                    membership_id=member_joined_org.id,
                )

            await session.commit()

        # If there's an invitation for the provided email address, delete it
        user_workspace_invitations_query = await session.execute(
            select(InvitationDB)
            .filter_by(project_id=project.id, email=email)
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
    return_org_workspace: bool = False,
) -> Union[OrganizationDB, Tuple[OrganizationDB, WorkspaceDB]]:
    """Create a new organization.

    Args:
        payload (Organization): The organization payload.

    Returns:
        Organization: The created organization.
        Optional[Workspace]: The created workspace if return_org_workspace is True.

    Raises:
        Exception: If there is an error creating the organization.
    """

    async with db_engine.get_core_session() as session:
        create_org_data = payload.model_dump(exclude_unset=True)
        if "owner" not in create_org_data:
            create_org_data["owner"] = str(user.id)

        # create organization
        organization_db = OrganizationDB(**create_org_data)
        session.add(organization_db)

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        await session.commit()

        # create joined organization for user
        user_organization = OrganizationMemberDB(
            user_id=user.id, organization_id=organization_db.id
        )
        session.add(user_organization)

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_db.id,
            user_id=user.id,
            membership_id=user_organization.id,
        )

        await session.commit()

        # construct workspace payload
        workspace_payload = CreateWorkspace(
            name=payload.name,
            type=payload.type if payload.type else "",
            description=(
                "My Default Workspace"
                if payload.type == "default"
                else payload.description if payload.description else ""
            ),
        )

        # create workspace
        workspace = await create_workspace_db_object(
            session, workspace_payload, organization_db, user
        )

        if return_org_workspace:
            return (organization_db, workspace)
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

    async with db_engine.get_core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        for key, value in payload.model_dump(exclude_unset=True):
            if hasattr(organization, key):
                setattr(organization, key, value)

        await session.commit(organization)
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

    async with db_engine.get_core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table. Error details: {str(e)}"
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

    async with db_engine.get_core_session() as session:
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


async def get_org_details(organization: Organization) -> dict:
    """
    Retrieve details of an organization.

    Args:
        organization (Organization): The organization to retrieve details for.
        project_id (str): The project_id to retrieve details for.

    Returns:
        dict: A dictionary containing the organization's details.
    """

    default_workspace_db = await get_org_default_workspace(organization)
    default_workspace = await get_workspace_details(default_workspace_db)
    workspaces = await get_organization_workspaces(organization_id=str(organization.id))

    sample_organization = {
        "id": str(organization.id),
        "name": organization.name,
        "description": organization.description,
        "type": organization.type,
        "owner": organization.owner,
        "workspaces": [str(workspace.id) for workspace in workspaces],
        "default_workspace": default_workspace,
        "is_paying": organization.is_paying if is_ee() else None,
    }
    return sample_organization


async def get_workspace_details(workspace: WorkspaceDB) -> WorkspaceResponse:
    """
    Retrieve details of a workspace.

    Args:
        workspace (Workspace): The workspace to retrieve details for.
        project_id (str): The project_id to retrieve details for.

    Returns:
        dict: A dictionary containing the workspace's details.

    Raises:
        Exception: If there is an error retrieving the workspace details.
    """

    try:
        workspace_response = await get_workspace_in_format(workspace)
        return workspace_response
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise e


async def get_organization_invitations(organization_id: str):
    """
    Gets the organization invitations.

    Args:
        organization_id (str): The ID of the organization
    """

    async with db_engine.get_core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(organization_id=organization_id)
        )
        invitations = result.scalars().all()
        return invitations


async def get_project_invitations(project_id: str, **kwargs):
    """
    Gets the project invitations.

    Args:
        project_id (str): The ID of the project
    """

    async with db_engine.get_core_session() as session:
        query = select(InvitationDB).filter(
            InvitationDB.project_id == uuid.UUID(project_id)
        )
        if kwargs.get("has_pending", False):
            query = query.filter(InvitationDB.used == kwargs["invitation_used"])

        result = await session.execute(query)
        invitations = result.scalars().all()
        return invitations


async def get_all_pending_invitations(email: str):
    """
    Gets all pending invitations for a given email.

    Args:
        email (str): The email address of the user.
    """

    async with db_engine.get_core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter(
                InvitationDB.email == email,
                InvitationDB.used == False,
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

    async with db_engine.get_core_session() as session:
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

    async with db_engine.get_core_session() as session:
        members_query = await session.execute(
            select(ProjectMemberDB)
            .filter(ProjectMemberDB.project_id == uuid.UUID(project_id))
            .options(joinedload(ProjectMemberDB.user))
        )
        project_members = members_query.scalars().all()
        return project_members


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

    async with db_engine.get_core_session() as session:
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


# async def get_project_id_from_db_entity(
#     object_id: str, type: str, project_id: str
# ) -> dict:
#     """
#     Get the project id of the object.

#     Args:
#         object_id (str): The ID of the object.
#         type (str): The type of the object.

#     Returns:
#         dict: The project_id of the object.

#     Raises:
#         ValueError: If the object type is unknown.
#         Exception: If there is an error retrieving the project_id.
#     """
#     try:
#         if type == "app":
#             app = await db_manager.fetch_app_by_id(object_id)
#             project_id = app.project_id

#         elif type == "app_variant":
#             app_variant = await db_manager.fetch_app_variant_by_id(object_id)
#             project_id = app_variant.project_id

#         elif type == "base":
#             base = await db_manager.fetch_base_by_id(object_id)
#             project_id = base.project_id

#         elif type == "deployment":
#             deployment = await db_manager.get_deployment_by_id(object_id)
#             project_id = deployment.project_id

#         elif type == "testset":
#             testset = await db_manager.fetch_testset_by_id(object_id)
#             project_id = testset.project_id

#         elif type == "evaluation":
#             evaluation = await db_manager.fetch_evaluation_by_id(object_id)
#             project_id = evaluation.project_id

#         elif type == "evaluation_scenario":
#             evaluation_scenario = await db_manager.fetch_evaluation_scenario_by_id(
#                 object_id
#             )
#             project_id = evaluation_scenario.project_id

#         elif type == "evaluator_config":
#             evaluator_config = await db_manager.fetch_evaluator_config(object_id)
#             project_id = evaluator_config.project_id

#         elif type == "human_evaluation":
#             human_evaluation = await db_manager.fetch_human_evaluation_by_id(object_id)
#             project_id = human_evaluation.project_id

#         elif type == "human_evaluation_scenario":
#             human_evaluation_scenario = (
#                 await db_manager.fetch_human_evaluation_scenario_by_id(object_id)
#             )
#             project_id = human_evaluation_scenario.project_id

#         elif type == "human_evaluation_scenario_by_evaluation_id":
#             human_evaluation_scenario_by_evaluation = (
#                 await db_manager.fetch_human_evaluation_scenario_by_evaluation_id(
#                     object_id
#                 )
#             )
#             project_id = human_evaluation_scenario_by_evaluation.project_id

#         else:
#             raise ValueError(f"Unknown object type: {type}")

#         return str(project_id)

#     except Exception as e:
#         raise e


async def add_user_to_organization(
    organization_id: str,
    user_id: str,
    # is_demo: bool = False,
) -> None:
    async with db_engine.get_core_session() as session:
        organization_member = OrganizationMemberDB(
            user_id=user_id,
            organization_id=organization_id,
        )

        session.add(organization_member)

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_id,
            user_id=user_id,
            membership_id=organization_member.id,
        )

        await session.commit()


async def add_user_to_workspace(
    workspace_id: str,
    user_id: str,
    role: str,
    # is_demo: bool = False,
) -> None:
    async with db_engine.get_core_session() as session:
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

        # TODO: add organization_id
        log.info(
            "[scopes] workspace membership created",
            organization_id=workspace.organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            membership_id=workspace_member.id,
        )

        await session.commit()


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

    async with db_engine.get_core_session() as session:
        project_member = ProjectMemberDB(
            user_id=user_id,
            project_id=project_id,
            role=role,
            is_demo=is_demo,
        )

        session.add(project_member)

        log.info(
            "[scopes] project membership created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            membership_id=project_member.id,
        )

        await session.commit()


async def fetch_evaluation_status_by_id(
    project_id: str,
    evaluation_id: str,
) -> Optional[str]:
    """Fetch only the status of an evaluation by its ID."""
    assert evaluation_id is not None, "evaluation_id cannot be None"

    async with engine.core_session() as session:
        query = (
            select(EvaluationDB)
            .filter_by(project_id=project_id, id=uuid.UUID(evaluation_id))
            .options(load_only(EvaluationDB.status))
        )

        result = await session.execute(query)
        evaluation = result.scalars().first()
        return evaluation.status if evaluation else None


async def fetch_evaluation_by_id(
    project_id: str,
    evaluation_id: str,
) -> Optional[EvaluationDB]:
    """Fetches a evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with engine.core_session() as session:
        base_query = select(EvaluationDB).filter_by(
            project_id=project_id,
            id=uuid.UUID(evaluation_id),
        )
        query = base_query.options(
            joinedload(EvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
        )

        result = await session.execute(
            query.options(
                joinedload(EvaluationDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
                joinedload(EvaluationDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.revision),  # type: ignore
                joinedload(
                    EvaluationDB.aggregated_results.of_type(
                        EvaluationAggregatedResultDB
                    )
                ).joinedload(EvaluationAggregatedResultDB.evaluator_config),
            )
        )
        evaluation = result.unique().scalars().first()
        return evaluation


async def list_human_evaluations(app_id: str, project_id: str):
    """
    Fetches human evaluations belonging to an App.

    Args:
        app_id (str):  The application identifier
    """

    async with engine.core_session() as session:
        base_query = (
            select(HumanEvaluationDB)
            .filter_by(app_id=uuid.UUID(app_id), project_id=uuid.UUID(project_id))
            .filter(HumanEvaluationDB.testset_id.isnot(None))
        )
        query = base_query.options(
            joinedload(HumanEvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
        )

        result = await session.execute(query)
        human_evaluations = result.scalars().all()
        return human_evaluations


async def create_human_evaluation(
    app: AppDB,
    status: str,
    evaluation_type: str,
    testset_id: str,
    variants_ids: List[str],
):
    """
    Creates a human evaluation.

    Args:
        app (AppDB: The app object
        status (str): The status of the evaluation
        evaluation_type (str): The evaluation type
        testset_id (str): The ID of the evaluation testset
        variants_ids (List[str]): The IDs of the variants for the evaluation
    """

    async with engine.core_session() as session:
        human_evaluation = HumanEvaluationDB(
            app_id=app.id,
            project_id=app.project_id,
            status=status,
            evaluation_type=evaluation_type,
            testset_id=testset_id,
        )

        session.add(human_evaluation)
        await session.commit()
        await session.refresh(human_evaluation, attribute_names=["testset"])

        # create variants for human evaluation
        await create_human_evaluation_variants(
            human_evaluation_id=str(human_evaluation.id),
            variants_ids=variants_ids,
        )
        return human_evaluation


async def fetch_human_evaluation_variants(human_evaluation_id: str):
    """
    Fetches human evaluation variants.

    Args:
        human_evaluation_id (str): The human evaluation ID

    Returns:
        The human evaluation variants.
    """

    async with engine.core_session() as session:
        base_query = select(HumanEvaluationVariantDB).filter_by(
            human_evaluation_id=uuid.UUID(human_evaluation_id)
        )
        query = base_query.options(
            joinedload(HumanEvaluationVariantDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
            joinedload(HumanEvaluationVariantDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.id, AppVariantRevisionsDB.revision),  # type: ignore
        )

        result = await session.execute(query)
        evaluation_variants = result.scalars().all()
        return evaluation_variants


async def create_human_evaluation_variants(
    human_evaluation_id: str, variants_ids: List[str]
):
    """
    Creates human evaluation variants.

    Args:
        human_evaluation_id (str):  The human evaluation identifier
        variants_ids (List[str]):  The variants identifiers
        project_id (str): The project ID
    """

    variants_dict = {}
    for variant_id in variants_ids:
        variant = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)
        if variant:
            variants_dict[variant_id] = variant

    variants_revisions_dict = {}
    for variant_id, variant in variants_dict.items():
        variant_revision = await db_manager.fetch_app_variant_revision_by_variant(
            app_variant_id=str(variant.id), project_id=str(variant.project_id), revision=variant.revision  # type: ignore
        )
        if variant_revision:
            variants_revisions_dict[variant_id] = variant_revision

    if set(variants_dict.keys()) != set(variants_revisions_dict.keys()):
        raise ValueError("Mismatch between variants and their revisions")

    async with engine.core_session() as session:
        for variant_id in variants_ids:
            variant = variants_dict[variant_id]
            variant_revision = variants_revisions_dict[variant_id]
            human_evaluation_variant = HumanEvaluationVariantDB(
                human_evaluation_id=uuid.UUID(human_evaluation_id),
                variant_id=variant.id,  # type: ignore
                variant_revision_id=variant_revision.id,  # type: ignore
            )
            session.add(human_evaluation_variant)

        await session.commit()


async def fetch_human_evaluation_by_id(
    evaluation_id: str,
) -> Optional[HumanEvaluationDB]:
    """
    Fetches a evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with engine.core_session() as session:
        base_query = select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        query = base_query.options(
            joinedload(HumanEvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
        )
        result = await session.execute(query)
        evaluation = result.scalars().first()
        return evaluation


async def update_human_evaluation(evaluation_id: str, values_to_update: dict):
    """Updates human evaluation with the specified values.

    Args:
        evaluation_id (str): The evaluation ID
        values_to_update (dict):  The values to update

    Exceptions:
        NoResultFound: if human evaluation is not found
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        human_evaluation = result.scalars().first()
        if not human_evaluation:
            raise NoResultFound(f"Human evaluation with id {evaluation_id} not found")

        for key, value in values_to_update.items():
            if hasattr(human_evaluation, key):
                setattr(human_evaluation, key, value)

        await session.commit()
        await session.refresh(human_evaluation)


async def delete_human_evaluation(evaluation_id: str):
    """Delete the evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to delete.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().first()
        if not evaluation:
            raise NoResultFound(f"Human evaluation with id {evaluation_id} not found")

        await session.delete(evaluation)
        await session.commit()


async def create_human_evaluation_scenario(
    inputs: List[HumanEvaluationScenarioInput],
    project_id: str,
    evaluation_id: str,
    evaluation_extend: Dict[str, Any],
):
    """
    Creates a human evaluation scenario.

    Args:
        inputs (List[HumanEvaluationScenarioInput]): The inputs.
        evaluation_id (str): The evaluation identifier.
        evaluation_extend (Dict[str, any]): An extended required payload for the evaluation scenario. Contains score, vote, and correct_answer.
    """

    async with engine.core_session() as session:
        evaluation_scenario = HumanEvaluationScenarioDB(
            **evaluation_extend,
            project_id=uuid.UUID(project_id),
            evaluation_id=uuid.UUID(evaluation_id),
            inputs=[input.model_dump() for input in inputs],
            outputs=[],
        )

        session.add(evaluation_scenario)
        await session.commit()


async def update_human_evaluation_scenario(
    evaluation_scenario_id: str, values_to_update: dict
):
    """Updates human evaluation scenario with the specified values.

    Args:
        evaluation_scenario_id (str): The evaluation scenario ID
        values_to_update (dict):  The values to update

    Exceptions:
        NoResultFound: if human evaluation scenario is not found
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        human_evaluation_scenario = result.scalars().first()
        if not human_evaluation_scenario:
            raise NoResultFound(
                f"Human evaluation scenario with id {evaluation_scenario_id} not found"
            )

        for key, value in values_to_update.items():
            if hasattr(human_evaluation_scenario, key):
                setattr(human_evaluation_scenario, key, value)

        await session.commit()
        await session.refresh(human_evaluation_scenario)


async def fetch_human_evaluation_scenarios(evaluation_id: str):
    """
    Fetches human evaluation scenarios.

    Args:
        evaluation_id (str):  The evaluation identifier

    Returns:
        The evaluation scenarios.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=uuid.UUID(evaluation_id)
            )
        )
        evaluation_scenarios = result.scalars().all()
        return evaluation_scenarios


async def fetch_evaluation_scenarios(evaluation_id: str, project_id: str):
    """
    Fetches evaluation scenarios.

    Args:
        evaluation_id (str):  The evaluation identifier
        project_id (str): The ID of the project

    Returns:
        The evaluation scenarios.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB)
            .filter_by(
                evaluation_id=uuid.UUID(evaluation_id), project_id=uuid.UUID(project_id)
            )
            .options(joinedload(EvaluationScenarioDB.results))
        )
        evaluation_scenarios = result.unique().scalars().all()
        return evaluation_scenarios


async def fetch_evaluation_scenario_by_id(
    evaluation_scenario_id: str,
) -> Optional[EvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario to fetch.

    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """

    assert evaluation_scenario_id is not None, "evaluation_scenario_id cannot be None"
    async with engine.core_session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB).filter_by(id=uuid.UUID(evaluation_scenario_id))
        )
        evaluation_scenario = result.scalars().first()
        return evaluation_scenario


async def fetch_human_evaluation_scenario_by_id(
    evaluation_scenario_id: str,
) -> Optional[HumanEvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario to fetch.

    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """

    assert evaluation_scenario_id is not None, "evaluation_scenario_id cannot be None"
    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        evaluation_scenario = result.scalars().first()
        return evaluation_scenario


async def fetch_human_evaluation_scenario_by_evaluation_id(
    evaluation_id: str,
) -> Optional[HumanEvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.
    Args:
        evaluation_id (str): The ID of the evaluation object to use in fetching the human evaluation.
    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """

    evaluation = await fetch_human_evaluation_by_id(evaluation_id)
    async with engine.core_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=evaluation.id  # type: ignore
            )
        )
        human_eval_scenario = result.scalars().first()
        return human_eval_scenario


async def create_new_evaluation(
    app: AppDB,
    project_id: str,
    testset: TestSetDB,
    status: Result,
    variant: str,
    variant_revision: str,
) -> EvaluationDB:
    """Create a new evaluation scenario.
    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with engine.core_session() as session:
        evaluation = EvaluationDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            testset_id=testset.id,
            status=status.model_dump(),
            variant_id=uuid.UUID(variant),
            variant_revision_id=uuid.UUID(variant_revision),
        )

        session.add(evaluation)
        await session.commit()
        await session.refresh(
            evaluation,
            attribute_names=[
                "testset",
                "variant",
                "variant_revision",
                "aggregated_results",
            ],
        )

        return evaluation


async def list_evaluations(app_id: str, project_id: str):
    """Retrieves evaluations of the specified app from the db.

    Args:
        app_id (str): The ID of the app
        project_id (str): The ID of the project
    """

    async with engine.core_session() as session:
        base_query = select(EvaluationDB).filter_by(
            app_id=uuid.UUID(app_id), project_id=uuid.UUID(project_id)
        )
        query = base_query.options(
            joinedload(EvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
        )

        result = await session.execute(
            query.options(
                joinedload(EvaluationDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
                joinedload(EvaluationDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.revision),  # type: ignore
                joinedload(
                    EvaluationDB.aggregated_results.of_type(
                        EvaluationAggregatedResultDB
                    )
                ).joinedload(EvaluationAggregatedResultDB.evaluator_config),
            )
        )
        evaluations = result.unique().scalars().all()
        return evaluations


async def fetch_evaluations_by_resource(
    resource_type: str, project_id: str, resource_ids: List[str]
):
    """
    Fetches an evaluations by resource.

    Args:
        resource_type (str):  The resource type
        project_id (str): The ID of the project
        resource_ids (List[str]):   The resource identifiers

    Returns:
        The evaluations by resource.

    Raises:
        HTTPException:400 resource_type {type} is not supported
    """

    ids = list(map(uuid.UUID, resource_ids))

    async with engine.core_session() as session:
        if resource_type == "variant":
            result_evaluations = await session.execute(
                select(EvaluationDB)
                .filter(
                    EvaluationDB.variant_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(EvaluationDB.id))  # type: ignore
            )
            result_human_evaluations = await session.execute(
                select(HumanEvaluationDB)
                .join(HumanEvaluationVariantDB)
                .filter(
                    HumanEvaluationVariantDB.variant_id.in_(ids),
                    HumanEvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(HumanEvaluationDB.id))  # type: ignore
            )
            res_evaluations = result_evaluations.scalars().all()
            res_human_evaluations = result_human_evaluations.scalars().all()
            return res_evaluations + res_human_evaluations

        elif resource_type == "testset":
            result_evaluations = await session.execute(
                select(EvaluationDB)
                .filter(
                    EvaluationDB.testset_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(EvaluationDB.id))  # type: ignore
            )
            result_human_evaluations = await session.execute(
                select(HumanEvaluationDB)
                .filter(
                    HumanEvaluationDB.testset_id.in_(ids),
                    HumanEvaluationDB.project_id
                    == uuid.UUID(project_id),  # Fixed to match HumanEvaluationDB
                )
                .options(load_only(HumanEvaluationDB.id))  # type: ignore
            )
            res_evaluations = result_evaluations.scalars().all()
            res_human_evaluations = result_human_evaluations.scalars().all()
            return res_evaluations + res_human_evaluations

        elif resource_type == "evaluator_config":
            query = (
                select(EvaluationDB)
                .join(EvaluationDB.evaluator_configs)
                .filter(
                    EvaluationEvaluatorConfigDB.evaluator_config_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
            )
            result = await session.execute(query)
            res = result.scalars().all()
            return res

        raise HTTPException(
            status_code=400,
            detail=f"resource_type {resource_type} is not supported",
        )


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """Delete evaluations based on the ids provided from the db.

    Args:
        evaluations_ids (list[str]): The IDs of the evaluation
    """

    async with engine.core_session() as session:
        query = select(EvaluationDB).where(EvaluationDB.id.in_(evaluation_ids))
        result = await session.execute(query)
        evaluations = result.scalars().all()
        for evaluation in evaluations:
            await session.delete(evaluation)
        await session.commit()


async def create_new_evaluation_scenario(
    project_id: str,
    evaluation_id: str,
    variant_id: str,
    inputs: List[EvaluationScenarioInput],
    outputs: List[EvaluationScenarioOutput],
    correct_answers: Optional[List[CorrectAnswer]],
    is_pinned: Optional[bool],
    note: Optional[str],
    results: List[EvaluationScenarioResult],
) -> EvaluationScenarioDB:
    """Create a new evaluation scenario.

    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with engine.core_session() as session:
        evaluation_scenario = EvaluationScenarioDB(
            project_id=uuid.UUID(project_id),
            evaluation_id=uuid.UUID(evaluation_id),
            variant_id=uuid.UUID(variant_id),
            inputs=[input.model_dump() for input in inputs],
            outputs=[output.model_dump() for output in outputs],
            correct_answers=(
                [correct_answer.model_dump() for correct_answer in correct_answers]
                if correct_answers is not None
                else []
            ),
            is_pinned=is_pinned,
            note=note,
        )

        session.add(evaluation_scenario)
        await session.commit()
        await session.refresh(evaluation_scenario)

        # create evaluation scenario result
        for result in results:
            evaluation_scenario_result = EvaluationScenarioResultDB(
                evaluation_scenario_id=evaluation_scenario.id,
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.model_dump(),
            )

            session.add(evaluation_scenario_result)

        await session.commit()  # ensures that scenario results insertion is committed
        await session.refresh(evaluation_scenario)

        return evaluation_scenario


async def update_evaluation_with_aggregated_results(
    evaluation_id: str, aggregated_results: List[AggregatedResult]
):
    async with engine.core_session() as session:
        for result in aggregated_results:
            aggregated_result = EvaluationAggregatedResultDB(
                evaluation_id=uuid.UUID(evaluation_id),
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.model_dump(),
            )
            session.add(aggregated_result)

        await session.commit()


async def fetch_eval_aggregated_results(evaluation_id: str):
    """
    Fetches an evaluation aggregated results by evaluation identifier.

    Args:
        evaluation_id (str):  The evaluation identifier

    Returns:
        The evaluation aggregated results by evaluation identifier.
    """

    async with engine.core_session() as session:
        base_query = select(EvaluationAggregatedResultDB).filter_by(
            evaluation_id=uuid.UUID(evaluation_id)
        )
        query = base_query.options(
            joinedload(
                EvaluationAggregatedResultDB.evaluator_config.of_type(EvaluatorConfigDB)
            ).load_only(
                EvaluatorConfigDB.id,  # type: ignore
                EvaluatorConfigDB.name,  # type: ignore
                EvaluatorConfigDB.evaluator_key,  # type: ignore
                EvaluatorConfigDB.settings_values,  # type: ignore
                EvaluatorConfigDB.created_at,  # type: ignore
                EvaluatorConfigDB.updated_at,  # type: ignore
            )
        )

        result = await session.execute(query)
        aggregated_results = result.scalars().all()
        return aggregated_results


async def update_evaluation(
    evaluation_id: str, project_id: str, updates: Dict[str, Any]
) -> EvaluationDB:
    """
    Update an evaluator configuration in the database with the provided id.

    Arguments:
        evaluation_id (str): The ID of the evaluator configuration to be updated.
        project_id (str): The ID of the project.
        updates (Dict[str, Any]): The updates to apply to the evaluator configuration.

    Returns:
        EvaluatorConfigDB: The updated evaluator configuration object.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(EvaluationDB).filter_by(
                id=uuid.UUID(evaluation_id), project_id=uuid.UUID(project_id)
            )
        )
        evaluation = result.scalars().first()
        for key, value in updates.items():
            if hasattr(evaluation, key):
                setattr(evaluation, key, value)

        await session.commit()
        await session.refresh(evaluation)

        return evaluation


async def check_if_evaluation_contains_failed_evaluation_scenarios(
    evaluation_id: str,
) -> bool:
    async with engine.core_session() as session:
        EvaluationResultAlias = aliased(EvaluationScenarioResultDB)
        query = (
            select(func.count(EvaluationScenarioDB.id))
            .join(EvaluationResultAlias, EvaluationScenarioDB.results)
            .where(
                EvaluationScenarioDB.evaluation_id == uuid.UUID(evaluation_id),
                EvaluationResultAlias.result["type"].astext == "error",
            )
        )

        result = await session.execute(query)
        count = result.scalar()
        if not count:
            return False
        return count > 0
