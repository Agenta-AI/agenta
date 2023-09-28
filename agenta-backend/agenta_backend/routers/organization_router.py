"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""

import os
import logging
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.models.api.organization_models import OrganizationOutput


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
    