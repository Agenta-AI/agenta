from typing import Any, Optional, Union, List
from uuid import UUID

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, status

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.utils.common import APIRouter
from oss.src.services.legacy_adapter import get_legacy_adapter

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
from pydantic import BaseModel


# Request/Response models for revision query
class RevisionsQueryRequest(BaseModel):
    """Request model for querying revisions by IDs"""

    revision_ids: List[UUID]


class RevisionsQueryResponse(BaseModel):
    """Response model for revision query"""

    count: int = 0
    revisions: List[AppVariantRevision] = []


router = APIRouter()

log = get_module_logger(__name__)


@router.post("/from-base/", operation_id="add_variant_from_base_and_config")
@intercept_exceptions()
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
    project_id = UUID(request.state.project_id)

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    # Determine new variant name (base_id is variant_id in new system)
    new_variant_name = (
        payload.new_variant_name
        if payload.new_variant_name
        else payload.new_config_name
        if payload.new_config_name
        else "default"
    )

    adapter = get_legacy_adapter()
    app_variant = await adapter.create_variant_from_base_id(
        project_id=project_id,
        user_id=UUID(request.state.user_id),
        base_id=UUID(payload.base_id),
        variant_name=new_variant_name,
        parameters=payload.parameters,
        commit_message=payload.commit_message,
    )

    if app_variant is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to create variant from base",
        )

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return app_variant


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
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS_VARIANT,
            )
            if not has_permission:
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                # log.debug(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        adapter = get_legacy_adapter()
        success = await adapter.mark_variant_hidden(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            variant_id=UUID(variant_id),
        )

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Variant with ID '{variant_id}' not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = f"Error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put(
    "/{variant_id}/parameters/",
    operation_id="update_variant_parameters",
    response_model=AppVariantRevision,
)
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
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.MODIFY_VARIANT_CONFIGURATIONS,
            )
            if not has_permission:
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                # log.debug(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        adapter = get_legacy_adapter()
        revision = await adapter.update_variant_parameters(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            variant_id=UUID(variant_id),
            parameters=payload.parameters,
            commit_message=payload.commit_message,
        )

        if revision is None:
            raise HTTPException(
                status_code=404,
                detail=f"Variant with ID '{variant_id}' not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
        )

        return revision

    except HTTPException:
        raise
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
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,
            )
            if not has_permission:
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                # log.debug(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        adapter = get_legacy_adapter()
        app_variant = await adapter.update_variant_url(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            variant_id=UUID(payload.variant_id),
            url=payload.url,
            commit_message=payload.commit_message,
        )

        if app_variant is None:
            raise HTTPException(
                status_code=404,
                detail=f"Variant with ID '{payload.variant_id}' not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
        )

    except HTTPException:
        raise
    except ValueError as e:
        import traceback

        traceback.print_exc()
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
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
    adapter = get_legacy_adapter()
    app_variant = await adapter.fetch_variant(
        project_id=UUID(request.state.project_id),
        variant_id=UUID(variant_id),
    )

    if app_variant is None:
        raise HTTPException(
            status_code=404,
            detail=f"Variant with ID '{variant_id}' not found",
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    return app_variant


@router.get(
    "/{variant_id}/revisions/",
    operation_id="get_variant_revisions",
    response_model=List[AppVariantRevision],
)
async def get_variant_revisions(
    variant_id: str,
    request: Request,
):
    cache_key = {
        "variant_id": variant_id,
    }

    app_variant_revisions = await get_cache(
        project_id=request.state.project_id,
        namespace="get_variant_revisions",
        key=cache_key,
        model=AppVariantRevision,
        is_list=True,
    )

    if app_variant_revisions is not None:
        return app_variant_revisions

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    adapter = get_legacy_adapter()
    app_variant_revisions = await adapter.list_variant_revisions(
        project_id=UUID(request.state.project_id),
        variant_id=UUID(variant_id),
    )

    await set_cache(
        project_id=request.state.project_id,
        namespace="get_variant_revisions",
        key=cache_key,
        value=app_variant_revisions,
    )

    return app_variant_revisions


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
    assert variant_id != "undefined", (
        "Variant id is required to retrieve variant revision"
    )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    adapter = get_legacy_adapter()
    app_variant_revision = await adapter.fetch_variant_revision(
        project_id=UUID(request.state.project_id),
        variant_id=UUID(variant_id),
        revision_number=revision_number,
    )

    if not app_variant_revision:
        raise HTTPException(
            404,
            detail=f"Revision {revision_number} does not exist for variant. Please check the available revisions and try again.",
        )

    return app_variant_revision


@router.post(
    "/revisions/query/",
    operation_id="query_variant_revisions",
    response_model=RevisionsQueryResponse,
)
async def query_variant_revisions(
    request: Request,
    payload: RevisionsQueryRequest,
):
    """Query variant revisions by their IDs.

    This endpoint allows batch fetching of multiple revisions at once,
    which is more efficient than making individual requests.

    Args:
        payload: Request containing list of revision IDs to fetch

    Returns:
        RevisionsQueryResponse: Response containing the count and list of revisions
    """
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    adapter = get_legacy_adapter()
    revisions = []
    for revision_id in payload.revision_ids:
        try:
            revision = await adapter.fetch_revision_by_id(
                project_id=UUID(request.state.project_id),
                revision_id=revision_id,
            )
            if revision:
                revision_output = (
                    await adapter._application_revision_to_variant_revision(revision)
                )
                revisions.append(revision_output)
        except Exception as e:
            log.warning(f"Failed to fetch revision {revision_id}: {e}")
            continue

    return RevisionsQueryResponse(
        count=len(revisions),
        revisions=revisions,
    )


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
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS_VARIANT,
            )
            if not has_permission:
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                # log.debug(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        adapter = get_legacy_adapter()
        success = await adapter.archive_variant_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            revision_id=UUID(revision_id),
        )

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Revision with ID '{revision_id}' not found",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = f"Error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


