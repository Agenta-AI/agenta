import os
import json
from typing import List
import logging

from fastapi import HTTPException, APIRouter, Query
from fastapi.responses import JSONResponse

from agenta_backend.models.api.evaluation_model import (
    Evaluator,
    EvaluatorConfig,
    NewEvaluatorConfig,
    UpdateEvaluatorConfig,
)

from agenta_backend.services import (
    db_manager,
)

from agenta_backend.services import evaluator_manager

from agenta_backend.utils.common import check_access_to_app

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (  # noqa pylint: disable-all
        get_user_and_org_id,
    )
else:
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=List[Evaluator])
async def get_evaluators():
    """Fetches a list of evaluators from the hardcoded JSON file.

    Returns:
        List[Evaluator]: A list of evaluator objects.
    """

    file_path = "agenta_backend/resources/evaluators/evaluators.json"

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Evaluators file not found")

    try:
        with open(file_path, "r") as file:
            evaluators = json.load(file)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error reading evaluators file: {str(e)}"
        )

    return evaluators


@router.get("/configs/", response_model=List[EvaluatorConfig])
async def get_evaluator_configs(app_id: str = Query()):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    evaluators_configs = await evaluator_manager.get_evaluators_configs(app_id)
    return evaluators_configs


@router.get("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(evaluator_config_id: str):
    """Endpoint to fetch evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    evaluators_configs = await evaluator_manager.get_evaluator_config(
        evaluator_config_id
    )
    return evaluators_configs


@router.post("/configs/", response_model=EvaluatorConfig)
async def create_new_evaluator_config(
    payload: NewEvaluatorConfig,
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Args:
        app_id (str): The ID of the app.

    Returns:
        EvaluatorConfigDB: Evaluator configuration api model.
    """

    evaluator_config = await evaluator_manager.create_evaluator_config(
        app_id=payload.app_id,
        name=payload.name,
        evaluator_key=payload.evaluator_key,
        direct_use=payload.direct_use,
        settings_values=payload.settings_values,
    )
    return evaluator_config


@router.put("/configs/{evaluator_config_id}/", response_model=EvaluatorConfig)
async def get_evaluator_config(
    evaluator_config_id: str, payload: UpdateEvaluatorConfig
):
    """Endpoint to fetch evaluator configurations for a specific app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    evaluators_configs = await evaluator_manager.update_evaluator_config(
        evaluator_config_id=evaluator_config_id, updates=payload
    )
    return evaluators_configs


@router.delete("/configs/{evaluator_config_id}/", response_model=bool)
async def delete_evaluator_config(evaluator_config_id: str):
    """Endpoint to delete a specific evaluator configuration.

    Args:
        evaluator_config_id (str): The unique identifier of the evaluator configuration.

    Returns:
        bool: True if deletion was successful, False otherwise.
    """
    try:
        success = await evaluator_manager.delete_evaluator_config(evaluator_config_id)
        return success
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error deleting evaluator configuration: {str(e)}"
        )
