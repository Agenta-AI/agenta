from typing import List, Optional

from fastapi.responses import JSONResponse
from fastapi import Request


from oss.src.utils.logging import get_module_logger
from oss.src.models import converters
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.api_models import BaseOutput

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access


router = APIRouter()

log = get_module_logger(__name__)


@router.get("/", response_model=List[BaseOutput], operation_id="list_bases")
async def list_bases(
    request: Request,
    app_id: str,
    base_name: Optional[str] = None,
) -> List[BaseOutput]:
    """
    Retrieve a list of bases filtered by app_id and base_name.

    Args:
        request (Request): The incoming request.
        app_id (str): The ID of the app to filter by.
        base_name (Optional[str], optional): The name of the base to filter by. Defaults to None.

    Returns:
        List[BaseOutput]: A list of BaseOutput objects representing the filtered bases.

    Raises:
        HTTPException: If there was an error retrieving the bases.
    """

    app = await db_manager.fetch_app_by_id(app_id=app_id)
    if is_ee() and app_id is not None:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_i),
            permission=Permission.VIEW_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    bases = await db_manager.list_bases_for_app_id(app_id, base_name)
    return [converters.base_db_to_pydantic(base) for base in bases]
