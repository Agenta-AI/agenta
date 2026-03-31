from uuid import UUID
from typing import Any, Optional

from fastapi.responses import JSONResponse
from fastapi import Request, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.api_models import GetConfigResponse
from oss.src.services.legacy_adapter import (
    get_legacy_adapter,
    get_legacy_environments_adapter,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access

from oss.src.routers.variants_router import configs_deploy, ReferenceRequestModel


router = APIRouter()

log = get_module_logger(__name__)


def _safe_ref_id(ref: Any) -> Optional[UUID]:
    """Extract the UUID id from a Reference object or raw dict."""
    if hasattr(ref, "id") and ref.id:
        return ref.id if isinstance(ref.id, UUID) else UUID(str(ref.id))
    if isinstance(ref, dict):
        rid = ref.get("id")
        if isinstance(rid, UUID):
            return rid
        if isinstance(rid, str):
            try:
                return UUID(rid)
            except (ValueError, AttributeError):
                return None
    return None


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
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                # log.debug(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        if not environment_name and not config_name:
            raise HTTPException(
                status_code=400,
                detail="Either environment_name or config_name is required",
            )

        # in case environment_name is provided, find the variant deployed
        if environment_name:
            env_adapter = get_legacy_environments_adapter()

            env_dicts = await env_adapter.list_environments(
                project_id=UUID(str(base_db.project_id)),
                app_id=UUID(str(base_db.app_id)),
            )
            found_env = next(
                (e for e in env_dicts if e["name"] == environment_name),
                None,
            )
            if not found_env or not found_env.get("deployed_app_variant_revision_id"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment name {environment_name} not found for base {str(base_db.id)}",
                )

            # Fetch the revision via the applications service (git model)
            app_adapter = get_legacy_adapter()
            app_revision = await app_adapter.fetch_revision_by_id(
                project_id=UUID(str(base_db.project_id)),
                revision_id=UUID(found_env["deployed_app_variant_revision_id"]),
            )
            if not app_revision:
                raise HTTPException(
                    status_code=400,
                    detail=f"Environment name {environment_name} not found for base {str(base_db.id)}",
                )

            parameters = {}
            if app_revision.data:
                parameters = app_revision.data.parameters or {}

            variant_revision = app_revision.version
            config = {
                "name": app_revision.name or app_revision.slug,
                "parameters": parameters,
            }
        else:
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
    # Try new environment tables first
    env_adapter = get_legacy_environments_adapter()
    from oss.src.core.shared.dtos import Reference, Windowing

    env_revisions = await env_adapter.environments_service.query_environment_revisions(
        project_id=UUID(request.state.project_id),
        environment_revision_refs=[Reference(id=UUID(deployment_revision_id))],
        windowing=Windowing(limit=1),
    )

    if not env_revisions:
        # Fallback to old tables for backwards compatibility
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

    env_rev = env_revisions[0]

    # Find the first deployed_app_variant_revision_id in references
    deployed_variant_revision_id = None
    if env_rev.data and env_rev.data.references:
        for key, refs_dict in env_rev.data.references.items():
            if key.endswith(".revision") and isinstance(refs_dict, dict):
                app_revision_ref = refs_dict.get("application_revision")
                if app_revision_ref:
                    ref_id = _safe_ref_id(app_revision_ref)
                    if ref_id:
                        deployed_variant_revision_id = ref_id
                        break

    if not deployed_variant_revision_id:
        raise HTTPException(
            404,
            f"No configuration found for deployment revision {deployment_revision_id}",
        )

    app_adapter = get_legacy_adapter()
    app_revision = await app_adapter.fetch_revision_by_id(
        project_id=UUID(request.state.project_id),
        revision_id=deployed_variant_revision_id,
    )
    if not app_revision:
        raise HTTPException(
            404,
            f"No configuration found for deployment revision {deployment_revision_id}",
        )

    parameters = {}
    if app_revision.data:
        parameters = app_revision.data.parameters or {}

    return GetConfigResponse(
        config_name=app_revision.name or app_revision.slug,
        current_version=env_rev.version,  # type: ignore
        parameters=parameters,
    )


@router.post(
    "/deployment/{deployment_revision_id}/revert/",
    operation_id="revert_deployment_revision",
)
async def revert_deployment_revision(
    request: Request,
    deployment_revision_id: str,
):
    from oss.src.core.shared.dtos import Reference, Windowing

    env_adapter = get_legacy_environments_adapter()

    env_revisions = await env_adapter.environments_service.query_environment_revisions(
        project_id=UUID(request.state.project_id),
        environment_revision_refs=[Reference(id=UUID(deployment_revision_id))],
        windowing=Windowing(limit=1),
    )

    if not env_revisions:
        # Fallback to old tables
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
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
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
        environment_ref = ReferenceRequestModel(
            id=str(environment_revision.environment_id)
        )

        return await configs_deploy(
            request,
            variant_ref=variant_ref,
            environment_ref=environment_ref,
        )

    env_rev = env_revisions[0]

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_APP_ENVIRONMENT_DEPLOYMENT,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    # Find the deployed variant revision ID from references
    deployed_variant_revision_id = None
    if env_rev.data and env_rev.data.references:
        for key, refs_dict in env_rev.data.references.items():
            if key.endswith(".revision") and isinstance(refs_dict, dict):
                app_revision_ref = refs_dict.get("application_revision")
                if app_revision_ref:
                    ref_id = _safe_ref_id(app_revision_ref)
                    if ref_id:
                        deployed_variant_revision_id = ref_id
                        break

    if not deployed_variant_revision_id:
        raise HTTPException(
            404,
            f"No deployed app variant found for deployment revision: {deployment_revision_id}",
        )

    # Resolve environment slug from the revision's artifact
    env_id = env_rev.environment_id or env_rev.artifact_id
    if not env_id:
        raise HTTPException(
            404,
            f"No environment found for deployment revision: {deployment_revision_id}",
        )

    env = await env_adapter.environments_service.fetch_environment(
        project_id=UUID(request.state.project_id),
        environment_ref=Reference(id=env_id),
    )
    if not env:
        raise HTTPException(
            404,
            f"No environment found for deployment revision: {deployment_revision_id}",
        )

    variant_ref = ReferenceRequestModel(id=str(deployed_variant_revision_id))
    environment_ref = ReferenceRequestModel(slug=env.slug)

    return await configs_deploy(
        request,
        variant_ref=variant_ref,
        environment_ref=environment_ref,
    )
