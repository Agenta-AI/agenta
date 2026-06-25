from typing import List

from fastapi import HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter
from oss.src.services import organization_service

from ee.src.core.access.permissions.types import Permission

router = APIRouter()

log = get_module_logger(__name__)


@router.get(
    "/permissions/",
    operation_id="get_all_workspace_permissions",
    response_model=List[Permission],
)
async def get_all_workspace_permissions() -> List[Permission]:
    """
    Get all workspace permissions.

    Returns a list of all available workspace permissions.

    Returns:
        List[Permission]: A list of Permission objects representing the available workspace permissions.

    Raises:
        HTTPException: If there is an error retrieving the workspace permissions.

    """
    try:
        workspace_permissions = (
            await organization_service.get_all_workspace_permissions()
        )
        return sorted(workspace_permissions)
    except Exception:
        log.error(
            "Unexpected error while fetching workspace permissions",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while fetching workspace permissions.",
        )
