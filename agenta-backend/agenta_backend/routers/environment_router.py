import os
from typing import List

from fastapi.responses import JSONResponse
from agenta_backend.services import db_manager, new_db_manager
from fastapi import APIRouter, Depends, HTTPException
from agenta_backend.utils.common import check_access_to_app, check_access_to_variant
from agenta_backend.models.api.api_models import (
    EnvironmentOutput,
    DeployToEnvironmentPayload,
)
from agenta_backend.models.converters import environment_db_to_output

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )  # noqa pylint: disable-all
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.services.selectors import get_user_and_org_id
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.get("/", response_model=List[EnvironmentOutput])
async def list_environments(
    app_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Lists the environments for the given app.
    """
    logger.debug(f"Listing environments for app: {app_id}")
    try:
        logger.debug(f"get user and org data")
        user_and_org_data: dict = await get_user_and_org_id(stoken_session)

        # Check if has app access
        logger.debug(f"check_access_to_app")
        access_app = await check_access_to_app(
            user_org_data=user_and_org_data, app_id=app_id
        )
        logger.debug(f"access_app: {access_app}")
        if not access_app:
            error_msg = f"You do not have access to this app: {app_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            environments_db = await new_db_manager.list_environments(
                app_id=app_id, **user_and_org_data
            )
            logger.debug(f"environments_db: {environments_db}")
            return [environment_db_to_output(env) for env in environments_db]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deploy/")
async def deploy_to_environment(
    payload: DeployToEnvironmentPayload,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Deploys a given variant to an environment.

    Args:
        environment_name: Name of the environment to deploy to.
        variant_id: variant id to deploy.
        stoken_session: . Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the deployment fails.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)

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
            await new_db_manager.deploy_to_environment(
                environment_name=payload.environment_name,
                variant_id=payload.variant_id,
                **user_org_data,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
