import os
from agenta_backend.models.db_models import UserDB
from fastapi import APIRouter, HTTPException, Request
from agenta_backend.models.api.user_models import User
from agenta_backend.services import db_manager

router = APIRouter()

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id


@router.get("/")
async def user_profile(
    request: Request,
):
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        user = await db_manager.get_user_object(user_org_data["uid"])

        return User(
            id=str(user.id),
            uid=str(user.uid),
            username=str(user.username),
            email=str(user.email),
        ).dict(exclude_unset=True)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
