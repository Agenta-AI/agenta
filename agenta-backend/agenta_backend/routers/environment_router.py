import os
from typing import List

from agenta_backend.models.api.api_models import Environment
from agenta_backend.services import db_manager
from fastapi import APIRouter, Depends, HTTPException

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.get("/", response_model=List[Environment])
async def list_environments(
    app_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Lists the environments for the given app.
    """
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        app_variants = await db_manager.list_environments(app_name=app_name, **kwargs)
        return app_variants
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deploy/")
async def deploy_environment(
    environment_name: str,
    app_name: str,
    variant_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    print("deploying environment")
    print(environment_name, app_name, variant_name)
    """
    Deploys the given environment for the given app with the given variant.
    """
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        await db_manager.deploy_environment(
            app_name, environment_name, variant_name, **kwargs
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
