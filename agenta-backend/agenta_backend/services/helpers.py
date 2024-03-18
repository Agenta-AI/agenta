import json
from typing import List, Dict, Any, Tuple
from datetime import datetime, timedelta

from agenta_backend.models.db_models import SpanDB
from agenta_backend.models.api.observability_models import ObservabilityData


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


def range_of_dates_based_on_timerange(
    time_range: str, current_date: datetime
) -> Tuple[datetime, datetime]:
    if time_range == "24_hours":
        start_date = current_date - timedelta(days=1)
        end_date = current_date
    elif time_range == "7_days":
        start_date = current_date - timedelta(days=7)
        end_date = current_date
    elif time_range == "30_days":
        start_date = current_date - timedelta(days=30)
        end_date = current_date
    return start_date, end_date


def fill_missing_data(
    data: List[ObservabilityData],
    time_range: str,
) -> List[ObservabilityData]:
    current_date, end_date = range_of_dates_based_on_timerange(
        time_range, datetime.now()
    )
    result_map = {}
    for result in data:
        truncated_timestamp = (
            result.timestamp.replace(minute=0, second=0)
            if time_range == "24_hours"
            else result.timestamp.replace(hour=0, minute=0, second=0)
        )
        result_map[str(truncated_timestamp)] = result

    while current_date <= end_date:
        truncated_current_date = str(
            current_date.strftime("%Y-%m-%d %I:00:00")
            if time_range == "24_hours"
            else current_date.strftime("%Y-%m-%d 00:00:00")
        )
        if truncated_current_date not in result_map:
            result_map[truncated_current_date] = ObservabilityData(
                **{
                    "timestamp": truncated_current_date,
                    "success_count": 0,
                    "failure_count": 0,
                    "cost": 0,
                    "latency": 0,
                    "total_tokens": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                }
            )
        if time_range == "24_hours":
            current_date += timedelta(hours=1)
        else:
            current_date += timedelta(days=1)
    return list(result_map.values())
