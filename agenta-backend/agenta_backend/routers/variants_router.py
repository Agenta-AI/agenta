import os
import logging
from docker.errors import DockerException
from fastapi.responses import JSONResponse
from typing import Any, Optional, Union
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.services import (
    app_manager,
    db_manager,
)
from agenta_backend.utils.common import (
    check_access_to_variant,
    check_access_to_base,
)
from agenta_backend.models import converters

from agenta_backend.models.api.api_models import (
    Image,
    URI,
    DockerEnvVars,
    AddVariantFromBasePayload,
    AppVariantOutput,
    UpdateVariantParameterPayload,
    VariantAction,
    VariantActionEnum,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (  # noqa pylint: disable-all
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.post("/from-base/")
async def add_variant_from_base_and_config(
    payload: AddVariantFromBasePayload,
    stoken_session: SessionContainer = Depends(verify_session),
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
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        base_db = db_manager.fetch_base_and_check_access(
            base_id=payload.base_id, **user_org_data
        )

        # Find the previous variant in the database

        db_app_variant = await db_manager.add_variant_from_base_and_config(
            base_db=base_db,
            new_config_name=payload.new_config_name,
            parameters=payload.parameters,
            **user_org_data,
        )
        logger.debug(f"Successfully added new variant: {db_app_variant}")
        return converters.app_variant_db_to_output(db_app_variant)

    except Exception as e:
        logger.error(f"An exception occurred while adding the new variant: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{variant_id}")
async def remove_variant(
    variant_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Remove a variant from the server.
    In the case it's the last variant using the image, stop the container and remove the image.

    Arguments:
        app_variant -- AppVariant to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """
    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)

        # Check app access

        access_app = await check_access_to_variant(
            user_org_data, variant_id=variant_id, check_owner=True
        )

        if not access_app:
            error_msg = (
                f"You do not have permission to delete app variant: {variant_id}"
            )
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.terminate_and_remove_app_variant(
                app_variant_id=variant_id, **user_org_data
            )
    except DockerException as e:
        detail = f"Docker error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/parameters/")
async def update_variant_parameters(
    variant_id: str,
    payload: UpdateVariantParameterPayload,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Updates the parameters for an app variant.

    Args:
        variant_id (str): The ID of the app variant to update.
        payload (UpdateVariantParameterPayload): The payload containing the updated parameters.
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If there is an error while trying to update the app variant.

    Returns:
        JSONResponse: A JSON response containing the updated app variant parameters.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        access_variant = await check_access_to_variant(
            user_org_data=user_org_data, variant_id=variant_id
        )

        if not access_variant:
            error_msg = (
                f"You do not have permission to update app variant: {variant_id}"
            )
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.update_variant_parameters(
                app_variant_id=variant_id,
                parameters=payload.parameters,
                **user_org_data,
            )
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/image/")
async def update_variant_image(
    variant_id: str,
    image: Image,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Updates the image used in an app variant.

    Args:
        variant_id (str): The ID of the app variant to update.
        image (Image): The image information to update.

    Raises:
        HTTPException: If an error occurs while trying to update the app variant.

    Returns:
        JSONResponse: A JSON response indicating whether the update was successful or not.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        access_variant = await check_access_to_variant(
            user_org_data=user_org_data, variant_id=variant_id
        )
        if not access_variant:
            error_msg = (
                f"You do not have permission to update app variant: {variant_id}"
            )
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        db_app_variant = await db_manager.fetch_app_variant_by_id(
            app_variant_id=variant_id
        )

        await app_manager.update_variant_image(db_app_variant, image, **user_org_data)
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        detail = f"Docker error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/")
async def start_variant(
    variant_id: str,
    action: VariantAction,
    env_vars: Optional[DockerEnvVars] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> URI:
    """
    Start a variant of an app.

    Args:
        variant_id (str): The ID of the variant to start.
        action (VariantAction): The action to perform on the variant (start).
        env_vars (Optional[DockerEnvVars], optional): The environment variables to inject to the Docker container. Defaults to None.
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Returns:
        URI: The URL of the started variant.

    Raises:
        HTTPException: If the app container cannot be started.
    """

    logger.debug("Starting variant %s", variant_id)
    user_org_data: dict = await get_user_and_org_id(stoken_session)

    # Inject env vars to docker container
    if os.environ["FEATURE_FLAG"] == "demo":
        if not os.environ["OPENAI_API_KEY"]:
            raise HTTPException(
                status_code=400,
                detail="Unable to start app container. Please file an issue by clicking on the button below.",
            )
        envvars = {
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        }
    else:
        envvars = {} if env_vars is None else env_vars.env_vars

    access = await check_access_to_variant(
        user_org_data=user_org_data, variant_id=variant_id
    )
    if not access:
        error_msg = f"You do not have access to this variant: {variant_id}"
        logger.error(error_msg)
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
        )
    app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)
    if action.action == VariantActionEnum.START:
        url = await app_manager.start_variant(app_variant_db, envvars, **user_org_data)
    return url
