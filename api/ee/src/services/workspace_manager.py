import asyncio

from typing import List
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from ee.src.services import db_manager_ee, converters
from ee.src.models.db_models import (
    WorkspaceDB,
    OrganizationDB,
)
from oss.src.models.db_models import UserDB
from ee.src.models.api.api_models import (
    InviteRequest,
    ReseendInviteRequest,
)
from ee.src.models.api.workspace_models import (
    Permission,
    WorkspaceRole,
    WorkspaceResponse,
    CreateWorkspace,
    UpdateWorkspace,
)
from oss.src.models.db_models import InvitationDB
from oss.src.services.organization_service import (
    create_invitation,
    check_existing_invitation,
    check_valid_invitation,
)
from ee.src.services.organization_service import send_invitation_email

log = get_module_logger(__name__)


async def get_workspace(workspace_id: str) -> WorkspaceDB:
    """
    Get the workspace object based on the provided workspace ID.

    Parameters:
    - workspace_id (str): The ID of the workspace.

    Returns:
    - WorkspaceDB: The workspace object corresponding to the provided ID.

    Raises:
    - HTTPException: If the workspace with the provided ID is not found.

    """

    workspace = await db_manager.get_workspace(workspace_id)
    if workspace is not None:
        return workspace
    raise HTTPException(
        status_code=404, detail=f"Workspace by id {workspace_id} not found"
    )


async def create_new_workspace(
    payload: CreateWorkspace, organization_id: str, user_uid: str
) -> WorkspaceResponse:
    """
    Create a new workspace.

    Args:
        payload (CreateWorkspace): The workspace payload.
        organization_id (str): The organization id.
        user_uid (str): The user uid.

    Returns:
        WorkspaceResponse: The created workspace.
    """

    workspace = await db_manager_ee.create_workspace(payload, organization_id, user_uid)
    return workspace


async def update_workspace(
    payload: UpdateWorkspace, workspace_id: str
) -> WorkspaceResponse:
    """
    Update a workspace's details.

    Args:
        payload (UpdateWorkspace): The data to update the workspace with.
        workspace_id (str): The ID of the workspace to update.

    Returns:
        WorkspaceResponse: The updated workspace.

    Raises:
        HTTPException: If the workspace with the given ID is not found.
    """

    workspace = await get_workspace(workspace_id)
    if workspace is not None:
        updated_workspace = await db_manager_ee.update_workspace(payload, workspace)
        return updated_workspace
    raise HTTPException(
        status_code=404, detail=f"Workspace by id {workspace_id} not found"
    )


async def get_all_workspace_roles() -> List[WorkspaceRole]:
    """
    Retrieve all workspace roles.

    Returns:
        List[WorkspaceRole]: A list of all workspace roles in the DB.
    """

    workspace_roles_from_db = await db_manager_ee.get_all_workspace_roles()
    return workspace_roles_from_db


async def get_all_workspace_permissions() -> List[Permission]:
    """
    Retrieve all workspace permissions.

    Returns:
        List[Permission]: A list of all workspace permissions in the DB.
    """

    workspace_permissions_from_db = await converters.get_all_workspace_permissions()
    return workspace_permissions_from_db


