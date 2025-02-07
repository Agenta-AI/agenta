import json
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Tuple

from agenta_backend.services import db_manager
from agenta_backend.models.api.evaluation_model import LMProvidersEnum
from agenta_backend.resources.evaluators.evaluators import get_all_evaluators


def format_inputs(list_of_dictionaries: List[Dict[str, Any]]) -> Dict:
    """
    Formats a list of inputs dictionaries into a dictionary.

    Args:
      list_of_dictionaries: A list of inputs as dictionaries.

    Returns:
      A dictionary.
    """

    formatted_dictionary = {}
    for dictionary in list_of_dictionaries:
        formatted_dictionary[dictionary["input_name"]] = dictionary["input_value"]
    return formatted_dictionary


def format_outputs(list_of_dictionaries: List[Dict[str, Any]]) -> Dict:
    """
    Formats a list of outputs dictionaries into a dictionary.

    Args:
      list_of_dictionaries: A list of outputs as dictionaries.

    Returns:
      A dictionary.
    """

    formatted_dictionary = {}
    for dictionary in list_of_dictionaries:
        formatted_dictionary[dictionary["variant_id"]] = dictionary["variant_output"]
    return formatted_dictionary


def include_dynamic_values(json_data: Dict, inputs: Dict[str, Any]) -> Dict:
    """
    Includes the dynamic values in the JSON before it gets executed.

    Args:
      json_data: The JSON data.
      inputs: The dynamic values.

    Returns:
      The modified JSON data.
    """

    # Get the inputs dictionary.
    inputs_dictionary = json.loads(inputs)

    # Replace the `{inputs}` placeholder in the JSON data with the inputs dictionary.
    for key, value in inputs_dictionary.items():
        json_data = json_data.replace(f"{key}", value)

    return json_data


def convert_to_utc_datetime(dt: Union[datetime, str, None]) -> datetime:
    """
    Converts a datetime object, a datetime string, or None into a UTC timezone-aware datetime object.

    Args:
        dt (Union[datetime, str, None]): The input datetime, which can be a datetime object, a string, or None.

    Returns:
        datetime: A UTC timezone-aware datetime object.
    """
    if dt is None:
        return datetime.now(timezone.utc)
    if isinstance(dt, str):
        return datetime.fromisoformat(dt).astimezone(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def format_llm_provider_keys(
    llm_provider_keys: Dict[LMProvidersEnum, str]
) -> Dict[str, str]:
    """Formats a dictionary of LLM provider keys into a dictionary of strings.

    Args:
        llm_provider_keys (Dict[LMProvidersEnum, str]): LLM provider keys

    Returns:
        Dict[str, str]: formatted llm provided keys

    Example:
        Input: {<LMProvidersEnum.mistral: 'MISTRAL_API_KEY'>: '...', ...}
        Output:  {'MISTRAL_API_KEY': '...', ...}
    """

    llm_provider_keys = {key.value: value for key, value in llm_provider_keys.items()}
    return llm_provider_keys


async def ensure_required_llm_keys_exist(
    evaluator_configs: List[str], llm_provider_keys: Dict[str, str]
) -> Tuple[bool, None]:
    """
    Validates if necessary LLM API keys are present when required evaluators are used.

    Args:
        evaluator_configs (List[str]): List of evaluator configurations to check.
        llm_provider_keys (Dict[str, str]): Dictionary of LLM provider keys (e.g., {"OPENAI_API_KEY": "your-key"}).

    Returns:
        Tuple[bool, None]: Returns (True, None) if validation passes.

    Raises:
        ValueError: If an evaluator requiring LLM keys is configured but no LLM API key is provided.

    """

    evaluators_requiring_llm_keys = [
        evaluator["key"]
        for evaluator in get_all_evaluators()
        if evaluator.get("requires_llm_api_keys", False)
        or (
            evaluator.get("settings_template", {})
            .get("requires_llm_api_keys", {})
            .get("default", False)
        )
    ]
    evaluators_found = (
        await db_manager.check_if_evaluators_exist_in_list_of_evaluators_configs(
            evaluator_configs, evaluators_requiring_llm_keys
        )
    )

    if evaluators_found and "OPENAI_API_KEY" not in llm_provider_keys:
        raise ValueError(
            "OpenAI API key is required to run one or more of the specified evaluators."
        )

    return True, None


def find_key_occurrences(
    data: Dict[Any, Any], target_key: str, path=""
) -> List[Dict[str, Any]]:
    """
    Recursively finds all occurrences of a specific key in a nested dictionary.

    :param data: The dictionary to search.
    :param target_key: The key to find.
    :param path: The current path in the dictionary (for tracking locations).
    :return: A list of dictionaries containing 'path' and 'value' for each occurrence.
    """
    results = []

    if isinstance(data, dict):  # If it's a dictionary, traverse it
        for key, value in data.items():
            new_path = f"{path}.{key}" if path else key  # Update path
            if key == target_key:
                results.extend(value)  # Store match

            # Recursively search inside dictionaries and lists
            results.extend(find_key_occurrences(value, target_key, new_path))

    elif isinstance(data, list):  # If it's a list, iterate through elements
        for index, item in enumerate(data):
            new_path = f"{path}[{index}]"  # Track list index in path
            results.extend(find_key_occurrences(item, target_key, new_path))

    return results
