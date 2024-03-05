import os
from fastapi import HTTPException, Request
from agenta_backend.services import db_manager
from agenta_backend.utils.common import APIRouter
from agenta_backend.models.api.user_models import User

router = APIRouter()


@router.get("/", operation_id="user_profile")
async def user_profile(
    request: Request,
):
    try:
        user = await db_manager.get_user(request.state.user_id)
        return User(
            id=str(user.id),
            uid=str(user.uid),
            username=str(user.username),
            email=str(user.email),
        ).dict(exclude_unset=True)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
