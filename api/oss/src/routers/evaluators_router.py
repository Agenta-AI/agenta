import re
import inspect
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, Request

from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.workflows.utils import retrieve_handler

from oss.src.core.evaluators.dtos import (
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorData,
    SimpleEvaluatorEdit,
    SimpleEvaluatorFlags,
)
from oss.src.core.evaluators.utils import build_evaluator_data
from oss.src.core.shared.dtos import Reference
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.models.api.evaluation_model import (
    EvaluatorConfig,
    EvaluatorInputInterface,
    EvaluatorMappingInputInterface,
    EvaluatorMappingOutputInterface,
    EvaluatorOutputInterface,
    LegacyEvaluator,
    NewEvaluatorConfig,
    UpdateEvaluatorConfig,
)
from oss.src.resources.evaluators.evaluators import get_all_evaluators
from oss.src.services.auth_service import sign_secret_token
from oss.src.utils.common import APIRouter
from oss.src.utils.logging import get_module_logger
from oss.src.utils.traces import (
    get_field_value_from_trace_tree,
    process_distributed_trace_into_trace_tree,
)

router = APIRouter()

log = get_module_logger(__name__)
# TEMPORARY: Disabling name editing
RENAME_EVALUATORS_DISABLED_MESSAGE = "Renaming evaluators is temporarily disabled."


def _build_rename_evaluators_disabled_detail(*, existing_name: Optional[str]) -> str:
    if existing_name:
        return (
            f"{RENAME_EVALUATORS_DISABLED_MESSAGE} "
            f"Current evaluator name is '{existing_name}'."
        )

    return RENAME_EVALUATORS_DISABLED_MESSAGE


# Load builtin evaluators once at module load
BUILTIN_EVALUATORS: List[LegacyEvaluator] = [
    LegacyEvaluator(**evaluator_dict) for evaluator_dict in get_all_evaluators()
]

# Lazy imports to avoid circular dependency
_simple_evaluators_service = None
_evaluators_service = None


def _get_services():
    """Lazy getter for evaluator services to avoid circular imports."""
    global _simple_evaluators_service, _evaluators_service
    if _simple_evaluators_service is None:
        from entrypoints.routers import (
            simple_evaluators_service,
            evaluators_service,
        )

        _simple_evaluators_service = simple_evaluators_service
        _evaluators_service = evaluators_service
    return _simple_evaluators_service, _evaluators_service


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
            elif len(parts) >= 3 and parts[0] == "user" and parts[1] == "custom":
                evaluator_key = "custom"
            else:
                log.error(
                    "Unrecognized evaluator URI format",
                    uri=simple_evaluator.data.uri,
                    evaluator_id=str(simple_evaluator.id),
                )

        # Get settings from parameters
        settings_values = simple_evaluator.data.parameters

    # Fall back to created_at if no update has occurred
    updated_at = simple_evaluator.updated_at or simple_evaluator.created_at

    return EvaluatorConfig(
        id=str(simple_evaluator.id),
        name=simple_evaluator.name or "",
        project_id=project_id,
        evaluator_key=evaluator_key,
        settings_values=settings_values,
        created_at=simple_evaluator.created_at.isoformat()
        if simple_evaluator.created_at
        else "",
        updated_at=updated_at.isoformat() if updated_at else "",
    )


@router.get("/", response_model=List[LegacyEvaluator])
async def get_evaluators_endpoint():
    return BUILTIN_EVALUATORS


@router.post("/map", response_model=EvaluatorMappingOutputInterface)
async def evaluator_data_map(request: Request, payload: EvaluatorMappingInputInterface):
    """Endpoint to map the experiment data tree to evaluator interface.

    Args:
        request (Request): The request object.
        payload (EvaluatorMappingInputInterface): The payload containing the request data.

    Returns:
        EvaluatorMappingOutputInterface: the evaluator mapping output object
    """
    mapping_outputs = {}
    mapping_inputs = payload.inputs
    response_version = payload.inputs.get("version")

    trace = {}
    if response_version == "3.0":
        trace = mapping_inputs.get("tree", {})
    elif response_version == "2.0":
        trace = mapping_inputs.get("trace", {})

    trace = process_distributed_trace_into_trace_tree(
        trace=trace,
        version=payload.inputs.get("version"),
    )
    for to_key, from_key in payload.mapping.items():
        mapping_outputs[to_key] = get_field_value_from_trace_tree(
            trace,
            from_key,
            version=payload.inputs.get("version"),
        )
    return {"outputs": mapping_outputs}


@router.post("/{evaluator_key}/run", response_model=EvaluatorOutputInterface)
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
                result = await _run_evaluator(evaluator_key, payload)
            except Exception as e:
                log.warning(
                    "Error with evaluator /run",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=424 if re.search(r"\b(401|403|429)\b", str(e)) else 500,
                    detail=str(e),
                )

            return result


