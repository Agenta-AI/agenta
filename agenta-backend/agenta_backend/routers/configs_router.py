import os
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
import logging

from agenta_backend.models.api.api_models import (
    SaveConfigPayload,
    GetConfigReponse,
)
from agenta_backend.services import (
    db_manager,
    app_manager,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.post("/")
async def save_config(
    payload: SaveConfigPayload,
    request: Request,
):
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_uid)
        base_db = await db_manager.fetch_base_and_check_access(
            payload.base_id, user_org_data
        )
        variants_db = await db_manager.list_variants_for_base(base_db, **user_org_data)
        variant_to_overwrite = None
        for variant_db in variants_db:
            if variant_db.config_name == payload.config_name:
                variant_to_overwrite = variant_db
                break
        if variant_to_overwrite is not None:
            if payload.overwrite:
                print(f"update_variant_parameters  ===> {payload.overwrite}")
                await app_manager.update_variant_parameters(
                    app_variant_id=str(variant_to_overwrite.id),
                    parameters=payload.parameters,
                    **user_org_data,
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Config name already exists. Please use a different name or set overwrite to True.",
                )
        else:
            print(
                f"add_variant_from_base_and_config overwrite ===> {payload.overwrite}"
            )
            await db_manager.add_variant_from_base_and_config(
                base_db=base_db,
                new_config_name=payload.config_name,
                parameters=payload.parameters,
                **user_org_data,
            )
    except HTTPException as e:
        logger.error(f"save_config http exception ===> {e.detail}")
        raise
    except Exception as e:
        logger.error(f"save_config exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/", response_model=GetConfigReponse)
async def get_config(
    request: Request,
    base_id: str,
    config_name: Optional[str] = None,
    environment_name: Optional[str] = None,
):
    try:
        # detemine whether the user has access to the base
        user_org_data: dict = await get_user_and_org_id(request.state.user_uid)
        base_db = await db_manager.fetch_base_and_check_access(base_id, user_org_data)
        # in case environment_name is provided, find the variant deployed
        if environment_name:
            app_environments = await db_manager.list_environments(
                app_id=str(base_db.app.id)
            )
            found_variant = None
            for app_environments in app_environments:
                if app_environments.name == environment_name:
                    found_variant = await db_manager.get_app_variant_instance_by_id(
                        str(app_environments.deployed_app_variant)
                    )
                    break
            if not found_variant:
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment name {environment_name} not found for base {base_id}",
                )
            if str(found_variant.base.id) != base_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment {environment_name} does not deploy base {base_id}",
                )
            config = found_variant.config
        elif config_name:
            variants_db = await db_manager.list_variants_for_base(
                base_db, **user_org_data
            )
            found_variant = None
            for variant_db in variants_db:
                if variant_db.config_name == config_name:
                    found_variant = variant_db
                    break
            if not found_variant:
                raise HTTPException(
                    status_code=400,
                    detail=f"Config name {config_name} not found for base {base_id}",
                )
            config = found_variant.config
        print(config.parameters)
        return GetConfigReponse(
            config_id=str(config.id),
            config_name=config.config_name,
            current_version=config.current_version,
            parameters=config.parameters,
        )
    except HTTPException as e:
        logger.error(f"get_config http exception: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"get_config exception: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
