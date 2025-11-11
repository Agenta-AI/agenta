from ee.src.services import db_manager_ee
from oss.src.services import email_service
from oss.src.models.db_models import UserDB
from ee.src.models.db_models import (
    WorkspaceDB,
    OrganizationDB,
)
from ee.src.models.api.organization_models import (
    OrganizationUpdate,
)

from oss.src.utils.env import env


async def update_an_organization(
    org_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    org = await db_manager_ee.get_organization(org_id)
    if org is not None:
        await db_manager_ee.update_organization(str(org.id), payload)
        return org
    raise NotFound("Organization not found")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass


async def send_invitation_email(
    email: str,
    token: str,
    project_id: str,
    workspace: WorkspaceDB,
    organization: OrganizationDB,
    user: UserDB,
):
    """
    Sends an invitation email to the specified email address, containing a link to accept the invitation.

    Args:
        email (str): The email address to send the invitation to.
        token (str): The token to include in the invitation link.
        project_id (str): The ID of the project that the user is being invited to join.
        workspace (WorkspaceDB): The workspace that the user is being invited to join.
        user (UserDB): The user who is sending the invitation.

    Returns:
        bool: True if the email was sent successfully, False otherwise.
    """

    html_template = email_service.read_email_template("./templates/send_email.html")
    html_content = html_template.format(
        username_placeholder=user.username,
        action_placeholder="invited you to join",
        workspace_placeholder=workspace.name,
        call_to_action=f'Click the link below to accept the invitation:</p><br><a href="{env.AGENTA_WEB_URL}/auth?token={token}&email={email}&org_id={organization.id}&workspace_id={workspace.id}&project_id={project_id}">Accept Invitation</a>',
    )

    await email_service.send_email(
        from_email="account@hello.agenta.ai",
        to_email=email,
        subject=f"{user.username} invited you to join {workspace.name}",
        html_content=html_content,
    )
    return True


async def notify_org_admin_invitation(workspace: WorkspaceDB, user: UserDB) -> bool:
    """
    Sends an email notification to the owner of an organization when a new member joins.

    Args:
        workspace (WorkspaceDB): The workspace that the user has joined.
        user (UserDB): The user who has joined the organization.

    Returns:
        bool: True if the email was sent successfully, False otherwise.
    """

    html_template = email_service.read_email_template("./templates/send_email.html")
    html_content = html_template.format(
        username_placeholder=user.username,
        action_placeholder="joined your Workspace",
        workspace_placeholder=f'"{workspace.name}"',
        call_to_action=f'Click the link below to view your Workspace:</p><br><a href="{env.AGENTA_WEB_URL}/settings?tab=workspace">View Workspace</a>',
    )

    workspace_admins = await db_manager_ee.get_workspace_administrators(workspace)
    for workspace_admin in workspace_admins:
        await email_service.send_email(
            from_email="account@hello.agenta.ai",
            to_email=workspace_admin.email,
            subject=f"New Member Joined {workspace.name}",
            html_content=html_content,
        )

    return True


async def get_organization_details(org_id: str) -> dict:
    organization = await db_manager_ee.get_organization(org_id)
    return await db_manager_ee.get_org_details(organization)
