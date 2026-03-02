from typing import List
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from ee.src.services import db_manager_ee, converters
from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
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
from oss.src.services.organization_service import (
    create_invitation,
    check_existing_invitation,
    check_valid_invitation,
)
from ee.src.services.organization_service import send_invitation_email
from ee.src.dbs.postgres.organizations.dao import OrganizationDomainsDAO

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
    organization_id: str,
    project_id: str,
    workspace_id: str,
    user_uid: str,
) -> JSONResponse:
    """
    Invite a user to a workspace.

    Args:
        user_uid (str): The user uid.
        organization_id (str): The ID of the organization that the workspace belongs to.
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
        organization = await db_manager_ee.get_organization(organization_id)
        user_performing_action = await db_manager.get_user(user_uid)

        # Check if domains_only is enabled for this organization
        org_flags = organization.flags or {}
        domains_only = org_flags.get("domains_only", False)

        # If domains_only is enabled, get the list of verified domains
        verified_domain_slugs = set()
        if domains_only:
            domains_dao = OrganizationDomainsDAO()
            org_domains = await domains_dao.list_by_organization(
                organization_id=organization_id
            )
            verified_domain_slugs = {
                d.slug.lower()
                for d in org_domains
                if d.flags and d.flags.get("is_verified", False)
            }

            # If domains_only is enabled but no verified domains exist, block all invitations
            if not verified_domain_slugs:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "Cannot send invitations: domains_only is enabled but no verified domains exist"
                    },
                )

        for payload_invite in payload:
            # Check that the user is not inviting themselves
            if payload_invite.email == user_performing_action.email:
                return JSONResponse(
                    status_code=400,
                    content={"error": "You cannot invite yourself to a workspace"},
                )

            # Check if domains_only is enabled and validate the email domain
            if domains_only:
                email_domain = payload_invite.email.split("@")[-1].lower()
                if email_domain not in verified_domain_slugs:
                    return JSONResponse(
                        status_code=400,
                        content={
                            "error": f"Cannot invite {payload_invite.email}: domain '{email_domain}' is not a verified domain for this organization"
                        },
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
                role = payload_invite.roles[0] if payload_invite.roles else "editor"
                invitation = await create_invitation(
                    role, project_id, payload_invite.email
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

                # send_email is either True (email sent) or a string (URL for manual sharing)
                if isinstance(send_email, str):
                    # Sendgrid not configured - return URL for manual sharing
                    return JSONResponse({"url": send_email}, status_code=200)
                elif not send_email:
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

    except Exception:
        log.error(
            "Unexpected error while inviting user to workspace",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while inviting user to workspace.",
        )


async def resend_user_workspace_invite(
    payload: ReseendInviteRequest,
    project_id: str,
    organization_id: str,
    workspace_id: str,
    user_uid: str,
) -> JSONResponse:
    """
    Resend an invitation to a user to a workspace.

    Args:
        organization_id (str): The ID of the organization that the workspace belongs to.
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
        organization = await db_manager_ee.get_organization(organization_id)
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

        # send_email is either True (email sent) or a string (URL for manual sharing)
        if isinstance(send_email, str):
            # Sendgrid not configured - return URL for manual sharing
            return JSONResponse({"url": send_email}, status_code=200)
        elif send_email:
            return JSONResponse(
                {"message": "Invited user to organization"}, status_code=200
            )
        else:
            return JSONResponse(
                {"detail": "Failed to invite user to organization"}, status_code=400
            )

    except Exception:
        log.error(
            "Unexpected error while resending user workspace invite",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while resending user workspace invite.",
        )


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
            assert invitation.role is not None, (
                "Invitation does not have any workspace role"
            )
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
