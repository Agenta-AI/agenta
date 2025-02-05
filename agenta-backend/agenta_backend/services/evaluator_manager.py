import os
import json
from typing import Any, Dict, Optional, List, Tuple

from fastapi.responses import JSONResponse

from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE

if isCloudEE():
    from agenta_backend.commons.models.db_models import (
        AppDB_ as AppDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
    )
else:
    from agenta_backend.models.db_models import AppDB, EvaluatorConfigDB
from agenta_backend.models.converters import evaluator_config_db_to_pydantic
from agenta_backend.resources.evaluators.evaluators import get_all_evaluators
from agenta_backend.models.api.evaluation_model import Evaluator, EvaluatorConfig


def get_evaluators() -> List[Evaluator]:
    """
    Fetches a list of evaluators from a JSON file.

    Returns:
        List[Evaluator]: A list of evaluator objects.
    """

    evaluators_as_dict = get_all_evaluators()
    return [Evaluator(**evaluator_dict) for evaluator_dict in evaluators_as_dict]


async def get_evaluators_configs(project_id: str) -> List[EvaluatorConfig]:
    """
    Get evaluators configs by app_id.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[EvaluatorConfig]: A list of evaluator configuration objects.
    """

    evaluator_configs_db = await db_manager.fetch_evaluators_configs(project_id)
    return [
        evaluator_config_db_to_pydantic(evaluator_config_db)
        for evaluator_config_db in evaluator_configs_db
    ]


async def get_evaluator_config(evaluator_config: EvaluatorConfig) -> EvaluatorConfig:
    """
    Get an evaluator configuration by its ID.

    Args:
        evaluator_config: The evaluator configuration object.

    Returns:
        EvaluatorConfig: The evaluator configuration object.
    """
    return evaluator_config_db_to_pydantic(evaluator_config)


async def create_evaluator_config(
    project_id: str,
    app_name: str,
    name: str,
    evaluator_key: str,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfig:
    """
    Create a new evaluator configuration for an app.

    Args:
        project_id (str): The ID of the project.
        app_name (str): The name of the app.
        name (str): The name of the evaluator config.
        evaluator_key (str): The key of the evaluator.
        settings_values (Optional[Dict[str, Any]]): Additional settings for the evaluator.

    Returns:
        EvaluatorConfigDB: The newly created evaluator configuration object.
    """

    evaluator_config = await db_manager.create_evaluator_config(
        project_id=project_id,
        app_name=app_name,
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


async def create_ready_to_use_evaluators(project_id: str):
    """
    Create configurations for all evaluators that are marked for direct use.
    This function retrieves all evaluators from the evaluator manager, filters
    out those marked for direct use, and creates configuration entries for them
    in the database using the database manager.
    Args:
        app_name (str): The name of the application.
        project_id (str): The ID of the project.
    Returns:
        Nothing. The function works by side effect, modifying the database.
    """

    direct_use_evaluators = [
        evaluator for evaluator in get_evaluators() if evaluator.direct_use
    ]

    for evaluator in direct_use_evaluators:
        settings_values = {
            setting_name: setting.get("default")
            for setting_name, setting in evaluator.settings_template.items()
            if setting.get("ground_truth_key") is True and setting.get("default", "")
        }

        for setting_name, default_value in settings_values.items():
            assert (
                default_value != ""
            ), f"Default value for ground truth key '{setting_name}' in Evaluator is empty"

        assert hasattr(evaluator, "name") and hasattr(
            evaluator, "key"
        ), f"'name' and 'key' does not exist in the evaluator: {evaluator}"
        await db_manager.create_evaluator_config(
            project_id=project_id,
            app_name=None,
            name=evaluator.name,
            evaluator_key=evaluator.key,
            settings_values=settings_values,
        )
