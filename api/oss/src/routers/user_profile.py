from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

from supertokens_python.recipe.session.asyncio import get_session

from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.utils.common import is_ee
from oss.src.utils.common import APIRouter
from oss.src.models.api.user_models import User
from oss.src.models.api.user_models import UserUpdate
from oss.src.services import db_manager, user_service
from oss.src.core.accounts.service import PlatformAdminAccountsService
from oss.src.core.accounts.errors import (
    AdminError,
    AccountAuthDeletionError,
    AccountHasMembersError,
    AdminUserNotFoundError,
)


if is_ee():
    from ee.src.core.access.permissions.types import Permission
    from ee.src.core.access.permissions.service import check_action_access


router = APIRouter()

_accounts_service = PlatformAdminAccountsService()


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

    assert user is not None, (
        "User not found. Please ensure that the user_id is specified correctly."
    )

    # Fall back to created_at if no update has occurred
    updated_at = user.updated_at or user.created_at

    user = User(
        id=str(user.id),
        uid=str(user.uid),
        email=str(user.email),
        username=str(user.username),
        created_at=str(user.created_at) if user.created_at else None,
        updated_at=str(updated_at) if updated_at else None,
    )

    await set_cache(
        project_id=request.state.project_id,
        user_id=request.state.user_id,
        namespace="user_profile",
        key=cache_key,
        value=user,
    )

    return user


@router.put("/username", operation_id="update_user_username")
async def update_user_username(request: Request, payload: UserUpdate):
    username = (payload.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")

    user = await db_manager.update_user_username(
        user_id=request.state.user_id,
        username=username,
    )

    await invalidate_cache(
        project_id=request.state.project_id,
        user_id=request.state.user_id,
        namespace="user_profile",
    )

    # Fall back to created_at if no update has occurred
    updated_at = user.updated_at or user.created_at

    return User(
        id=str(user.id),
        uid=str(user.uid),
        email=str(user.email),
        username=str(user.username),
        created_at=str(user.created_at) if user.created_at else None,
        updated_at=str(updated_at) if updated_at else None,
    )


@router.delete("/", operation_id="delete_user_account")
async def delete_user_account(request: Request):
    """Self-serve deletion of the caller's own account (EE only).

    Requires an interactive SuperTokens session. API keys and service tokens are
    rejected: this is an irreversible destructive action, so a leaked or embedded
    integration key must not be enough to delete the owning account.
    """
    if not is_ee():
        raise HTTPException(
            status_code=404,
            detail="Self-serve account deletion is not available on this deployment.",
        )

    # `request.state.user_id` can be populated by an API key. Require a real
    # interactive session, and reject when the request authenticated via an API
    # key (so the resolved user_id is the session user, not the key owner).
    credentials = getattr(request.state, "credentials", "") or ""
    session = await get_session(request, session_required=False)
    if session is None or credentials.startswith("ApiKey "):
        raise HTTPException(
            status_code=403,
            detail="Account deletion requires an interactive login session.",
        )

    try:
        await _accounts_service.delete_own_account(user_id=request.state.user_id)
    except AccountHasMembersError as exc:
        raise HTTPException(status_code=409, detail=exc.message)
    except AdminUserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=exc.message)
    except AccountAuthDeletionError as exc:
        raise HTTPException(status_code=502, detail=exc.message)
    except AdminError as exc:
        raise HTTPException(status_code=400, detail=exc.message)

    await invalidate_cache(
        project_id=request.state.project_id,
        user_id=request.state.user_id,
        namespace="user_profile",
    )

    return JSONResponse({"detail": "Account deleted"}, status_code=200)


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
