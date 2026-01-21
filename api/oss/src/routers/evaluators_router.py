from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException, Request
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter
from oss.src.services import evaluator_manager, evaluators_service

from oss.src.models.api.evaluation_model import (
    LegacyEvaluator,
    EvaluatorConfig,
    NewEvaluatorConfig,
    UpdateEvaluatorConfig,
    EvaluatorInputInterface,
    EvaluatorOutputInterface,
    EvaluatorMappingInputInterface,
    EvaluatorMappingOutputInterface,
)
from oss.src.core.secrets.utils import get_llm_providers_secrets

from oss.src.services.auth_service import sign_secret_token
from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager

# New system imports for adapters
from oss.src.core.evaluators.dtos import (
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorData,
    SimpleEvaluatorFlags,
)
from oss.src.apis.fastapi.evaluators.models import (
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorEditRequest,
    SimpleEvaluatorQueryRequest,
)

router = APIRouter()

log = get_module_logger(__name__)

# Lazy import to avoid circular dependency
_simple_evaluators_router = None


def _get_simple_evaluators_router():
    """Lazy getter for simple_evaluators router to avoid circular imports."""
    global _simple_evaluators_router
    if _simple_evaluators_router is None:
        from entrypoints.routers import simple_evaluators

        _simple_evaluators_router = simple_evaluators
    return _simple_evaluators_router


def _simple_evaluator_to_evaluator_config(
    project_id: str,
    #
    simple_evaluator: SimpleEvaluator,
) -> EvaluatorConfig:
    """Convert SimpleEvaluator to EvaluatorConfig format for backward compatibility."""
    evaluator_key = ""
    settings_values = None

    if simple_evaluator.data:
        # Extract evaluator_key from URI (format: "agenta:builtin:{key}:v0")
        if simple_evaluator.data.uri:
            parts = simple_evaluator.data.uri.split(":")
            if len(parts) >= 3 and parts[0] == "agenta" and parts[1] == "builtin":
                evaluator_key = parts[2]

        # Get settings from parameters
        settings_values = simple_evaluator.data.parameters

    return EvaluatorConfig(
        id=str(simple_evaluator.id),
        name=simple_evaluator.name or "",
        project_id=project_id,
        evaluator_key=evaluator_key,
        settings_values=settings_values,
        created_at=simple_evaluator.created_at.isoformat()
        if simple_evaluator.created_at
        else "",
        updated_at=simple_evaluator.updated_at.isoformat()
        if simple_evaluator.updated_at
        else "",
    )


@router.get("/", response_model=List[LegacyEvaluator])
async def get_evaluators_endpoint():
    """
    Endpoint to fetch a list of evaluators.

    Returns:
        List[Evaluator]: A list of evaluator objects.
    """

    evaluators = evaluator_manager.get_evaluators()

    if evaluators is None:
        raise HTTPException(status_code=500, detail="Error processing evaluators file")

    if not evaluators:
        raise HTTPException(status_code=404, detail="No evaluators found")

    return evaluators


@router.post("/map/", response_model=EvaluatorMappingOutputInterface)
async def evaluator_data_map(request: Request, payload: EvaluatorMappingInputInterface):
    """Endpoint to map the experiment data tree to evaluator interface.

    Args:
        request (Request): The request object.
        payload (EvaluatorMappingInputInterface): The payload containing the request data.

    Returns:
        EvaluatorMappingOutputInterface: the evaluator mapping output object
    """

    mapped_outputs = await evaluators_service.map(mapping_input=payload)
    return mapped_outputs


@router.post("/{evaluator_key}/run/", response_model=EvaluatorOutputInterface)
async def evaluator_run(
    request: Request, evaluator_key: str, payload: EvaluatorInputInterface
):
    """Endpoint to evaluate LLM app run

    Args:
        request (Request): The request object.
        evaluator_key (str): The key of the evaluator.
        payload (EvaluatorInputInterface): The payload containing the request data.

    Returns:
        result: EvaluatorOutputInterface object containing the outputs.
    """

    providers_keys_from_vault = await get_llm_providers_secrets(
        project_id=request.state.project_id
    )

    payload.credentials = providers_keys_from_vault

    secret_token = await sign_secret_token(
        user_id=str(request.state.user_id),
        project_id=str(request.state.project_id),
        workspace_id=str(request.state.workspace_id),
        organization_id=str(request.state.organization_id),
    )
    credentials = f"Secret {secret_token}"

    tracing_ctx = TracingContext.get()
    tracing_ctx.credentials = credentials

    ctx = RunningContext.get()
    ctx.credentials = credentials

    with tracing_context_manager(tracing_ctx):
        with running_context_manager(ctx):
            try:
                result = await evaluators_service.run(
                    evaluator_key=evaluator_key,
                    evaluator_input=payload,
                )
            except Exception as e:
                log.warning(
                    f"Error with evaluator /run",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=424
                    if any(code in str(e) for code in ["401", "403", "429"])
                    else 500,
                    detail=str(e),
                )

            return result


# -----------------------------------------------------------------------------
# /configs/* endpoints - ADAPTERS to SimpleEvaluatorsRouter
# These endpoints delegate to the new artifact-variant-revision system
# by calling the SimpleEvaluatorsRouter methods directly.
# -----------------------------------------------------------------------------


