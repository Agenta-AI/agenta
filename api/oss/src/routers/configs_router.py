from typing import Optional
from fastapi.responses import JSONResponse
from fastapi import Request, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.api_models import GetConfigResponse

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

from oss.src.routers.variants_router import configs_deploy, ReferenceRequestModel


router = APIRouter()

log = get_module_logger(__file__)


@router.get("/", response_model=GetConfigResponse, operation_id="get_config")
async def get_config(
    request: Request,
    base_id: str,
    config_name: Optional[str] = None,
    environment_name: Optional[str] = None,
):
    try:
        base_db = await db_manager.fetch_base_by_id(base_id)

        # determine whether the user has access to the base
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(base_db.project_id),
                permission=Permission.MODIFY_VARIANT_CONFIGURATIONS,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                log.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        # in case environment_name is provided, find the variant deployed
        if environment_name:
            app_environments = await db_manager.list_environments(
                app_id=str(base_db.app_id),  # type: ignore
            )
            found_variant_revision = next(
                (
                    app_environment.deployed_app_variant_revision
                    for app_environment in app_environments
                    if app_environment.name == environment_name
                ),
                None,
            )
            if not found_variant_revision:
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment name {environment_name} not found for base {str(base_db.id)}",
                )
            if str(found_variant_revision.base_id) != str(base_db.id):
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment {environment_name} does not deploy base {str(base_db.id)}",
                )

            variant_revision = found_variant_revision.revision
            config = {
                "name": found_variant_revision.config_name,
                "parameters": found_variant_revision.config_parameters,
            }
        elif config_name:
            variants_db = await db_manager.list_variants_for_base(base_db)
            found_variant = next(
                (
                    variant_db
                    for variant_db in variants_db
                    if variant_db.config_name == config_name  # type: ignore
                ),
                None,
            )
            if not found_variant:
                raise HTTPException(
                    status_code=400,
                    detail=f"Config name {config_name} not found for base {str(base_db.id)}",
                )
            variant_revision = found_variant.revision
            config = {
                "name": found_variant.config_name,
                "parameters": found_variant.config_parameters,
            }

        assert (
            "name" and "parameters" in config
        ), "'name' and 'parameters' not found in configuration"
        return GetConfigResponse(
            config_name=config["name"],  # type: ignore
            current_version=variant_revision,  # type: ignore
            parameters=config["parameters"],  # type: ignore
        )
    except HTTPException as e:
        log.error(f"get_config http exception: {e.detail}")
        raise e


@router.get(
    "/deployment/{deployment_revision_id}/",
    operation_id="get_config_deployment_revision",
)
async def get_config_deployment_revision(
    request: Request,
    deployment_revision_id: str,
):
    environment_revision = await db_manager.fetch_app_environment_revision(
        deployment_revision_id
    )
    if environment_revision is None:
        raise HTTPException(
            404, f"No environment revision found for {deployment_revision_id}"
        )

    variant_revision = await db_manager.fetch_app_variant_revision_by_id(
        str(environment_revision.deployed_app_variant_revision_id)
    )
    if not variant_revision:
        raise HTTPException(
            404,
            f"No configuration found for deployment revision {deployment_revision_id}",
        )

    return GetConfigResponse(
        **variant_revision.get_config(),
        current_version=environment_revision.revision,  # type: ignore
    )


@router.post(
    "/deployment/{deployment_revision_id}/revert/",
    operation_id="revert_deployment_revision",
)
async def revert_deployment_revision(
    request: Request,
    deployment_revision_id: str,
):
    environment_revision = await db_manager.fetch_app_environment_revision(
        deployment_revision_id
    )
    if environment_revision is None:
        raise HTTPException(
            404,
            f"No environment revision found for deployment revision {deployment_revision_id}",
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(environment_revision.project_id),
            permission=Permission.EDIT_APP_ENVIRONMENT_DEPLOYMENT,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    if environment_revision.deployed_app_variant_revision_id is None:
        raise HTTPException(
            404,
            f"No deployed app variant found for deployment revision: {deployment_revision_id}",
        )

    app_variant_revision = await db_manager.fetch_app_variant_revision_by_id(
        str(environment_revision.deployed_app_variant_revision_id)
    )

    variant_ref = ReferenceRequestModel(id=str(app_variant_revision.id))

    environment_ref = ReferenceRequestModel(id=str(environment_revision.environment_id))

    return await configs_deploy(
        request,
        variant_ref=variant_ref,
        environment_ref=environment_ref,
    )
