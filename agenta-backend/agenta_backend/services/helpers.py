import json
from typing import List, Dict, Any

from agenta_backend.models.db_models import SpanDB


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


def convert_generation_span_inputs_variables(span_db: SpanDB) -> List[Dict[str, str]]:
    """
    Converts a list of span generation inputs variables \
      to a list of dictionaries with name and type information.

    Args:
        span_db: The span db document.

    Returns:
        A list of dictionaries, where each dictionary has the following keys:
            name: The name of the variable.
            type: The type of the variable (string, number, or boolean).
    """

    variables: List[Dict[str, str]] = []
    for variable in span_db.inputs:
        if isinstance(variable, str):
            variable_type = "string"
        elif isinstance(variable, (int, float)):
            variable_type = "number"
        elif isinstance(variable, bool):
            variable_type = "boolean"
        else:
            raise ValueError(f"Unsupported variable type: {type(variable)}")

        variables.append({"name": variable, "type": variable_type})
    return variables
