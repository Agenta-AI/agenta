import logging

from typing import List, Optional
from fastapi.responses import JSONResponse
from fastapi import Request, HTTPException

from agenta_backend.models import converters
from agenta_backend.services import db_manager
from agenta_backend.utils.common import APIRouter, isCloudEE
from agenta_backend.models.api.api_models import BaseOutput

if isCloudEE():
    from agenta_backend.commons.models.db_models import Permission
    from agenta_backend.commons.utils.permissions import check_action_access


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get("/", response_model=List[BaseOutput], operation_id="list_bases")
async def list_bases(
    request: Request,
    app_id: Optional[str] = None,
    base_name: Optional[str] = None,
) -> List[BaseOutput]:
    """
    Retrieve a list of bases filtered by app_id and base_name.

    Args:
        request (Request): The incoming request.
        app_id (Optional[str], optional): The ID of the app to filter by. Defaults to None.
        base_name (Optional[str], optional): The name of the base to filter by. Defaults to None.

    Returns:
        List[BaseOutput]: A list of BaseOutput objects representing the filtered bases.

    Raises:
        HTTPException: If there was an error retrieving the bases.
    """
    try:
        if isCloudEE() and app_id is not None:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=app_id,
                object_type="app",
                permission=Permission.VIEW_APPLICATION,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        bases = await db_manager.list_bases_for_app_id(app_id, base_name)
        return [converters.base_db_to_pydantic(base) for base in bases]
    except Exception as e:
        logger.error(f"list_bases exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e))
