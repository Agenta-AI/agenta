import os
from agenta_backend.models.db_models import UserDB
from fastapi import HTTPException, Request
from agenta_backend.models.api.user_models import User
from agenta_backend.services import db_manager
from agenta_backend.utils.common import APIRouter

router = APIRouter()

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id


@router.get("/", operation_id="user_profile")
async def user_profile(
    request: Request,
):
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        user = await db_manager.get_user(user_uid=user_org_data["uid"])
        return User(
            id=str(user.id),
            uid=str(user.uid),
            username=str(user.username),
            email=str(user.email),
        ).dict(exclude_unset=True)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
