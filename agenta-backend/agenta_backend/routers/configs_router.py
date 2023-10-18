import os
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException
from agenta_backend.models.api.api_models import ConfigInput
from fastapi.responses import JSONResponse
from agenta_backend.services import (
    db_manager,
    app_manager,
)
from agenta_backend.models import converters

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id

import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.post("/")
async def save_config(
    payload: ConfigInput,
    request: Request,
):
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        base_db = await db_manager.fetch_base_and_check_access(
            payload.base_id, user_org_data
        )
        variants_db = await db_manager.list_variants_for_base(base_db, **user_org_data)
        config_exist = False
        for variant_db in variants_db:
            if variant_db.config_name == payload.config_name:
                config_exist = True
                variant_to_overwrite = variant_db
                break
        if config_exist:
            if payload.overwrite:
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
            await db_manager.add_variant_from_base_and_config(
                base_db=base_db,
                new_config_name=payload.config_name,
                parameters=payload.parameters,
                **user_org_data,
            )
    except Exception as e:
        logger.error(f"list_bases exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/from-base/")
async def add_variant_from_base_and_config(
    payload: AddVariantFromBasePayload,
    request: Request,
) -> Union[AppVariantOutput, Any]:
    """Add a new variant based on an existing one.
    Same as POST /config

    Args:
        payload (AddVariantFromBasePayload): Payload containing base variant ID, new variant name, and parameters.
        stoken_session (SessionContainer, optional): Session container. Defaults to result of verify_session().

    Raises:
        HTTPException: Raised if the variant could not be added or accessed.

    Returns:
        Union[AppVariantOutput, Any]: New variant details or exception.
    """
    try:
        logger.debug("Initiating process to add a variant based on a previous one.")
        logger.debug(f"Received payload: {payload}")
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        base_db = await db_manager.fetch_base_and_check_access(
            payload.base_id, user_org_data
        )

        # Find the previous variant in the database

        db_app_variant = await db_manager.add_variant_from_base_and_config(
            base_db=base_db,
            new_config_name=payload.new_config_name,
            parameters=payload.parameters,
            **user_org_data,
        )
        logger.debug(f"Successfully added new variant: {db_app_variant}")
        return await converters.app_variant_db_to_output(db_app_variant)

    except Exception as e:
        logger.error(f"An exception occurred while adding the new variant: {e}")
        raise HTTPException(status_code=500, detail=str(e))
