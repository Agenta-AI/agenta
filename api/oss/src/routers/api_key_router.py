from typing import List
from fastapi import Request, HTTPException

from oss.src.utils.common import APIRouter
from oss.src.services import api_key_service
from oss.src.models.api.api_models import ListAPIKeysResponse


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

    api_keys = await api_key_service.list_api_keys(
        user_id=request.state.user_id,
        project_id=request.state.project_id,
    )

    return [
        ListAPIKeysResponse(
            prefix=api_key.prefix,
            created_at=str(api_key.created_at),
            last_used_at=str(api_key.updated_at),
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

    try:
        await api_key_service.delete_api_key(
            user_id=request.state.user_id, key_prefix=key_prefix
        )
        return {"message": "API key deleted successfully"}
    except KeyError:
        raise HTTPException(
            status_code=404, detail="API key not found or does not belong to the user."
        )


@router.get(
    "/{key_prefix}/validate/", response_model=bool, operation_id="validate_api_key"
)
async def validate_api_key(key_prefix: str):
    """
    This Function is called by the CLI and is used to validate an API key provided by a user in agenta init setup.
    Returns:
        bool: True. If the request reaches this point, the API key is valid.
    """
    return True
