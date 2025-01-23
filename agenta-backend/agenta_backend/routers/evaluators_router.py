import logging
import traceback

from typing import List, Optional
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


from agenta_backend.utils.common import APIRouter, isCloudEE
from agenta_backend.services import (
    evaluator_manager,
    db_manager,
    evaluators_service,
    app_manager,
)

from agenta_backend.models.api.evaluation_model import (
    Evaluator,
    EvaluatorConfig,
    NewEvaluatorConfig,
    UpdateEvaluatorConfig,
    EvaluatorInputInterface,
    EvaluatorOutputInterface,
    EvaluatorMappingInputInterface,
    EvaluatorMappingOutputInterface,
)

if isCloudEE():
    from agenta_backend.commons.models.shared_models import Permission
    from agenta_backend.commons.utils.permissions import check_action_access

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=List[Evaluator])
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

    result = await evaluators_service.run(
        evaluator_key=evaluator_key, evaluator_input=payload
    )
    return result


@router.get("/configs/", response_model=List[EvaluatorConfig])
async def get_evaluator_configs(
    app_id: str,
    request: Request,
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    app_db = await db_manager.fetch_app_by_id(app_id=app_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_db.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    evaluators_configs = await evaluator_manager.get_evaluators_configs(
        str(app_db.project_id)
    )
    return evaluators_configs


@router.get("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(
    evaluator_config_id: str,
    request: Request,
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    evaluator_config_db = await db_manager.fetch_evaluator_config(evaluator_config_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluator_config_db.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    evaluators_configs = await evaluator_manager.get_evaluator_config(
        evaluator_config_db
    )
    return evaluators_configs


@router.post("/configs/", response_model=EvaluatorConfig)
async def create_new_evaluator_config(
    payload: NewEvaluatorConfig,
    request: Request,
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        EvaluatorConfigDB: Evaluator configuration api model.
    """

    app_db = await db_manager.get_app_instance_by_id(app_id=payload.app_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_db.project_id),
            permission=Permission.CREATE_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    evaluator_config = await evaluator_manager.create_evaluator_config(
        project_id=str(app_db.project_id),
        app_name=app_db.app_name,
        name=payload.name,
        evaluator_key=payload.evaluator_key,
        settings_values=payload.settings_values,
    )
    return evaluator_config


@router.put("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def update_evaluator_config(
    evaluator_config_id: str,
    payload: UpdateEvaluatorConfig,
    request: Request,
):
    """Endpoint to update evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    evaluator_config = await db_manager.fetch_evaluator_config(
        evaluator_config_id=evaluator_config_id
    )
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluator_config.project_id),
            permission=Permission.EDIT_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    evaluators_configs = await evaluator_manager.update_evaluator_config(
        evaluator_config_id=evaluator_config_id, updates=payload.model_dump()
    )
    return evaluators_configs


@router.delete("/configs/{evaluator_config_id}/", response_model=bool)
async def delete_evaluator_config(
    evaluator_config_id: str,
    request: Request,
):
    """Endpoint to delete a specific evaluator configuration.

    Args:
        evaluator_config_id (str): The unique identifier of the evaluator configuration.

    Returns:
        bool: True if deletion was successful, False otherwise.
    """

    evaluator_config = await db_manager.fetch_evaluator_config(
        evaluator_config_id=evaluator_config_id
    )
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluator_config.project_id),
            permission=Permission.DELETE_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    success = await evaluator_manager.delete_evaluator_config(evaluator_config_id)
    return success
