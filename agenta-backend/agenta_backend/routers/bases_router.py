import os
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException
from agenta_backend.models.api.api_models import BaseOutput
from fastapi.responses import JSONResponse
from agenta_backend.services import db_manager
from agenta_backend.models import converters

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.cloud.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id
from agenta_backend.utils.common import check_access_to_app

import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.get("/", response_model=List[BaseOutput])
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
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        access_app = await check_access_to_app(
            user_org_data=user_org_data, app_id=app_id
        )
        if not access_app:
            error_msg = f"You cannot access app: {app_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )
        bases = await db_manager.list_bases_for_app_id(
            app_id, base_name, **user_org_data
        )
        return [converters.base_db_to_pydantic(base) for base in bases]
    except Exception as e:
        logger.error(f"list_bases exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e))