async def invite_user_to_workspace(
    payload: List[InviteRequest],
    org_id: str,
    project_id: str,
    workspace_id: str,
    user_uid: str,
) -> JSONResponse:
    """
    Invite a user to a workspace.

    Args:
        user_uid (str): The user uid.
        org_id (str): The ID of the organization that the workspace belongs to.
        project_id (str): The ID of the project that belongs to the workspace.
        workspace_id (str): The ID of the workspace.
        payload (InviteRequest): The payload containing the email address of the user to invite.

    Returns:
        JSONResponse: The response containing the invitation details.

    Raises:
        HTTPException: If there is an error retrieving the workspace.
    """

    try:
        workspace = await get_workspace(workspace_id)
        organization = await db_manager_ee.get_organization(org_id)
        user_performing_action = await db_manager.get_user(user_uid)

        for payload_invite in payload:
            # Check that the user is not inviting themselves
            if payload_invite.email == user_performing_action.email:
                return JSONResponse(
                    status_code=400,
                    content={"error": "You cannot invite yourself to a workspace"},
                )

            # Check if the user is already a member of the workspace
            if await db_manager_ee.check_user_in_workspace_with_email(
                payload_invite.email, str(workspace.id)
            ):
                return JSONResponse(
                    status_code=400,
                    content={"error": "User is already a member of the workspace"},
                )

            # Check if the email address already has a valid, unused invitation for the workspace
            existing_invitation, existing_role = await check_existing_invitation(
                project_id, payload_invite.email
            )
            if not existing_invitation and not existing_role:
                # Create a new invitation
                invitation = await create_invitation(
                    payload_invite.roles[0], project_id, payload_invite.email
                )

                # Send the invitation email
                send_email = await send_invitation_email(
                    payload_invite.email,
                    invitation.token,  # type: ignore
                    project_id,
                    workspace,
                    organization,
                    user_performing_action,
                )

                if not send_email:
                    return JSONResponse(
                        {"detail": "Failed to invite user to organization"},
                        status_code=400,
                    )
            else:
                return JSONResponse(
                    status_code=200,
                    content={
                        "message": "Invitation already exists",
                    },
                )

        return JSONResponse(
            {"message": "Invited users to organization"}, status_code=200
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def resend_user_workspace_invite(
    payload: ReseendInviteRequest,
    project_id: str,
    org_id: str,
    workspace_id: str,
    user_uid: str,
) -> JSONResponse:
    """
    Resend an invitation to a user to a workspace.

    Args:
        org_id (str): The ID of the organization that the workspace belongs to.
        project_id (str): The ID of the project.
        workspace_id (str): The ID of the workspace.
        payload (ReseendInviteRequest): The payload containing the email address of the user to invite.

    Returns:
        JSONResponse: The response containing the invitation details.

    Raises:
        HTTPException: If there is an error retrieving the workspace.
    """

    try:
        workspace = await get_workspace(workspace_id)
        organization = await db_manager_ee.get_organization(org_id)
        user_performing_action = await db_manager.get_user(user_uid)

        # Check if the email address already has a valid, unused invitation for the workspace
        existing_invitation, existing_role = await check_existing_invitation(
            project_id, payload.email
        )
        if existing_invitation:
            invitation = existing_invitation
        elif existing_role:
            # Create a new invitation
            invitation = await create_invitation(
                existing_role, project_id, payload.email
            )
        else:
            raise HTTPException(
                status_code=404,
                detail="No existing invitation found for the user",
            )

        # Send the invitation email
        send_email = await send_invitation_email(
            payload.email,
            invitation.token,
            project_id,
            workspace,
            organization,
            user_performing_action,
        )

        if send_email:
            return JSONResponse(
                {"message": "Invited user to organization"}, status_code=200
            )
        else:
            return JSONResponse(
                {"detail": "Failed to invite user to organization"}, status_code=400
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def accept_workspace_invitation(
    token: str,
    project_id: str,
    organization: OrganizationDB,
    workspace: WorkspaceDB,
    user: UserDB,
) -> bool:
    """
    Accept an invitation to a workspace.

    Args:
        token (str): The invitation token.
        project_id (str): The ID of the project.
        organization_id (str): The ID of the organization that the workspace belongs to.
        workspace_id (str): The ID of the workspace.
        user_uid (str): The user uid.

    Returns:
        bool: True if the user was successfully added to the workspace, False otherwise

    Raises:
        HTTPException: If there is an error retrieving the workspace.
    """

    try:
        # Check if the user is already a member of the workspace
        if await db_manager_ee.check_user_in_workspace_with_email(
            user.email, str(workspace.id)
        ):
            raise HTTPException(
                status_code=409,
                detail="User is already a member of the workspace",
            )

        invitation = await check_valid_invitation(project_id, user.email, token)
        if invitation is not None:
            assert (
                invitation.role is not None
            ), "Invitation does not have any workspace role"
            await db_manager_ee.add_user_to_workspace_and_org(
                organization, workspace, user, project_id, invitation.role
            )

            await db_manager_ee.mark_invitation_as_used(
                project_id, str(user.id), invitation
            )
            return True

        else:
            # Existing invitation is expired
            raise Exception("Invitation has expired or does not exist")
    except Exception as e:
        raise e


async def remove_user_from_workspace(
    workspace_id: str,
    email: str,
) -> WorkspaceResponse:
    """
    Remove a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.
        payload (UserRole): The payload containing the user ID and role to remove.

    Returns:
        WorkspaceResponse: The updated workspace.
    """

    remove_user = await db_manager_ee.remove_user_from_workspace(workspace_id, email)
    return remove_user
