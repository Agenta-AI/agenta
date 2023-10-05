"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""

import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.models.api.organization_models import (
    OrganizationOutput,
    Organization,
)
from agenta_backend.services import db_manager

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (  # noqa pylint: disable-all
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get("/", response_model=list[Organization])
async def list_organizations(
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Returns a list of organizations associated with the user's session.

    Args:
        stoken_session (SessionContainer): The user's session token.

    Returns:
        list[Organization]: A list of organizations associated with the user's session.

    Raises:
        HTTPException: If there is an error retrieving the organizations from the database.
    """

    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        organizations_db = await db_manager.get_organizations_by_list_ids(
            user_org_data["organization_ids"]
        )
        response = [
            Organization(
                id=str(org.id),
                name=str(org.name),
                description=str(org.description),
                owner=str(org.owner),
            ).dict(exclude_unset=True)
            for org in organizations_db
        ]

        return response

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.get("/own/")
async def get_user_organization(
    stoken_session: SessionContainer = Depends(verify_session()),
):
    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        org_db = await get_user_own_org(user_org_data["uid"])
        if org_db is None:
            raise HTTPException(404, detail="User does not have an organization")
        return OrganizationOutput(id=str(org_db.id), name=org_db.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
