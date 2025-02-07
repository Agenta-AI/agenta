from typing import Optional

from fastapi import HTTPException, Request

from agenta_backend.services import db_manager
from agenta_backend.utils.common import APIRouter
from agenta_backend.models.api.user_models import User

router = APIRouter()


@router.get("/", operation_id="fetch_user_profile")
async def user_profile(request: Request, user_id: Optional[str] = None):
    if user_id is not None:
        user = await db_manager.get_user_with_id(user_id=user_id)
    else:
        user = await db_manager.get_user(request.state.user_id)

    assert (
        user is not None
    ), "User not found. Please ensure that the user_id is specified correctly."
    return User(
        id=str(user.id),
        uid=str(user.uid),
        email=str(user.email),
        username=str(user.username),
        created_at=str(user.created_at),
        updated_at=str(user.updated_at),
    ).model_dump(exclude_unset=True)
