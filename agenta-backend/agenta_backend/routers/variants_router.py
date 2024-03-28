import os
import logging
from typing import Any, Optional, Union, List

from docker.errors import DockerException
from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, Body

from agenta_backend.models import converters
from agenta_backend.utils.common import APIRouter, isCloudEE
from agenta_backend.services import (
    app_manager,
    db_manager,
)

if isCloudEE():
    from agenta_backend.commons.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.db_models import (
        Permission,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.api.api_models import (
        Image_ as Image,
        AppVariantResponse_ as AppVariantResponse,
    )
else:
    from agenta_backend.models.api.api_models import (
        Image,
        AppVariantResponse,
    )

from agenta_backend.models.api.api_models import (
    URI,
    DockerEnvVars,
    VariantAction,
    VariantActionEnum,
    AppVariantRevision,
    AddVariantFromBasePayload,
    UpdateVariantParameterPayload,
)

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.post("/from-base/", operation_id="add_variant_from_base_and_config")
async def add_variant_from_base_and_config(
    payload: AddVariantFromBasePayload,
    request: Request,
) -> Union[AppVariantResponse, Any]:
    """Add a new variant based on an existing one.
    Same as POST /config

    Args:
        payload (AddVariantFromBasePayload): Payload containing base variant ID, new variant name, and parameters.
        stoken_session (SessionContainer, optional): Session container. Defaults to result of verify_session().

    Raises:
        HTTPException: Raised if the variant could not be added or accessed.

    Returns:
        Union[AppVariantResponse, Any]: New variant details or exception.
    """
    try:
        logger.debug("Initiating process to add a variant based on a previous one.")
        logger.debug(f"Received payload: {payload}")

        base_db = await db_manager.fetch_base_by_id(payload.base_id)

        # Check user has permission to add variant
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=base_db,
                permission=Permission.CREATE_APPLICATION,
            )
            logger.debug(
                f"User has Permission to create variant from base and config: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        # Find the previous variant in the database
        db_app_variant = await db_manager.add_variant_from_base_and_config(
            base_db=base_db,
            new_config_name=payload.new_config_name,
            parameters=payload.parameters,
            user_uid=request.state.user_id,
        )
        logger.debug(f"Successfully added new variant: {db_app_variant}")
        app_variant_db = await db_manager.get_app_variant_instance_by_id(
            str(db_app_variant.id)
        )
        return await converters.app_variant_db_to_output(app_variant_db)

    except Exception as e:
        import traceback

        traceback.print_exc()
        logger.error(f"An exception occurred while adding the new variant: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{variant_id}/", operation_id="remove_variant")
async def remove_variant(
    variant_id: str,
    request: Request,
):
    """Remove a variant from the server.
    In the case it's the last variant using the image, stop the container and remove the image.

    Arguments:
        app_variant -- AppVariant to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """
    try:
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=variant_id,
                object_type="app_variant",
                permission=Permission.DELETE_APPLICATION_VARIANT,
            )
            logger.debug(f"User has Permission to delete app variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        await app_manager.terminate_and_remove_app_variant(app_variant_id=variant_id)
    except DockerException as e:
        detail = f"Docker error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/parameters/", operation_id="update_variant_parameters")
async def update_variant_parameters(
    request: Request,
    variant_id: str,
    payload: UpdateVariantParameterPayload = Body(...),
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
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=variant_id,
                object_type="app_variant",
                permission=Permission.MODIFY_VARIANT_CONFIGURATIONS,
            )
            logger.debug(
                f"User has Permission to update variant parameters: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        await app_manager.update_variant_parameters(
            app_variant_id=variant_id,
            parameters=payload.parameters,
            user_uid=request.state.user_id,
        )
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/image/", operation_id="update_variant_image")
async def update_variant_image(
    variant_id: str,
    image: Image,
    request: Request,
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
        db_app_variant = await db_manager.fetch_app_variant_by_id(
            app_variant_id=variant_id
        )

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=db_app_variant,
                permission=Permission.CREATE_APPLICATION,
            )
            logger.debug(
                f"User has Permission to update variant image: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        await app_manager.update_variant_image(
            db_app_variant, image, request.state.user_id
        )
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        detail = f"Docker error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/", operation_id="start_variant")
async def start_variant(
    request: Request,
    variant_id: str,
    action: VariantAction,
    env_vars: Optional[DockerEnvVars] = None,
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
    app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)

    # Check user has permission to start variant
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object=app_variant_db,
            permission=Permission.CREATE_APPLICATION,
        )
        logger.debug(f"User has Permission to start variant: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    logger.debug("Starting variant %s", variant_id)

    # Inject env vars to docker container
    if isCloudEE():
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

    if action.action == VariantActionEnum.START:
        url: URI = await app_manager.start_variant(app_variant_db, envvars)
    return url


@router.get(
    "/{variant_id}/",
    operation_id="get_variant",
    response_model=AppVariantResponse,
)
async def get_variant(
    variant_id: str,
    request: Request,
):
    logger.debug("getting variant " + variant_id)
    try:
        app_variant = await db_manager.fetch_app_variant_by_id(
            app_variant_id=variant_id
        )

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app_variant,
                permission=Permission.VIEW_APPLICATION,
            )
            logger.debug(f"User has Permission to get variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        return await converters.app_variant_db_to_output(app_variant)
    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/{base_id}/",
    operation_id="get_variant_using_base_id",
    response_model=AppVariantResponse,
)
async def get_variant_using_base_id(
    base_id: str,
    request: Request,
):
    logger.debug("getting variant with base " + base_id)
    try:
        app_variant = await db_manager.fetch_app_variant_by_base_id(base_id=base_id)

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app_variant,
                permission=Permission.VIEW_APPLICATION,
            )
            logger.debug(f"User has Permission to get variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        return await converters.app_variant_db_to_output(app_variant)
    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/{variant_id}/revisions/",
    operation_id="get_variant_revisions",
    response_model=List[AppVariantRevision],
)
async def get_variant_revisions(variant_id: str, request: Request):
    logger.debug("getting variant revisions: ", variant_id)
    try:
        app_variant = await db_manager.fetch_app_variant_by_id(
            app_variant_id=variant_id
        )

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app_variant,
                permission=Permission.VIEW_APPLICATION,
            )
            logger.debug(f"User has Permission to get variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        app_variant_revisions = await db_manager.list_app_variant_revisions_by_variant(
            app_variant=app_variant
        )
        return await converters.app_variant_db_revisions_to_output(
            app_variant_revisions
        )
    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/{variant_id}/revisions/{revision_number}/",
    operation_id="get_variant_revision",
    response_model=AppVariantRevision,
)
async def get_variant_revision(variant_id: str, revision_number: int, request: Request):
    logger.debug("getting variant revision: ", variant_id, revision_number)
    try:
        app_variant = await db_manager.fetch_app_variant_by_id(
            app_variant_id=variant_id
        )

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app_variant,
                permission=Permission.VIEW_APPLICATION,
            )
            logger.debug(f"User has Permission to get variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        app_variant_revision = await db_manager.fetch_app_variant_revision(
            variant_id, revision_number
        )
        return await converters.app_variant_db_revision_to_output(app_variant_revision)
    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
