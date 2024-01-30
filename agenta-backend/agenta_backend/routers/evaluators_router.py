import logging

from typing import List
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from agenta_backend.services import evaluator_manager
from agenta_backend.utils.common import APIRouter, isCloudEE

from agenta_backend.models.api.evaluation_model import (
    Evaluator,
    EvaluatorConfig,
    NewEvaluatorConfig,
    UpdateEvaluatorConfig,
)

if isCloudEE:
    from agenta_backend.commons.models.db_models import Permission
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

    try:
        evaluators = evaluator_manager.get_evaluators()

        if evaluators is None:
            raise HTTPException(
                status_code=500, detail="Error processing evaluators file"
            )

        if not evaluators:
            raise HTTPException(status_code=404, detail="No evaluators found")

        return evaluators
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/configs/", response_model=List[EvaluatorConfig])
async def get_evaluator_configs(app_id: str, request: Request):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    try:
        if isCloudEE:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=app_id,
                object_type="app",
                permission=Permission.VIEW_EVALUATION,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )
        
        evaluators_configs = await evaluator_manager.get_evaluators_configs(app_id)
        return evaluators_configs
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error fetching evaluator configurations: {str(e)}"
        )


@router.get("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(evaluator_config_id: str, request: Request):
    """Endpoint to fetch evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    try:
        if isCloudEE:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluator_config_id,
                object_type="evaluator_config",
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
            evaluator_config_id
        )
        return evaluators_configs
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error fetching evaluator configuration: {str(e)}"
        )


@router.post("/configs/", response_model=EvaluatorConfig)
async def create_new_evaluator_config(
    payload: NewEvaluatorConfig,
    request: Request
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        EvaluatorConfigDB: Evaluator configuration api model.
    """
    try:
        if isCloudEE:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=payload.app_id,
                object_type="app",
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
            app_id=payload.app_id,
            name=payload.name,
            evaluator_key=payload.evaluator_key,
            settings_values=payload.settings_values,
        )
        return evaluator_config
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error creating evaluator configuration: {str(e)}"
        )


@router.put("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def update_evaluator_config(
    evaluator_config_id: str, payload: UpdateEvaluatorConfig, request: Request
):
    """Endpoint to update evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    try:
        if isCloudEE:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluator_config_id,
                object_type="evaluator_config",
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
            evaluator_config_id=evaluator_config_id, updates=payload
        )
        return evaluators_configs
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error updating evaluator configuration: {str(e)}"
        )


@router.delete("/configs/{evaluator_config_id}/", response_model=bool)
async def delete_evaluator_config(evaluator_config_id: str, request: Request):
    """Endpoint to delete a specific evaluator configuration.

    Args:
        evaluator_config_id (str): The unique identifier of the evaluator configuration.

    Returns:
        bool: True if deletion was successful, False otherwise.
    """
    try:
        if isCloudEE:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluator_config_id,
                object_type="evaluator_config",
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
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error deleting evaluator configuration: {str(e)}"
        )