@router.get("/configs/", response_model=List[EvaluatorConfig])
async def get_evaluator_configs(
    request: Request,
    app_id: Optional[str] = None,
):
    # ADAPTER: Call SimpleEvaluatorsRouter.query_simple_evaluators

    simple_router = _get_simple_evaluators_router()

    simple_evaluator_query_request = SimpleEvaluatorQueryRequest()

    response = await simple_router.query_simple_evaluators(
        request=request,
        #
        simple_evaluator_query_request=simple_evaluator_query_request,
    )

    evaluator_configs = [
        _simple_evaluator_to_evaluator_config(
            project_id=request.state.project_id,
            simple_evaluator=simple_evaluator,
        )
        for simple_evaluator in response.evaluators
    ]

    return evaluator_configs


@router.get("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(
    evaluator_config_id: str,
    request: Request,
):
    # ADAPTER: Call SimpleEvaluatorsRouter.fetch_simple_evaluator

    simple_router = _get_simple_evaluators_router()

    response = await simple_router.fetch_simple_evaluator(
        request=request,
        #
        evaluator_id=UUID(evaluator_config_id),
    )

    if response.evaluator is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluator config {evaluator_config_id} not found",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        simple_evaluator=response.evaluator,
    )


@router.post("/configs/", response_model=EvaluatorConfig)
async def create_new_evaluator_config(
    payload: NewEvaluatorConfig,
    request: Request,
):
    # ADAPTER: Convert to new format and call SimpleEvaluatorsRouter.create_simple_evaluator

    simple_router = _get_simple_evaluators_router()

    # Build URI from evaluator_key
    uri = f"agenta:builtin:{payload.evaluator_key}:v0"

    simple_evaluator_create = SimpleEvaluatorCreate(
        name=payload.name,
        description=None,
        #
        flags=SimpleEvaluatorFlags(is_evaluator=True),
        tags=None,
        meta=None,
        #
        data=SimpleEvaluatorData(
            uri=uri,
            parameters=payload.settings_values,
        ),
    )

    simple_evaluator_create_request = SimpleEvaluatorCreateRequest(
        evaluator=simple_evaluator_create,
    )

    response = await simple_router.create_simple_evaluator(
        request=request,
        #
        simple_evaluator_create_request=simple_evaluator_create_request,
    )

    if response.evaluator is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to create evaluator config",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        #
        simple_evaluator=response.evaluator,
    )


@router.put("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def update_evaluator_config(
    request: Request,
    *,
    evaluator_config_id: str,
    #
    payload: UpdateEvaluatorConfig,
):
    """Endpoint to update evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """
    # ADAPTER: Fetch existing, merge updates, call SimpleEvaluatorsRouter.edit_simple_evaluator

    simple_router = _get_simple_evaluators_router()

    # First fetch the existing evaluator
    fetch_response = await simple_router.fetch_simple_evaluator(
        request=request,
        #
        evaluator_id=UUID(evaluator_config_id),
    )

    old_evaluator = fetch_response.evaluator

    if old_evaluator is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluator config {evaluator_config_id} not found",
        )

    updates = payload.model_dump(exclude_unset=True)

    # Build new name
    new_name = old_evaluator.name

    if "name" in updates and updates["name"]:
        new_name = updates["name"]

    # Build new uri
    new_uri = old_evaluator.data.uri if old_evaluator.data else None

    if "evaluator_key" in updates and updates["evaluator_key"]:
        new_uri = f"agenta:builtin:{updates['evaluator_key']}:v0"

    # Build new parameters
    new_parameters = old_evaluator.data.parameters if old_evaluator.data else None

    if "settings_values" in updates and updates["settings_values"]:
        new_parameters = updates["settings_values"]

    simple_evaluator_edit = SimpleEvaluatorEdit(
        id=UUID(evaluator_config_id),
        #
        name=new_name,
        description=old_evaluator.description,
        #
        flags=old_evaluator.flags,
        tags=old_evaluator.tags,
        meta=old_evaluator.meta,
        #
        data=SimpleEvaluatorData(
            uri=new_uri,
            parameters=new_parameters,
        ),
    )

    simple_evaluator_edit_request = SimpleEvaluatorEditRequest(
        evaluator=simple_evaluator_edit,
    )

    response = await simple_router.edit_simple_evaluator(
        request=request,
        #
        evaluator_id=UUID(evaluator_config_id),
        #
        simple_evaluator_edit_request=simple_evaluator_edit_request,
    )

    if response.evaluator is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to update evaluator config",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        #
        simple_evaluator=response.evaluator,
    )


@router.delete("/configs/{evaluator_config_id}/", response_model=bool)
async def delete_evaluator_config(
    request: Request,
    *,
    evaluator_config_id: str,
):
    # ADAPTER: Call SimpleEvaluatorsRouter.archive_simple_evaluator (soft delete)

    simple_router = _get_simple_evaluators_router()

    response = await simple_router.archive_simple_evaluator(
        request=request,
        #
        evaluator_id=UUID(evaluator_config_id),
    )

    return response.evaluator is not None
