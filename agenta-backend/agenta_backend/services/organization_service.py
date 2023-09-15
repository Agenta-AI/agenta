import os
import sendgrid
from typing import List
from bson import ObjectId
from datetime import datetime
from fastapi import HTTPException
from sendgrid.helpers.mail import Mail
from agenta_backend.models.api.organization_models import (
    User,
    Organization,
    OrganizationUpdate,
)
from agenta_backend.models.db_models import OrganizationDB
from agenta_backend.models.db_engine import DBEngine

# Initialize database engine
engine = DBEngine(mode="default").engine()

sg = sendgrid.SendGridAPIClient(api_key=os.environ.get("SENDGRID_API_KEY"))


async def check_user_org_access(kwargs: dict, organisation_id: ObjectId) -> bool:
    user_organisations: List = kwargs["organization_ids"]

    if organisation_id not in user_organisations:
        return False
    else:
        return True


async def get_organization(org_id: str) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    return org


async def create_new_organization(payload: Organization) -> OrganizationDB:
    org_instance = OrganizationDB(**payload.dict())
    org = await engine.save(org_instance)
    return org


async def update_organization(
    org_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        updated_org = org.update(values_to_update)
        await engine.save(updated_org)
        return org
    raise NotFound("Organization not found")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass


def send_invitation_email(
    email: str, token: str, organization: Organization, user: User
):
    message = Mail(
        from_email="account@hello.agenta.ai",
        to_emails=email,
        subject=f"{user.username} invited you to join {organization.name}",
        html_content=f"<p>Hello,</p>"
        f"<p>{user.username} has invited you to join {organization.name} on Agenta. "
        f"Click the link below to accept the invitation:</p>"
        f'<a href="https://demo.agenta.ai/organisations/accept?token={token}&org_id={organization.id}">Accept Invitation</a>',
    )
    try:
        sg.send(message)
        return True
    except Exception as e:
        print(e)


async def accept_org_invitation(organization: Organization, user: User, token: str):
    try:
        for invitation in organization.invitations:
            if (
                invitation.token == token
                and invitation.email == user.email
                and not invitation.used
                and invitation.expiration_date > datetime.utcnow()
            ):
                # Token is valid, not used, and not expired
                organization.members.append(user)
                invitation.used = True

                # Save the updated organization to the database
                await engine.save(organization)

                return True  # Invitation accepted

        return False  # Invitation not found, not in the organization, or expired

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


async def notify_org_admin_invitation(organization: Organization, user: User):
    owner_email = organization.owner.email
    new_member_username = user.username
    organization_name = organization.name

    message = Mail(
        from_email="account@hello.agenta.ai",
        to_emails=owner_email,
        subject=f"New Member Joined {organization_name}",
        html_content=f"<p>Hello,</p>"
        f'<p>{new_member_username} has joined your organization "{organization_name}" on Agenta.</p>'
        f"<p>Thank you for using Agenta!</p>",
    )

    try:
        sg.send(message)
        return True
    except Exception as e:
        print(e)