async def _run_evaluator(
    evaluator_key: str,
    evaluator_input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    """Invokes an SDK evaluator workflow by key."""
    # Build URI from evaluator_key
    uri = f"agenta:builtin:{evaluator_key}:v0"

    # Retrieve the handler from SDK registry
    handler = retrieve_handler(uri)
    if handler is None:
        raise NotImplementedError(f"Evaluator {evaluator_key} not found (uri={uri})")

    # Extract data from evaluator_input
    inputs = evaluator_input.inputs or {}
    settings = evaluator_input.settings or {}

    # Get outputs/prediction from inputs
    outputs = inputs.get("prediction", inputs.get("output"))

    # Build kwargs based on handler signature
    sig = inspect.signature(handler)
    kwargs = {}
    if "parameters" in sig.parameters:
        kwargs["parameters"] = settings
    if "inputs" in sig.parameters:
        kwargs["inputs"] = inputs
    if "outputs" in sig.parameters:
        kwargs["outputs"] = outputs

    # Invoke the handler (may be sync or async)
    result = handler(**kwargs)

    # Await if coroutine
    if inspect.iscoroutine(result):
        result = await result

    # Normalize result to EvaluatorOutputInterface format
    if isinstance(result, dict):
        return {"outputs": result}

    return {"outputs": {"result": result}}


@router.get("/configs/", response_model=List[EvaluatorConfig])
async def get_evaluator_configs(
    request: Request,
    app_id: Optional[str] = None,
):
    simple_evaluators_service, _ = _get_services()

    project_id = UUID(request.state.project_id)

    simple_evaluators = await simple_evaluators_service.query(
        project_id=project_id,
    )

    configs = [
        _simple_evaluator_to_evaluator_config(
            project_id=request.state.project_id,
            simple_evaluator=simple_evaluator,
        )
        for simple_evaluator in simple_evaluators
        if not (
            (
                simple_evaluator.data
                and simple_evaluator.data.uri
                and simple_evaluator.data.uri.startswith("user:custom:")
            )
            or (simple_evaluator.flags and simple_evaluator.flags.is_human)
        )
    ]

    configs.sort(key=lambda c: c.updated_at or c.created_at or "", reverse=True)

    return configs


@router.get("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(
    evaluator_config_id: str,
    request: Request,
):
    simple_evaluators_service, _ = _get_services()

    project_id = UUID(request.state.project_id)

    simple_evaluator = await simple_evaluators_service.fetch(
        project_id=project_id,
        evaluator_id=UUID(evaluator_config_id),
    )

    if simple_evaluator is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluator config {evaluator_config_id} not found",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        simple_evaluator=simple_evaluator,
    )


@router.post("/configs/", response_model=EvaluatorConfig)
@intercept_exceptions()
async def create_new_evaluator_config(
    payload: NewEvaluatorConfig,
    request: Request,
):
    simple_evaluators_service, _ = _get_services()

    project_id = UUID(request.state.project_id)
    user_id = UUID(request.state.user_id)

    evaluator_slug = get_slug_from_name_and_id(payload.name, uuid4())

    simple_evaluator_create = SimpleEvaluatorCreate(
        slug=evaluator_slug,
        name=payload.name,
        description=None,
        #
        flags=SimpleEvaluatorFlags(is_evaluator=True),
        tags=None,
        meta=None,
        #
        data=build_evaluator_data(
            evaluator_key=payload.evaluator_key,
            settings_values=payload.settings_values,
        ),
    )

    simple_evaluator = await simple_evaluators_service.create(
        project_id=project_id,
        user_id=user_id,
        simple_evaluator_create=simple_evaluator_create,
    )

    if simple_evaluator is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to create evaluator config",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        #
        simple_evaluator=simple_evaluator,
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
    simple_evaluators_service, _ = _get_services()

    project_id = UUID(request.state.project_id)
    user_id = UUID(request.state.user_id)

    # First fetch the existing evaluator
    old_evaluator = await simple_evaluators_service.fetch(
        project_id=project_id,
        evaluator_id=UUID(evaluator_config_id),
    )

    if old_evaluator is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluator config {evaluator_config_id} not found",
        )

    updates = payload.model_dump(exclude_unset=True)

    # TEMPORARY: Disabling name editing
    if "name" in updates and updates["name"] and updates["name"] != old_evaluator.name:
        raise HTTPException(
            status_code=400,
            detail=_build_rename_evaluators_disabled_detail(
                existing_name=old_evaluator.name
            ),
        )

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
            **(
                old_evaluator.data.model_dump(
                    mode="json",
                    exclude={"uri", "parameters"},
                )
                if old_evaluator.data
                else {}
            ),
            uri=new_uri,
            parameters=new_parameters,
        ),
    )

    simple_evaluator = await simple_evaluators_service.edit(
        project_id=project_id,
        user_id=user_id,
        simple_evaluator_edit=simple_evaluator_edit,
    )

    if simple_evaluator is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to update evaluator config",
        )

    return _simple_evaluator_to_evaluator_config(
        project_id=request.state.project_id,
        #
        simple_evaluator=simple_evaluator,
    )


@router.delete("/configs/{evaluator_config_id}/", response_model=bool)
async def delete_evaluator_config(
    request: Request,
    *,
    evaluator_config_id: str,
):
    _, evaluators_service = _get_services()

    project_id = UUID(request.state.project_id)
    user_id = UUID(request.state.user_id)
    evaluator_id = UUID(evaluator_config_id)

    # Fetch the evaluator
    evaluator = await evaluators_service.fetch_evaluator(
        project_id=project_id,
        evaluator_ref=Reference(id=evaluator_id),
    )

    if not evaluator or not evaluator.id:
        return False

    # Archive the evaluator
    evaluator = await evaluators_service.archive_evaluator(
        project_id=project_id,
        user_id=user_id,
        evaluator_id=evaluator.id,
    )

    if not evaluator or not evaluator.id:
        return False

    # Archive the associated variant
    evaluator_variant = await evaluators_service.fetch_evaluator_variant(
        project_id=project_id,
        evaluator_ref=Reference(id=evaluator.id),
    )

    if evaluator_variant is not None:
        await evaluators_service.archive_evaluator_variant(
            project_id=project_id,
            user_id=user_id,
            evaluator_variant_id=evaluator_variant.id,
        )

    return True