### --- CONFIGS --- ###

from oss.src.services.variants_manager import (  # noqa: E402
    BaseModel,
    ReferenceDTO,
    ConfigDTO,
)
from oss.src.services.variants_manager import (  # noqa: E402
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
    id: Optional[UUID] = None


class ConfigRequestModel(ConfigDTO):
    pass


class ConfigResponseModel(ConfigDTO):
    pass


class ConfigsQueryRequestModel(BaseModel):
    variant_refs: Optional[List[ReferenceRequestModel]] = None
    application_ref: Optional[ReferenceRequestModel] = None


class ConfigsResponseModel(BaseModel):
    count: int = 0
    configs: List[ConfigDTO] = []


@router.post(
    "/configs/add",
    operation_id="configs_add",
    response_model=ConfigResponseModel,
)
@intercept_exceptions()
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

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return config


@router.post(
    "/configs/fetch",
    operation_id="configs_fetch",
    response_model=ConfigResponseModel,
)
@intercept_exceptions()
async def configs_fetch(
    request: Request,
    variant_ref: Optional[ReferenceRequestModel] = None,
    environment_ref: Optional[ReferenceRequestModel] = None,
    application_ref: Optional[ReferenceRequestModel] = None,
):
    """Fetch configuration for a variant or environment.

    Either variant_ref OR environment_ref must be provided (if neither is provided,
    a default environment_ref with slug="production" will be used).

    For each reference object (variant_ref, environment_ref, application_ref):
    - Provide either 'slug' or 'id' field
    - 'version' is optional and can be set to null
    - If 'id' is provided, it will be used directly to fetch the resource
    - Otherwise, 'slug' will be used along with application_ref

    Returns:
        ConfigResponseModel: The configuration for the requested variant or environment.

    Raises:
        HTTPException: If the configuration is not found.
    """
    cache_key = {
        "variant_ref": (variant_ref.model_dump() if variant_ref else None),
        "environment_ref": (environment_ref.model_dump() if environment_ref else None),
        "application_ref": (application_ref.model_dump() if application_ref else None),
    }

    config = await get_cache(
        project_id=request.state.project_id,
        namespace="configs_fetch",
        key=cache_key,
        model=ConfigDTO,
    )

    if config is not None:
        return config

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

    await set_cache(
        project_id=request.state.project_id,
        namespace="configs_fetch",
        key=cache_key,
        value=config,
    )

    return config


@router.post(
    "/configs/fork",
    operation_id="configs_fork",
    response_model=ConfigResponseModel,
)
@intercept_exceptions()
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

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return config


@router.post(
    "/configs/query",
    operation_id="configs_query",
    response_model=ConfigsResponseModel,
)
@intercept_exceptions()
async def configs_query(
    request: Request,
    query: ConfigsQueryRequestModel,
) -> ConfigsResponseModel:
    application_ref = query.application_ref
    variant_refs = query.variant_refs or []

    if not variant_refs:
        return ConfigsResponseModel(count=0, configs=[])

    seen_keys = set()
    configs: List[ConfigDTO] = []

    for variant_ref in variant_refs:
        dedup_key = (
            str(variant_ref.id) if variant_ref.id else None,
            variant_ref.slug or None,
            variant_ref.version or None,
        )
        if dedup_key in seen_keys:
            continue

        seen_keys.add(dedup_key)

        try:
            config = await configs_fetch(
                request=request,
                variant_ref=variant_ref,
                application_ref=application_ref,
            )
        except HTTPException:
            config = None

        if config:
            configs.append(config)

    return ConfigsResponseModel(
        count=len(configs),
        configs=configs,
    )


@router.post(
    "/configs/commit",
    operation_id="configs_commit",
    response_model=ConfigResponseModel,
)
@intercept_exceptions()
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

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return config


@router.post(
    "/configs/deploy",
    operation_id="configs_deploy",
    response_model=ConfigResponseModel,
)
@intercept_exceptions()
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

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return config


@router.post(
    "/configs/delete",
    operation_id="configs_delete",
    response_model=int,
)
@intercept_exceptions()
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

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return status.HTTP_204_NO_CONTENT


@router.post(
    "/configs/list",
    operation_id="configs_list",
    response_model=List[ConfigResponseModel],
)
@intercept_exceptions()
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
@intercept_exceptions()
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
