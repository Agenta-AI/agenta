import logging
from typing import Any, Optional, Union, List, Dict

from docker.errors import DockerException
from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, Body, status

from agenta_backend.models import converters
from agenta_backend.utils.common import APIRouter, isCloudEE
from agenta_backend.services import app_manager, db_manager

if isCloudEE():
    from agenta_backend.commons.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.shared_models import (
        Permission,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.api.api_models import (
        Image_ as Image,
        AppVariantResponse_ as AppVariantResponse,
    )
    from agenta_backend.cloud.services import logs_manager
else:
    from agenta_backend.models.api.api_models import (
        Image,
        AppVariantResponse,
    )
    from agenta_backend.services import logs_manager

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

    logger.debug("Initiating process to add a variant based on a previous one.")
    logger.debug(f"Received payload: {payload}")

    base_db = await db_manager.fetch_base_by_id(payload.base_id)

    # Check user has permission to add variant
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(base_db.project_id),
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
        project_id=str(base_db.project_id),
    )
    logger.debug(f"Successfully added new variant: {db_app_variant}")

    # Update last_modified_by app information
    await app_manager.update_last_modified_by(
        user_uid=request.state.user_id,
        object_id=str(db_app_variant.app_id),
        object_type="app",
        project_id=str(base_db.project_id),
    )
    logger.debug("Successfully updated last_modified_by app information")

    app_variant_db = await db_manager.get_app_variant_instance_by_id(
        str(db_app_variant.id), str(db_app_variant.project_id)
    )
    return await converters.app_variant_db_to_output(app_variant_db)


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
        variant = await db_manager.fetch_app_variant_by_id(variant_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(variant.project_id),
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

        # Update last_modified_by app information
        await app_manager.update_last_modified_by(
            user_uid=request.state.user_id,
            object_id=variant_id,
            object_type="variant",
            project_id=str(variant.project_id),
        )
        logger.debug("Successfully updated last_modified_by app information")

        await app_manager.terminate_and_remove_app_variant(
            project_id=str(variant.project_id), app_variant_id=variant_id
        )
    except DockerException as e:
        detail = f"Docker error while trying to remove the app variant: {str(e)}"
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
        variant_db = await db_manager.fetch_app_variant_by_id(variant_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(variant_db.project_id),
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
            project_id=str(variant_db.project_id),
        )

        # Update last_modified_by app information
        await app_manager.update_last_modified_by(
            user_uid=request.state.user_id,
            object_id=variant_id,
            object_type="variant",
            project_id=str(variant_db.project_id),
        )
        logger.debug("Successfully updated last_modified_by app information")
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
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
                project_id=str(db_app_variant.project_id),
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
            db_app_variant,
            str(db_app_variant.project_id),
            image,
            request.state.user_id,
        )

        # Update last_modified_by app information
        await app_manager.update_last_modified_by(
            user_uid=request.state.user_id,
            object_id=str(db_app_variant.app_id),
            object_type="app",
            project_id=str(db_app_variant.project_id),
        )
        logger.debug("Successfully updated last_modified_by app information")

    except ValueError as e:
        import traceback

        traceback.print_exc()
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        import traceback

        traceback.print_exc()
        detail = f"Docker error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        import traceback

        traceback.print_exc()
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/service/", operation_id="update_variant_url")
async def update_variant_url(
    variant_id: str,
    url: str,
    request: Request,
):
    """
    Updates the URL used in an app variant.

    Args:
        variant_id (str): The ID of the app variant to update.
        url (str): The URL to update.

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
                project_id=str(db_app_variant.project_id),
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

        await app_manager.update_variant_url(
            db_app_variant,
            str(db_app_variant.project_id),
            url,
            request.state.user_id,
        )

        # Update last_modified_by app information
        await app_manager.update_last_modified_by(
            user_uid=request.state.user_id,
            object_id=str(db_app_variant.app_id),
            object_type="app",
            project_id=str(db_app_variant.project_id),
        )
        logger.debug("Successfully updated last_modified_by app information")

    except ValueError as e:
        import traceback

        traceback.print_exc()
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        import traceback

        traceback.print_exc()
        detail = f"Docker error while trying to update the app variant: {str(e)}"
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
            project_id=str(app_variant_db.project_id),
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
    envvars = {} if env_vars is None else env_vars.env_vars

    if action.action == VariantActionEnum.START:
        url: URI = await app_manager.start_variant(
            app_variant_db,
            str(app_variant_db.project_id),
            envvars,
            request.state.user_id,
        )

    return url


@router.get("/{variant_id}/logs/", operation_id="retrieve_variant_logs")
async def retrieve_variant_logs(
    variant_id: str,
    request: Request,
):
    try:
        app_variant = await db_manager.fetch_app_variant_by_id(variant_id)
        deployment = await db_manager.get_deployment_by_appid(str(app_variant.app.id))
        if deployment.container_id is not None:
            logs_result = await logs_manager.retrieve_logs(deployment.container_id)
            return logs_result
        else:
            raise HTTPException(
                404,
                detail="No logs available for this variant.",
            )
    except Exception as exc:
        logger.exception(f"An error occurred: {str(exc)}")
        raise HTTPException(500, {"message": str(exc)})


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
    app_variant = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_variant.project_id),
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


@router.get(
    "/{variant_id}/revisions/",
    operation_id="get_variant_revisions",
    response_model=List[AppVariantRevision],
)
async def get_variant_revisions(
    variant_id: str,
    request: Request,
):
    logger.debug("getting variant revisions: ", variant_id)
    app_variant = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_variant.project_id),
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
        app_variant=app_variant, project_id=str(app_variant.project_id)
    )
    return await converters.app_variant_db_revisions_to_output(app_variant_revisions)


@router.get(
    "/{variant_id}/revisions/{revision_number}/",
    operation_id="get_variant_revision",
    response_model=AppVariantRevision,
)
async def get_variant_revision(
    variant_id: str,
    revision_number: int,
    request: Request,
):
    logger.debug("getting variant revision: ", variant_id, revision_number)
    assert (
        variant_id != "undefined"
    ), "Variant id is required to retrieve variant revision"
    app_variant = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_variant.project_id),
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
    if not app_variant_revision:
        raise HTTPException(
            404,
            detail=f"Revision {revision_number} does not exist for variant '{app_variant.variant_name}'. Please check the available revisions and try again.",
        )

    return await converters.app_variant_db_revision_to_output(app_variant_revision)


### --- CONFIGS --- ###

from agenta_backend.utils.exceptions import handle_exceptions

from agenta_backend.services.variants_manager import (
    BaseModel,
    ReferenceDTO,
    ConfigDTO,
)

from agenta_backend.services.variants_manager import (
    add_config,
    fetch_config_by_variant_ref,
    fetch_config_by_environment_ref,
    fork_config_by_variant_ref,
    fork_config_by_environment_ref,
    commit_config,
    deploy_config,
    delete_config,
    list_configs,
    history_configs,
)


class ReferenceRequest(BaseModel):
    application_ref: ReferenceDTO


class ConfigRequest(BaseModel):
    config: ConfigDTO


class ReferenceRequestModel(ReferenceDTO):
    pass


class ConfigRequestModel(ConfigDTO):
    pass


class ConfigResponseModel(ConfigDTO):
    pass


@router.post(
    "/configs/add",
    operation_id="configs_add",
    response_model=ConfigResponseModel,
)
@handle_exceptions()
async def configs_add(
    request: Request,
    variant_ref: ReferenceRequestModel,
    application_ref: ReferenceRequestModel,
):
    config = await fetch_config_by_variant_ref(
        project_id=request.state.project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=request.state.user_id,
    )
    if config:
        raise HTTPException(
            status_code=400,
            detail="Config already exists.",
        )

    config = await add_config(
        project_id=request.state.project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=request.state.user_id,
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Config not found.",
        )

    return config


@router.post(
    "/configs/fetch",
    operation_id="configs_fetch",
    response_model=ConfigResponseModel,
)
@handle_exceptions()
async def configs_fetch(
    request: Request,
    variant_ref: Optional[ReferenceRequestModel] = None,
    environment_ref: Optional[ReferenceRequestModel] = None,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    config = None
    if variant_ref:
        config = await fetch_config_by_variant_ref(
            project_id=request.state.project_id,
            variant_ref=variant_ref,
            application_ref=application_ref,
            user_id=request.state.user_id,
        )
    elif environment_ref:
        config = await fetch_config_by_environment_ref(
            project_id=request.state.project_id,
            environment_ref=environment_ref,
            application_ref=application_ref,
            user_id=request.state.user_id,
        )
    else:
        environment_ref = ReferenceRequestModel(
            slug="production", id=None, version=None
        )
        config = await fetch_config_by_environment_ref(
            project_id=request.state.project_id,
            environment_ref=environment_ref,
            application_ref=application_ref,
            user_id=request.state.user_id,
        )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Config not found.",
        )

    return config


@router.post(
    "/configs/fork",
    operation_id="configs_fork",
    response_model=ConfigResponseModel,
)
@handle_exceptions()
async def configs_fork(
    request: Request,
    variant_ref: Optional[ReferenceRequestModel] = None,
    environment_ref: Optional[ReferenceRequestModel] = None,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    config = None

    if variant_ref:
        config = await fork_config_by_variant_ref(
            project_id=request.state.project_id,
            variant_ref=variant_ref,
            application_ref=application_ref,
            user_id=request.state.user_id,
        )
    elif environment_ref:
        config = await fork_config_by_environment_ref(
            project_id=request.state.project_id,
            environment_ref=environment_ref,
            application_ref=application_ref,
            user_id=request.state.user_id,
        )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Config not found.",
        )

    return config


@router.post(
    "/configs/commit",
    operation_id="configs_commit",
    response_model=ConfigResponseModel,
)
@handle_exceptions()
async def configs_commit(
    request: Request,
    config: ConfigRequest,
):
    config = await commit_config(  # type: ignore
        project_id=request.state.project_id,
        config=config.config,  # type: ignore
        user_id=request.state.user_id,
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Config not found.",
        )

    return config


@router.post(
    "/configs/deploy",
    operation_id="configs_deploy",
    response_model=ConfigResponseModel,
)
@handle_exceptions()
async def configs_deploy(
    request: Request,
    variant_ref: ReferenceRequestModel,
    environment_ref: ReferenceRequestModel,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    config = await deploy_config(
        project_id=request.state.project_id,
        variant_ref=variant_ref,
        environment_ref=environment_ref,
        application_ref=application_ref,
        user_id=request.state.user_id,
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Config not found.",
        )

    return config


@router.post(
    "/configs/delete",
    operation_id="configs_delete",
    response_model=int,
)
@handle_exceptions()
async def configs_delete(
    request: Request,
    variant_ref: ReferenceRequestModel,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    await delete_config(
        project_id=request.state.project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=request.state.user_id,
    )

    return status.HTTP_204_NO_CONTENT


@router.post(
    "/configs/list",
    operation_id="configs_list",
    response_model=List[ConfigResponseModel],
)
@handle_exceptions()
async def configs_list(
    request: Request,
    application_ref: ReferenceRequest,
):
    configs = await list_configs(
        project_id=request.state.project_id,
        application_ref=application_ref.application_ref,  # type: ignore
        user_id=request.state.user_id,
    )

    return configs


@router.post(
    "/configs/history",
    operation_id="configs_history",
    response_model=List[ConfigResponseModel],
)
@handle_exceptions()
async def configs_history(
    request: Request,
    variant_ref: ReferenceRequestModel,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    configs = await history_configs(
        project_id=request.state.project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=request.state.user_id,
    )

    return configs
