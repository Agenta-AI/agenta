import os
import json
from typing import Any, Dict, Optional, List, Tuple

from fastapi.responses import JSONResponse

from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE()

if isCloudEE():
    from agenta_backend.commons.models.db_models import (
        AppDB_ as AppDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
    )
else:
    from agenta_backend.models.db_models import AppDB, EvaluatorConfigDB
from agenta_backend.models.converters import evaluator_config_db_to_pydantic
from agenta_backend.models.api.evaluation_model import Evaluator, EvaluatorConfig


def get_evaluators() -> Optional[List[Evaluator]]:
    """
    Fetches a list of evaluators from a JSON file.

    Returns:
        Optional[List[Evaluator]]: A list of evaluator objects or None if an error occurs.
    """

    file_path = "agenta_backend/resources/evaluators/evaluators.json"

    if not os.path.exists(file_path):
        return None

    try:
        with open(file_path, "r") as file:
            evaluators = json.load(file)
        return evaluators
    except Exception:
        return None


async def get_evaluators_configs(app_id: str) -> List[EvaluatorConfig]:
    """
    Get evaluators configs by app_id.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfig]: A list of evaluator configuration objects.
    """
    evaluator_configs_db = await db_manager.fetch_evaluators_configs(app_id)
    return [
        evaluator_config_db_to_pydantic(evaluator_config_db)
        for evaluator_config_db in evaluator_configs_db
    ]


async def get_evaluator_config(evaluator_config_id: str) -> EvaluatorConfig:
    """
    Get an evaluator configuration by its ID.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration.

    Returns:
        EvaluatorConfig: The evaluator configuration object.
    """
    evaluator_config_db = await db_manager.fetch_evaluator_config(evaluator_config_id)
    return evaluator_config_db_to_pydantic(evaluator_config_db)


async def create_evaluator_config(
    app_id: str,
    name: str,
    evaluator_key: str,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfig:
    """
    Create a new evaluator configuration for an app.

    Args:
        app_id (str): The ID of the app.
        name (str): The name of the evaluator config.
        evaluator_key (str): The key of the evaluator.
        settings_values (Optional[Dict[str, Any]]): Additional settings for the evaluator.

    Returns:
        EvaluatorConfigDB: The newly created evaluator configuration object.
    """
    app = await db_manager.fetch_app_by_id(app_id)
    evaluator_config = await db_manager.create_evaluator_config(
        app=app,
        organization=app.organization
        if isCloudEE()
        else None,  # noqa,
        workspace=app.workspace if isCloudEE() else None,  # noqa,
        user=app.user,
        name=name,
        evaluator_key=evaluator_key,
        settings_values=settings_values,
    )
    return evaluator_config_db_to_pydantic(evaluator_config=evaluator_config)


async def update_evaluator_config(
    evaluator_config_id: str, updates: Dict[str, Any]
) -> EvaluatorConfigDB:
    """
    Edit an existing evaluator configuration.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration to be updated.
        updates (Dict[str, Any]): A dictionary containing the updates.

    Returns:
        EvaluatorConfigDB: The updated evaluator configuration object.
    """
    evaluator_config = await db_manager.update_evaluator_config(
        evaluator_config_id, updates
    )
    return evaluator_config_db_to_pydantic(evaluator_config=evaluator_config)


async def delete_evaluator_config(evaluator_config_id: str) -> bool:
    """
    Delete an evaluator configuration.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration to be deleted.

    Returns:
        bool: True if the deletion was successful, False otherwise.
    """
    return await db_manager.delete_evaluator_config(evaluator_config_id)


async def create_ready_to_use_evaluators(app: AppDB):
    """
    Create configurations for all evaluators that are marked for direct use.

    This function retrieves all evaluators from the evaluator manager, filters
    out those marked for direct use, and creates configuration entries for them
    in the database using the database manager.

    Parameters:
    - evaluator_manager: The manager object responsible for handling evaluators.
    - db_manager: The database manager object used for database operations.
    - app: The application context, containing details like organization and user.

    Returns:
    Nothing. The function works by side effect, modifying the database.
    """
    evaluators = get_evaluators()

    direct_use_evaluators = [
        evaluator for evaluator in evaluators if evaluator.get("direct_use")
    ]

    for evaluator in direct_use_evaluators:
        await db_manager.create_evaluator_config(
            app=app,
            organization=app.organization
            if isCloudEE()
            else None,  # noqa,
            workspace=app.workspace
            if isCloudEE()
            else None,  # noqa,
            user=app.user,
            name=evaluator["name"],
            evaluator_key=evaluator["key"],
            settings_values={},
        )


async def check_ai_critique_inputs(
    evaluators_configs: List[str], lm_providers_keys: Optional[Dict[str, Any]]
) -> Tuple[bool, Optional[JSONResponse]]:
    """
    Checks if AI critique exists in evaluators configs and validates lm_providers_keys.

    Args:
        evaluators_configs (List[str]): List of evaluator configurations.
        lm_providers_keys (Optional[Dict[str, Any]]): Language model provider keys.

    Returns:
        Tuple[bool, Optional[JSONResponse]]: Returns a tuple containing a boolean indicating success,
                                             and a JSONResponse in case of error.
    """
    if await db_manager.check_if_ai_critique_exists_in_list_of_evaluators_configs(
        evaluators_configs
    ):
        if not lm_providers_keys:
            return False, JSONResponse(
                {"detail": "Missing LM provider Key"},
                status_code=400,
            )
    return True, None
