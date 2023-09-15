import os
from bson import ObjectId
from datetime import datetime, timedelta
from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from agenta_backend.services.organization_service import (
    get_organization,
    send_invitation_email,
    accept_org_invitation,
    check_user_org_access,
    notify_org_admin_invitation,
)
from agenta_backend.services.db_manager import engine
from agenta_backend.models.db_models import InvitationDB, UserDB
from agenta_backend.utills.common import generate_invitation_token
from agenta_backend.models.api.api_models import (
    OrganizationInvite,
    OrganizationToken,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.post("/add/{organization_id}/invite/")
async def invite_to_org(
    # payload: OrganizationInvite,
    organization_id: str,
    email_address: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
        raise HTTPException(
            status_code=500,
            detail="This feature is not available in the Open Source version",
        )

    try:
        # organization_id: payload.organization_id
        # email_address: payload.email_address

        kwargs: dict = await get_user_and_org_id(stoken_session)
        organisation_access = await check_user_org_access(
            kwargs, ObjectId(organization_id)
        )

        if organisation_access:
            organization = await get_organization((organization_id))
            user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])
            if user.email == email_address:
                return JSONResponse(
                    {"message": "You cannot invite yourself to your own organisation"},
                    status_code=400,
                )

            token = generate_invitation_token()
            expiration_date = datetime.utcnow() + timedelta(days=7)

            send_email = send_invitation_email(email_address, token, organization, user)

            if send_email:
                created_invitation = InvitationDB(
                    token=token,
                    email=email_address,
                    expiration_date=expiration_date,
                    used=False,
                )

                organization.invitations.append(created_invitation)
                await engine.save(organization)

                return JSONResponse(
                    {"message": "Invited user to organisation"}, status_code=200
                )

        else:
            return JSONResponse(
                {"message": "You do not have permission to access this organisation"},
                status_code=403,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accept/")
async def add_user_to_org(
    # payload: OrganizationToken,
    organization_id: str,
    token: str,
    background_tasks: BackgroundTasks,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
        raise HTTPException(
            status_code=500,
            detail="This feature is not available in the Open Source version",
        )

    try:
        # organization_id: payload.organization_id
        # token: payload.email_address

        kwargs: dict = await get_user_and_org_id(stoken_session)
        organisation_access = await check_user_org_access(
            kwargs, ObjectId(organization_id)
        )

        if not organisation_access:
            organization = await get_organization(organization_id)
            user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])

            join_organisation = accept_org_invitation(user, organization, token)

            if join_organisation:
                background_tasks.add_task(
                    notify_org_admin_invitation, organization, user
                )

                return JSONResponse(
                    {"message": "Added user to organisation"}, status_code=200
                )
            else:
                return JSONResponse(
                    {
                        "message": "This invitation was not found, doesn't belong to this organization, or has expired"
                    },
                    status_code=400,
                )
        else:
            return JSONResponse(
                {"message": "You already belong to this organisation"}, status_code=400
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
