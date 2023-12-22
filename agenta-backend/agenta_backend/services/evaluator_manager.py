from typing import Any, Dict, Optional

from agenta_backend.services.db_manager import (
    fetch_evaluator_config,
    fetch_evaluators_configs,
    create_evaluator_config as db_manager_create_evaluator_config,
    update_evaluator_config,
    delete_evaluator_config,
    fetch_app_by_id
)


from agenta_backend.models.db_models import EvaluatorConfigDB


async def get_evaluators_configs(app_id: str):
    """Get evaluators configs by app_id.

    Args:
        app_id (str): The ID of the app.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """
    return await fetch_evaluators_configs(app_id)


async def get_evaluator_config(config_id: str):
    """Get evaluators configs by app_id.

    Args:
        config_id (str): The ID of the evaluator configuration.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """
    return await fetch_evaluator_config(config_id)


async def create_evaluator_config(
    app_id: str,
    name: str,
    evaluator_key: str,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfigDB:
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
    app = await fetch_app_by_id(app_id)
    return await db_manager_create_evaluator_config(
        app=app,
        organization=app.organization,
        user=app.user,
        name=name,
        evaluator_key=evaluator_key,
        settings_values=settings_values
    )


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
    return await update_evaluator_config(evaluator_config_id, updates)


async def remove_evaluator_config(evaluator_config_id: str) -> bool:
    """
    Delete an evaluator configuration.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration to be deleted.

    Returns:
        bool: True if the deletion was successful, False otherwise.
    """
    return await delete_evaluator_config(evaluator_config_id)
