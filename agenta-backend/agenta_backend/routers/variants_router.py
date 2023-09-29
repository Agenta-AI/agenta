import os
import logging
from docker.errors import DockerException
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from typing import Any, List, Optional, Union
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import (
    app_manager,
    docker_utils,
    db_manager,
)
from agenta_backend.utils.common import (
    check_access_to_app,
    get_app_instance,
    check_user_org_access,
    check_access_to_variant,
)
from agenta_backend.models.api.api_models import (
    URI,
    App,
    RemoveApp,
    AppOutput,
    CreateApp,
    CreateAppOutput,
    AppVariant,
    Image,
    DockerEnvVars,
    CreateAppVariant,
    AddVariantFromPreviousPayload,
    AppVariantOutput,
    UpdateVariantParameterPayload,
    AddVariantFromImagePayload,
    AddVariantFromBasePayload,
    EnvironmentOutput,
    VariantAction,
    VariantActionEnum,
)
from agenta_backend.models import converters

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
async def add_variant_from_base(
    payload: AddVariantFromBasePayload,
    stoken_session: SessionContainer = Depends(verify_session),
) -> Union[AppVariantOutput, Any]:
    """Add a new variant based on an existing one.

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

        # Find the previous variant in the database
        app_variant_db = await db_manager.find_previous_variant_from_base_id(
            payload.base_id
        )
        if app_variant_db is None:
            logger.error("Failed to find the previous app variant in the database.")
            raise HTTPException(
                status_code=500, detail="Previous app variant not found"
            )
        logger.debug(f"Located previous variant: {app_variant_db}")

        # Get user and organization data
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        logger.debug(f"Retrieved user and organization data: {user_org_data}")

        # Check user access permissions
        access = await check_user_org_access(
            user_org_data, app_variant_db.organization_id.id
        )
        if not access:
            logger.error(
                "User does not have the required permissions to access this app variant."
            )
            raise HTTPException(
                status_code=500,
                detail="You do not have permission to access this app variant",
            )
        logger.debug("User has required permissions to access this app variant.")

        # Add new variant based on the previous one
        db_app_variant = await db_manager.add_variant_based_on_previous(
            previous_app_variant=app_variant_db,
            new_variant_name=payload.new_variant_name,
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
            await app_manager.remove_app_variant(
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
    """Updates the parameters for an app variant

    Arguments:
        app_variant -- Appvariant to update
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
    """Updates the image used in an app variant

    Arguments:
        app_variant -- the app variant to update
        image -- the image information
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
