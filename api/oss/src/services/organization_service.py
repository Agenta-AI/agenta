import os
import secrets
from typing import List
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from oss.src.models.db_models import UserDB
from oss.src.services import db_manager, email_service
from oss.src.models.api.workspace_models import InviteRequest, ResendInviteRequest


def generate_invitation_token(token_length: int = 16):
    token = secrets.token_urlsafe(token_length)
    return token


async def check_existing_invitation(project_id: str, email: str):
    """
    Checks if there is an existing invitation for a given project and email address.

    Args:
        project_id (str): The ID of the project for which the invitation is being checked.
        email_address (str): The email address of the user for whom the invitation is being checked.

    Returns:
    - invitation (InvitationDB): The existing invitation if it is valid and not expired. Otherwise, returns None.
    """

    invitation = await db_manager.get_project_invitation_by_email(
        project_id=project_id, email=email
    )
    if (
        invitation is not None
        and not invitation.used
        and invitation.email == email
        and str(invitation.project_id) == project_id
    ):
        if invitation.expiration_date > datetime.now(timezone.utc):
            return invitation

        else:
            # Existing invitation is expired, delete it
            await db_manager.delete_invitation(str(invitation.id))
            return None

    return None


async def check_valid_invitation(project_id: str, email: str, token: str):
    """
    Check if a project invitation is valid for a given user and token.

    Args:
        project_id (str): The ID of the project for which the invitation is being checked.
        email (str): The email address of whom the invitation is being verified.
        token (str): The invitation token to be validated.

    Returns:
        InvitationDB or None: Returns the invitation object if it's valid and not expired.
                              Returns None if the invitation is not found or has expired.
    """

    invitation = await db_manager.get_project_invitation_by_token_and_email(
        project_id, token, email
    )
    if invitation is not None and invitation.expiration_date > datetime.now(
        timezone.utc
    ):
        return invitation

    return None


async def send_invitation_email(
    email: str,
    token: str,
    project_id: str,
    workspace_id: str,
    organization_id: str,
    user: UserDB,
):
    """
    Sends an invitation email to the specified email address, containing a link to accept the invitation.

    Args:
        email (str): The email address to send the invitation to.
        token (str): The token to include in the invitation link.
        project_id (str): The ID of the project that the user is being invited to join.
        workspace_id (str): The ID of the workspace to which the user is being invited.
        organization_id (str): The ID of the organization to which the user is being invited.
        user (UserDB): The user who is sending the invitation.

    Returns:
        bool: True if the email was sent successfully, False otherwise.
    """

    invitation_link = f"""{os.environ.get("DOMAIN_NAME")}/auth?token={token}&org_id={organization_id}&project_id={project_id}&workspace_id={workspace_id}&email={email}"""
    if not os.getenv("SENDGRID_API_KEY", None):
        return invitation_link

    html_template = email_service.read_email_template("./templates/send_email.html")
    html_content = html_template.format(
        username_placeholder=user.username,
        action_placeholder="invited you to join",
        workspace_placeholder="their organization",
        call_to_action=f"""Click the link below to accept the invitation:</p><br><a href="{os.environ.get("DOMAIN_NAME")}/auth?token={token}&org_id={organization_id}&project_id={project_id}&workspace_id={workspace_id}&email={email}">Accept Invitation</a>""",
    )

    if not os.getenv("SEND_EMAIL_FROM_ADDRESS", None):
        raise ValueError("Sendgrid requires a sender email address to work.")

    await email_service.send_email(
        from_email=os.getenv("SEND_EMAIL_FROM_ADDRESS"),
        to_email=email,
        subject=f"{user.username} invited you to join their organization",
        html_content=html_content,
    )
    return True


async def create_invitation(role: str, project_id: str, email: str):
    """
    Creates a new invitation for a user to join an organization.

    Args:
        role (str): The role to be assigned to the invited user in the organization.
        project_id (str): The ID of the project (organization) the user is being invited to.
        email (str): The email address of the user being invited.

    Returns:
        InvitationDB: The created invitation object containing details such as
                      token, expiration date, and other relevant information.
    """

    token = generate_invitation_token()
    expiration_date = datetime.now(timezone.utc) + timedelta(days=7)

    invitation = await db_manager.create_user_invitation_to_organization(
        project_id=project_id,
        token=token,
        role=role,
        email=email,
        expiration_date=expiration_date,
    )
    return invitation


