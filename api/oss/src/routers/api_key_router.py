from typing import List
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

from oss.src.utils.common import APIRouter, is_ee
from oss.src.services import api_key_service
from oss.src.models.api.api_models import ListAPIKeysResponse

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access


router = APIRouter()


@router.get("/", operation_id="list_api_keys")
async def list_api_keys(request: Request) -> List[ListAPIKeysResponse]:
    """
    List all API keys associated with the authenticated user.

    Args:
        request (Request): The incoming request object.

    Returns:
        List[ListAPIKeysResponse]: A list of API Keys associated with the user.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_API_KEYS,
        )
        if not has_permission:
            return JSONResponse(
                {
                    "detail": "You do not have access to perform this action. Please contact your organization admin."
                },
                status_code=403,
            )

    api_keys = await api_key_service.list_api_keys(
        user_id=request.state.user_id,
        project_id=request.state.project_id,
    )

    return [
        ListAPIKeysResponse(
            prefix=api_key.prefix,
            created_at=str(api_key.created_at) if api_key.created_at else None,
            last_used_at=str(api_key.updated_at) if api_key.updated_at else None,
            expiration_date=api_key.expiration_date,
        )
        for api_key in api_keys
    ]


@router.post("/", response_model=str, operation_id="create_api_key")
async def create_api_key(request: Request):
    """
    Creates an API key for a user.

    Args:
        request (Request): The request object containing the user ID in the request state.

    Returns:
        str: The created API key.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_API_KEYS,
        )
        if not has_permission:
            return JSONResponse(
                {
                    "detail": "You do not have access to perform this action. Please contact your organization admin."
                },
                status_code=403,
            )

    api_key = await api_key_service.create_api_key(
        user_id=request.state.user_id,
        project_id=request.state.project_id,
    )

    return api_key


@router.delete("/{key_prefix}/", response_model=dict, operation_id="delete_api_key")
async def delete_api_key(
    key_prefix: str,
    request: Request,
):
    """
    Delete an API key with the given key prefix for the authenticated user.

    Args:
        key_prefix (str): The prefix of the API key to be deleted.
        request (Request): The incoming request object.

    Returns:
        dict: A dictionary containing a success message upon successful deletion.

    Raises:
        HTTPException: If the API key is not found or does not belong to the user.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_API_KEYS,
        )
        if not has_permission:
            return JSONResponse(
                {
                    "detail": "You do not have access to perform this action. Please contact your organization admin."
                },
                status_code=403,
            )

    try:
        await api_key_service.delete_api_key(
            user_id=request.state.user_id, key_prefix=key_prefix
        )
        return {"message": "API key deleted successfully"}
    except KeyError:
        raise HTTPException(
            status_code=404, detail="API key not found or does not belong to the user."
        )
