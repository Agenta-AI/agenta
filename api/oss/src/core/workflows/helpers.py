from typing import Union, Dict, Any


def flatten_json(json_obj: Union[list, dict]) -> Dict[str, Any]:
    """
    This function takes a (nested) JSON object and flattens it into a single-level dictionary where each key represents the path to the value in the original JSON structure. This is done recursively, ensuring that the full hierarchical context is preserved in the keys.

    Args:
        json_obj (Union[list, dict]): The (nested) JSON object to flatten. It can be either a dictionary or a list.

    Returns:
        Dict[str, Any]: The flattened JSON object as a dictionary, with keys representing the paths to the values in the original structure.
    """

    output = {}

    def flatten(obj: Union[list, dict], path: str = "") -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                new_key = f"{path}.{key}" if path else key
                if isinstance(value, (dict, list)):
                    flatten(value, new_key)
                else:
                    output[new_key] = value

        elif isinstance(obj, list):
            for index, value in enumerate(obj):
                new_key = f"{path}.{index}" if path else str(index)
                if isinstance(value, (dict, list)):
                    flatten(value, new_key)
                else:
                    output[new_key] = value

    flatten(json_obj)
    return output


def compare_jsons(
    ground_truth: Union[list, dict],
    app_output: Union[list, dict],
    settings_values: dict,
):
    """
    This function takes two JSON objects (ground truth and application output), flattens them using the `flatten_json` function, and then compares the fields.

    Args:
        ground_truth (list | dict): The ground truth
        app_output (list | dict): The application output
        settings_values: dict: The advanced configuration of the evaluator

    Returns:
        the average score between both JSON objects
    """

    def normalize_keys(d: Dict[str, Any], case_insensitive: bool) -> Dict[str, Any]:
        if not case_insensitive:
            return d
        return {k.lower(): v for k, v in d.items()}

    def diff(ground_truth: Any, app_output: Any, compare_schema_only: bool) -> float:
        gt_key, gt_value = next(iter(ground_truth.items()))
        ao_key, ao_value = next(iter(app_output.items()))

        if compare_schema_only:
            return (
                1.0 if (gt_key == ao_key and type(gt_value) == type(ao_value)) else 0.0
            )
        return 1.0 if (gt_key == ao_key and gt_value == ao_value) else 0.0

    flattened_ground_truth = flatten_json(ground_truth)
    flattened_app_output = flatten_json(app_output)

    keys = flattened_ground_truth.keys()
    if settings_values.get("predict_keys", False):
        keys = set(keys).union(flattened_app_output.keys())

    cumulated_score = 0.0
    no_of_keys = len(keys)

    compare_schema_only = settings_values.get("compare_schema_only", False)
    case_insensitive_keys = settings_values.get("case_insensitive_keys", False)
    flattened_ground_truth = normalize_keys(
        flattened_ground_truth, case_insensitive_keys
    )
    flattened_app_output = normalize_keys(flattened_app_output, case_insensitive_keys)

    for key in keys:
        ground_truth_value = flattened_ground_truth.get(key, None)
        llm_app_output_value = flattened_app_output.get(key, None)

        key_score = 0.0
        if ground_truth_value is not None and llm_app_output_value is not None:
            key_score = diff(
                {key: ground_truth_value},
                {key: llm_app_output_value},
                compare_schema_only,
            )

        cumulated_score += key_score
    try:
        average_score = cumulated_score / no_of_keys
        return average_score
    except ZeroDivisionError:
        return 0.0
