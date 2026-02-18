from uuid import UUID

from fastapi.responses import JSONResponse
from fastapi import Request

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter, is_ee
from oss.src.utils.caching import invalidate_cache
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.models.api.api_models import DeployToEnvironmentPayload
from oss.src.services.legacy_adapter import get_legacy_environments_adapter

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

router = APIRouter()

log = get_module_logger(__name__)


@router.post("/deploy/", operation_id="deploy_to_environment")
@intercept_exceptions()
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

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.DEPLOY_APPLICATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    env_adapter = get_legacy_environments_adapter()
    await env_adapter.deploy_to_environment(
        project_id=UUID(request.state.project_id),
        user_id=UUID(request.state.user_id),
        variant_id=UUID(payload.variant_id),
        environment_name=payload.environment_name,
        commit_message=payload.commit_message,
    )

    await invalidate_cache(
        project_id=request.state.project_id,
    )
