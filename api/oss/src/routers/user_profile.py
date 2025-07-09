from fastapi import Request
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.utils.common import is_ee
from oss.src.utils.common import APIRouter
from oss.src.models.api.user_models import User
from oss.src.services import db_manager, user_service


if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

log = get_module_logger(__name__)


router = APIRouter()

admin_router = APIRouter()


@router.get("/", operation_id="fetch_user_profile")
async def user_profile(request: Request):
    cache_key = {}

    user = await get_cache(
        project_id=request.state.project_id,
        user_id=request.state.user_id,
        namespace="user_profile",
        key=cache_key,
        model=User,
    )

    if user is not None:
        return user

    user = await db_manager.get_user_with_id(user_id=request.state.user_id)

    assert (
        user is not None
    ), "User not found. Please ensure that the user_id is specified correctly."

    user = User(
        id=str(user.id),
        uid=str(user.uid),
        email=str(user.email),
        username=str(user.username),
        created_at=str(user.created_at),
        updated_at=str(user.updated_at),
    )

    await set_cache(
        project_id=request.state.project_id,
        user_id=request.state.user_id,
        namespace="user_profile",
        key=cache_key,
        value=user,
    )

    return user


@router.post("/reset-password", operation_id="reset_user_password")
async def reset_user_password(request: Request, user_id: str):
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.RESET_PASSWORD,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    user_password = await user_service.generate_user_password_reset_link(
        user_id=user_id,
        admin_user_id=request.state.user_id,
    )
    return user_password


@admin_router.post("/delete-all", operation_id="delete_accounts")
async def delete_accounts():
    if is_ee():
        return JSONResponse({"detail": "Not available in 'ee'."}, status_code=403)

    await db_manager.delete_accounts()

    return JSONResponse({"detail": "All accounts deleted."}, status_code=200)
