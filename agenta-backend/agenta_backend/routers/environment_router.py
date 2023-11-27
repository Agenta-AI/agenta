import os
from typing import List

from fastapi.responses import JSONResponse
from agenta_backend.services import db_manager
from fastapi import APIRouter, Request, HTTPException
from agenta_backend.utils.common import check_access_to_app, check_access_to_variant
from agenta_backend.models.api.api_models import (
    EnvironmentOutput,
    DeployToEnvironmentPayload,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.cloud.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.post("/deploy/")
async def deploy_to_environment(
    payload: DeployToEnvironmentPayload,
    request: Request,
):
    """Deploys a given variant to an environment

    Args:
        environment_name: Name of the environment to deploy to.
        variant_id: variant id to deploy.
        stoken_session: . Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the deployment fails.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)

        # Check if has app access
        access_app = await check_access_to_variant(
            user_org_data, variant_id=payload.variant_id
        )

        if not access_app:
            error_msg = f"You do not have access to this variant: {payload.variant_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await db_manager.deploy_to_environment(
                environment_name=payload.environment_name,
                variant_id=payload.variant_id,
                **user_org_data,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