async def invite_user_to_organization(
    payload: InviteRequest,
    project_id: str,
    user_id: str,
):
    """
    Invite a user to a workspace.

    Args:
        user_uid (str): The user uid.
        project_id (str): The ID of the project that belongs to the workspace/organization.
        payload (InviteRequest): The payload containing the email address of the user to invite.

    Returns:
        JSONResponse: The response containing the invitation details.
    """

    user_performing_action = await db_manager.get_user_with_id(user_id=user_id)

    # Check that the user is not inviting themselves
    if payload.email == user_performing_action.email:
        raise HTTPException(
            status_code=400,
            detail="You cannot invite yourself to a workspace",
        )

    # Check if the user is already a member of the workspace
    existing_invitation = await check_existing_invitation(
        project_id=project_id, email=payload.email
    )
    if existing_invitation is not None:
        raise HTTPException(
            status_code=400,
            detail="User is already a member of the workspace",
        )

    # Create a new invitation since user hasn't been invited
    invitation = await create_invitation("editor", project_id, payload.email)

    # Get project by id
    project_db = await db_manager.get_project_by_id(project_id=project_id)

    # Send the invitation email
    send_email = await send_invitation_email(
        payload.email,
        invitation.token,  # type: ignore
        project_id=str(project_db.id),
        workspace_id=str(project_db.workspace_id),
        organization_id=str(project_db.organization_id),
        user=user_performing_action,
    )

    if isinstance(send_email, str):
        return {"url": send_email}

    if not send_email:
        raise HTTPException(
            detail="Failed to invite user to organization",
            status_code=400,
        )

    return send_email


async def resend_user_organization_invite(
    payload: ResendInviteRequest,
    project_id: str,
    user_id: str,
):
    """
    Resend an invitation to a user to an organization.

    Args:
        user_uid (str): The user uid.
        org_id (str): The ID of the organization to invite the user to.
        project_id (str): The ID of the project that belongs to the workspace/organization.
        payload (ResendInviteRequest): The payload containing the email address of the user to invite.
    """

    user_performing_action = await db_manager.get_user_with_id(user_id=user_id)

    # Check if the email address already has a valid, unused invitation for the workspace
    existing_invitation = await check_existing_invitation(project_id, payload.email)
    if existing_invitation is not None:
        invitation = existing_invitation
    else:
        # Create a new invitation
        invitation = await create_invitation("editor", project_id, payload.email)

    # Get project by id
    project_db = await db_manager.get_project_by_id(project_id=project_id)

    # Send the invitation email
    send_email = await send_invitation_email(
        payload.email,
        invitation.token,  # type: ignore
        project_id=str(project_db.id),
        workspace_id=str(project_db.workspace_id),
        organization_id=str(project_db.organization_id),
        user=user_performing_action,
    )

    if isinstance(send_email, str):
        return {"url": send_email}

    if not send_email:
        raise HTTPException(
            detail="Failed to invite user to organization",
            status_code=400,
        )

    return send_email


async def accept_organization_invitation(
    token: str,
    organization_id: str,
    email: str,
) -> bool:
    """
    Accept an invitation to a workspace.

    Args:
        token (str): The invitation token.
        organization_id (str): The ID of the organization that the workspace belongs to.
        user_uid (str): The user uid.

    Returns:
        bool: True if the user was successfully added to the workspace, False otherwise

    Raises:
        HTTPException: If there is an error retrieving the workspace.
    """

    try:
        user_exists = await db_manager.get_user_with_email(email=email)
        if user_exists is not None:
            raise HTTPException(
                status_code=400, detail="User is already a member of the organization"
            )

        project_db = await db_manager.get_project_by_organization_id(
            organization_id=organization_id
        )
        if not project_db:
            raise HTTPException(
                status_code=400,
                detail="Project not found for organization invitation was sent to.",
            )

        invitation = await check_valid_invitation(str(project_db.id), email, token)
        if invitation is not None:
            await db_manager.update_invitation(
                str(invitation.id), values_to_update={"used": True}
            )
            return True

        else:
            # Existing invitation is expired
            raise HTTPException(
                status_code=400, detail="Invitation has expired or does not exist"
            )
    except Exception as e:
        raise e
