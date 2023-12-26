from typing import Any, Dict, Optional, List

from agenta_backend.services import db_manager


from agenta_backend.models.db_models import EvaluatorConfigDB
from agenta_backend.models.api.evaluation_model import EvaluatorConfig
from agenta_backend.models.converters import evaluator_config_db_to_pydantic

async def get_evaluators_configs(app_id: str) -> List[EvaluatorConfig]:
    """
    Get evaluators configs by app_id.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfig]: A list of evaluator configuration objects.
    """
    evaluator_configs_db = await db_manager.fetch_evaluators_configs(app_id)
    return [evaluator_config_db_to_pydantic(evaluator_config_db) for evaluator_config_db in evaluator_configs_db]


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
        organization=app.organization,
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
    return await db_manager.update_evaluator_config(evaluator_config_id, updates)


async def delete_evaluator_config(evaluator_config_id: str) -> bool:
    """
    Delete an evaluator configuration.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration to be deleted.

    Returns:
        bool: True if the deletion was successful, False otherwise.
    """
    return await db_manager.delete_evaluator_config(evaluator_config_id)
