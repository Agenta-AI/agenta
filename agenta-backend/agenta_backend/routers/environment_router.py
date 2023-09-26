import os
from typing import List

from fastapi.responses import JSONResponse
from agenta_backend.services import db_manager, new_db_manager
from fastapi import APIRouter, Depends, HTTPException
from agenta_backend.utills.common import check_access_to_app, check_access_to_variant
from agenta_backend.models.api.api_models import EnvironmentOutput
from agenta_backend.models.converters import environment_db_to_output
if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.get("/", response_model=List[EnvironmentOutput])
async def list_environments(
    app_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Lists the environments for the given app.
    """
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)

        # Check if has app access
        access_app = await check_access_to_app(kwargs, app_id=app_id)

        if not access_app:
            error_msg = f"You do not have access to this app: {app_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            environments_db = await new_db_manager.list_environments(
                app_id=app_id, **kwargs
            )
            return environment_db_to_output(environments_db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deploy/")
async def deploy_to_environment(
    environment_name: str,
    variant_id: str,
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
        kwargs: dict = await get_user_and_org_id(stoken_session)

        # Check if has app access
        access_app = await check_access_to_variant(kwargs, variant_id=variant_id)

        if not access_app:
            error_msg = f"You do not have access to this variant: {variant_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await new_db_manager.deploy_to_environment(
                environment_name=environment_name, variant_id=variant_id, **kwargs
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
