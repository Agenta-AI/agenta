import logging
from typing import Any, Optional, Union, List

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, Body, status

from oss.src.models import converters
from oss.src.utils.common import APIRouter, is_ee
from oss.src.services import app_manager, db_manager

if is_ee():
    from ee.src.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all
    from ee.src.models.shared_models import (
        Permission,
    )  # noqa pylint: disable-all
    from ee.src.models.api.api_models import (
        AppVariantResponse_ as AppVariantResponse,
    )
else:
    from oss.src.models.api.api_models import (
        AppVariantResponse,
    )

from oss.src.models.api.api_models import (
    AppVariantRevision,
    UpdateVariantURLPayload,
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

    Raises:
        HTTPException: Raised if the variant could not be added or accessed.

    Returns:
        Union[AppVariantResponse, Any]: New variant details or exception.
    """

    logger.debug("Initiating process to add a variant based on a previous one.")
    logger.debug(f"Received payload: {payload}")

    base_db = await db_manager.fetch_base_by_id(payload.base_id)

    # Check user has permission to add variant
    if is_ee():
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
    new_variant_name = (
        payload.new_variant_name
        if payload.new_variant_name
        else payload.new_config_name
        if payload.new_config_name
        else base_db.base_name
    )
    db_app_variant = await db_manager.add_variant_from_base_and_config(
        base_db=base_db,
        new_config_name=new_variant_name,
        parameters=payload.parameters,
        user_uid=request.state.user_id,
        project_id=str(base_db.project_id),
        commit_message=payload.commit_message,
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


@router.delete("/{variant_id}/", operation_id="mark_variant_as_hidden")
async def remove_variant(
    variant_id: str,
    request: Request,
):
    """Mark a variant as hidden from the UI.

    Arguments:
        app_variant -- AppVariant to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """

    try:
        variant = await db_manager.fetch_app_variant_by_id(variant_id)
        if is_ee():
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

        await db_manager.mark_app_variant_as_hidden(app_variant_id=variant_id)
    except Exception as e:
        detail = f"Error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/{variant_id}/parameters/", operation_id="update_variant_parameters")
async def update_variant_parameters(
    request: Request,
    variant_id: str,
    payload: UpdateVariantParameterPayload,
):
    """
    Updates the parameters for an app variant.

    Args:
        variant_id (str): The ID of the app variant to update.
        payload (UpdateVariantParameterPayload): The payload containing the updated parameters.

    Raises:
        HTTPException: If there is an error while trying to update the app variant.

    Returns:
        JSONResponse: A JSON response containing the updated app variant parameters.
    """

    try:
        variant_db = await db_manager.fetch_app_variant_by_id(variant_id)
        if is_ee():
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
            commit_message=payload.commit_message,
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


@router.put("/{variant_id}/service/", operation_id="update_variant_url")
async def update_variant_url(request: Request, payload: UpdateVariantURLPayload):
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
            app_variant_id=payload.variant_id
        )

        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(db_app_variant.project_id),
                permission=Permission.CREATE_APPLICATION,
            )
            logger.debug(f"User has Permission to update variant: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        await app_manager.update_variant_url(
            app_variant_db=db_app_variant,
            project_id=str(db_app_variant.project_id),
            url=payload.url,
            user_uid=request.state.user_id,
            commit_message=payload.commit_message,
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
    except:
        import traceback

        traceback.print_exc()
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


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

    if is_ee():
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
    app_variant = await db_manager.fetch_app_variant_by_id(app_variant_id=variant_id)

    if is_ee():
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

    if is_ee():
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


@router.delete(
    "/{variant_id}/revisions/{revision_id}/",
    operation_id="mark_variant_revision_as_hidden",
)
async def remove_variant_revision(
    variant_id: str,
    revision_id: str,
    request: Request,
):
    """Mark a variant revision as hidden from the UI.

    Arguments:
        app_variant -- AppVariant to remove
        revision_id -- Revision ID to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """

    try:
        variant = await db_manager.fetch_app_variant_by_id(variant_id)
        if is_ee():
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

        await db_manager.mark_app_variant_revision_as_hidden(
            variant_revision_id=revision_id
        )
    except Exception as e:
        detail = f"Error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


### --- CONFIGS --- ###

from oss.src.utils.exceptions import handle_exceptions
from oss.src.services.variants_manager import (
    BaseModel,
    ReferenceDTO,
    ConfigDTO,
)
from oss.src.services.variants_manager import (
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
