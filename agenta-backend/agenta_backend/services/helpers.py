import json
from typing import List, Dict, Any


def print_app_variant(app_variant):
    print(f"App Variant ID: {app_variant.id}")
    print(f"App Variant Name: {app_variant.variant_name}")
    print(f"App Name: {app_variant.app_name}")
    print(f"Image ID: {app_variant.image_id}")
    print(f"Parameters: {app_variant.parameters}")
    print(f"Previous Variant Name: {app_variant.previous_variant_name}")
    print(f"Is Deleted: {app_variant.is_deleted}")
    print("------------------------")


def print_image(image):
    print(f"Image ID: {image.id}")
    print(f"Docker ID: {image.docker_id}")
    print(f"Tags: {image.tags}")
    print("------------------------")


def format_list_of_dictionaries(list_of_dictionaries: List[Dict[str, Any]]) -> Dict:
    """
    Formats a list of dictionaries into a dictionary using the input_name as the key,
    and the input_value as the value.

    Args:
      list_of_dictionaries: A list of dictionaries.

    Returns:
      A dictionary.
    """

    formatted_dictionary = {}
    for dictionary in list_of_dictionaries:
        formatted_dictionary[dictionary["input_name"]] = dictionary["input_value"]
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
