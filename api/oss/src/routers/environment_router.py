from fastapi.responses import JSONResponse
from fastapi import Request

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager, app_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.api_models import DeployToEnvironmentPayload

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

router = APIRouter()

log = get_module_logger(__file__)


@router.post("/deploy/", operation_id="deploy_to_environment")
async def deploy_to_environment(
    payload: DeployToEnvironmentPayload,
    request: Request,
):
    """Deploys a given variant to an environment

    Args:
        environment_name: Name of the environment to deploy to.
        variant_id: variant id to deploy.

    Raises:
        HTTPException: If the deployment fails.
    """

    variant = await db_manager.fetch_app_variant_by_id(
        app_variant_id=payload.variant_id
    )
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(variant.project_id),
            permission=Permission.DEPLOY_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    await db_manager.deploy_to_environment(
        environment_name=payload.environment_name,
        variant_id=payload.variant_id,
        commit_message=payload.commit_message,
        user_uid=request.state.user_id,
    )

    # Update last_modified_by app information
    await app_manager.update_last_modified_by(
        user_uid=request.state.user_id,
        object_id=payload.variant_id,
        object_type="variant",
        project_id=str(variant.project_id),
    )
