import re
import json
import asyncio
import litellm
import logging
import traceback
from typing import Any, Dict, Union

import httpx
import numpy as np
from openai import OpenAI, AsyncOpenAI
from numpy._core._multiarray_umath import array
from autoevals.ragas import Faithfulness, ContextRelevancy

from agenta_backend.services.security import sandbox
from agenta_backend.models.shared_models import Error, Result
from agenta_backend.models.api.evaluation_model import (
    EvaluatorInputInterface,
    EvaluatorOutputInterface,
    EvaluatorMappingInputInterface,
    EvaluatorMappingOutputInterface,
)
from agenta_backend.utils.traces import (
    remove_trace_prefix,
    process_distributed_trace_into_trace_tree,
    get_field_value_from_trace_tree,
)


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def validate_string_output(
    evaluator_key: str, output: Union[str, Dict[str, Any]]
) -> str:
    """Checks and validate the output to be of type string.

    Args:
        evaluator_key (str): the key of the evaluator
        output (Union[str, Dict[str, Any]]): The LLM response. It can be:
            - A string.
            - A dictionary with the string under the "content" key.
            - A dictionary with the string under the "data" key.
            - A dictionary with the string under the "content" key, nested inside the "data" key.

    Raises:
        Exception: requires output to be a string

    Returns:
        str: output
    """

    if isinstance(output, dict):
        # Case 1: Check if "content" exists at the top level
        if "content" in output and isinstance(output["content"], str):
            final_output = output["content"]
        # Case 2: Check if "data" exists at the top level and is a string
        elif "data" in output and isinstance(output["data"], str):
            final_output = output["data"]
        # Case 3: Check if "data" exists and contains a nested "content" key with a string
        elif (
            "data" in output
            and isinstance(output["data"], dict)
            and "content" in output["data"]
            and isinstance(output["data"]["content"], str)
        ):
            final_output = output["data"]["content"]
        else:
            # If none of the cases match, raise an error
            raise ValueError(
                f"Evaluator {evaluator_key} requires the output to be a string, but the dictionary structure is invalid."
            )
    else:
        # If output is not a dictionary, it must be a string
        final_output = output

    if not isinstance(final_output, str):
        raise Exception(
            f"Evaluator {evaluator_key} requires the output to be a string, but received {type(final_output).__name__} instead. "
        )
    return final_output


async def map(
    mapping_input: EvaluatorMappingInputInterface,
) -> EvaluatorMappingOutputInterface:
    """
    Maps the evaluator inputs based on the provided mapping and data tree.

    Returns:
        EvaluatorMappingOutputInterface: A dictionary containing the mapped evaluator inputs.
    """

    mapping_outputs = {}
    mapping_inputs = mapping_input.inputs
    response_version = mapping_input.inputs.get("version")

    trace = {}
    if response_version == "3.0":
        trace = mapping_inputs.get("tree", {})
    elif response_version == "2.0":
        trace = mapping_inputs.get("trace", {})

    trace = process_distributed_trace_into_trace_tree(
        trace=trace,
        version=mapping_input.inputs.get("version"),
    )
    for to_key, from_key in mapping_input.mapping.items():
        mapping_outputs[to_key] = get_field_value_from_trace_tree(
            trace,
            from_key,
            version=mapping_input.inputs.get("version"),
        )
    return {"outputs": mapping_outputs}


def get_correct_answer(
    data_point: Dict[str, Any], settings_values: Dict[str, Any]
) -> Any:
    """
    Helper function to retrieve the correct answer from the data point based on the settings values.

    Args:
        data_point (Dict[str, Any]): The data point containing the correct answer.
        settings_values (Dict[str, Any]): The settings values containing the key for the correct answer.

    Returns:
        Any: The correct answer from the data point.

    Raises:
        ValueError: If the correct answer key is not provided or not found in the data point.
    """
    correct_answer_key = settings_values.get("correct_answer_key")
    if correct_answer_key is None:
        raise ValueError("No correct answer keys provided.")
    if isinstance(correct_answer_key, str) and correct_answer_key.startswith(
        "testcase."
    ):
        correct_answer_key = correct_answer_key[len("testcase.") :]
    if correct_answer_key not in data_point:
        raise ValueError(
            f"Correct answer column '{correct_answer_key}' not found in the test set."
        )
    return data_point[correct_answer_key]


async def auto_exact_match(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    """
    Evaluator function to determine if the output exactly matches the correct answer.

    Args:
        inputs (Dict[str, Any]): The inputs for the evaluation.
        output (str): The output generated by the model.
        data_point (Dict[str, Any]): The data point containing the correct answer.
        app_params (Dict[str, Any]): The application parameters.
        settings_values (Dict[str, Any]): The settings values containing the key for the correct answer.
        lm_providers_keys (Dict[str, Any]): The language model provider keys.

    Returns:
        Result: A Result object containing the evaluation result.
    """

    try:
        output = validate_string_output("exact_match", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {"ground_truth": correct_answer, "prediction": output}
        response = await exact_match(
            input=EvaluatorInputInterface(**{"inputs": inputs})
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except ValueError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=str(e),
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Exact Match evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def exact_match(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    prediction = input.inputs.get("prediction", "")
    ground_truth = input.inputs.get("ground_truth", "")
    success = True if prediction == ground_truth else False
    return {"outputs": {"success": success}}


async def auto_regex_test(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("regex_test", output)
        inputs = {"ground_truth": data_point, "prediction": output}
        response = await regex_test(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        return Result(type="bool", value=response["outputs"]["success"])
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Regex evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def regex_test(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    pattern = re.compile(input.settings["regex_pattern"], re.IGNORECASE)
    result = (
        bool(pattern.search(input.inputs["prediction"]))
        == input.settings["regex_should_match"]
    )
    return {"outputs": {"success": result}}


async def auto_field_match_test(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("field_match_test", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {"ground_truth": correct_answer, "prediction": output}
        response = await field_match_test(
            input=EvaluatorInputInterface(**{"inputs": inputs})
        )
        return Result(type="bool", value=response["outputs"]["success"])
    except ValueError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=str(e),
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        logging.debug("Field Match Test Failed because of Error: %s", str(e))
        return Result(type="bool", value=False)


async def field_match_test(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    prediction_json = json.loads(input.inputs["prediction"])
    result = prediction_json == input.inputs["ground_truth"]
    return {"outputs": {"success": result}}


async def auto_webhook_test(
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("webhook_test", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {"prediction": output, "ground_truth": correct_answer}
        response = await webhook_test(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        return Result(type="number", value=response["outputs"]["score"])
    except httpx.HTTPError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=f"[webhook evaluation] HTTP - {repr(e)}",
                stacktrace=traceback.format_exc(),
            ),
        )
    except json.JSONDecodeError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=f"[webhook evaluation] JSON - {repr(e)}",
                stacktrace=traceback.format_exc(),
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message=f"[webhook evaluation] Exception - {repr(e)} ",
                stacktrace=traceback.format_exc(),
            ),
        )


async def webhook_test(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    with httpx.Client() as client:
        payload = {
            "correct_answer": input.inputs["ground_truth"],
            "output": input.inputs["prediction"],
            "inputs": input.inputs,
        }
        response = client.post(url=input.settings["webhook_url"], json=payload)
        response.raise_for_status()
        response_data = response.json()
        score = response_data.get("score", None)
        return {"outputs": {"score": score}}


async def auto_custom_code_run(
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("custom_code_run", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {
            "app_config": app_params,
            "prediction": output,
            "ground_truth": correct_answer,
        }
        response = await custom_code_run(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        return Result(type="number", value=response["outputs"]["score"])
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Custom Code Evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def custom_code_run(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    result = sandbox.execute_code_safely(
        app_params=input.inputs["app_config"],
        inputs=input.inputs,
        output=input.inputs["prediction"],
        correct_answer=input.inputs["ground_truth"],
        code=input.settings["code"],
        datapoint=input.inputs["ground_truth"],
    )
    return {"outputs": {"score": result}}


async def auto_ai_critique(
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    """
    Evaluate a response using an AI critique based on provided inputs, output, correct answer, app parameters, and settings.

    Args:
        inputs (Dict[str, Any]): Input parameters for the LLM app variant.
        output (str): The output of the LLM app variant.
        correct_answer_key (str): The key name of the correct answer  in the datapoint.
        app_params (Dict[str, Any]): Application parameters.
        settings_values (Dict[str, Any]): Settings for the evaluation.
        lm_providers_keys (Dict[str, Any]): Keys for language model providers.

    Returns:
        Result: Evaluation result.
    """
    try:
        output = validate_string_output("ai_critique", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {
            "prompt_user": app_params.get("prompt_user", ""),
            "prediction": output,
            "ground_truth": correct_answer,
            **data_point,
        }
        settings = {
            "prompt_template": settings_values.get("prompt_template", ""),
            "version": settings_values.get("version", "1"),
            "model": settings_values.get("model", ""),
        }
        response = await ai_critique(
            input=EvaluatorInputInterface(
                **{
                    "inputs": inputs,
                    "settings": settings,
                    "credentials": lm_providers_keys,
                }
            )
        )
        return Result(type="text", value=str(response["outputs"]["score"]))
    except Exception as e:  # pylint: disable=broad-except∆`§
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto AI Critique",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def ai_critique(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    anthropic_api_key = input.credentials.get("ANTHROPIC_API_KEY", None)
    litellm.openai_key = openai_api_key
    litellm.anthropic_api_key = anthropic_api_key
    if not openai_api_key:
        raise Exception(
            "No OpenAI key was found. AI Critique evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again."
        )
    if (
        input.settings.get("version", "1") == "2"
    ) and (  # this check is used when running in the background (celery)
        type(input.settings.get("prompt_template", "")) is not str
    ):  # this check is used when running in the frontend (since in that case we'll alway have version 2)
        try:
            prompt_template = input.settings.get("prompt_template", "")

            formatted_prompt_template = []
            for message in prompt_template:
                formatted_prompt_template.append(
                    {
                        "role": message["role"],
                        "content": message["content"].format(**input.inputs),
                    }
                )
            app_output = input.inputs.get("prediction")
            if app_output is None:
                raise ValueError("Prediction is required in inputs")
            response = await litellm.acompletion(
                model=input.settings.get("model", "gpt-3.5-turbo"),
                messages=formatted_prompt_template,
                temperature=0.01,
            )
            evaluation_output = response.choices[0].message.content.strip()
        except Exception as e:
            raise RuntimeError(f"Evaluation failed: {str(e)}")
    else:
        chain_run_args = {
            "llm_app_prompt_template": input.inputs.get("prompt_template", ""),
            "variant_output": input.inputs["prediction"],
            "correct_answer": input.inputs["ground_truth"],
        }
        for key, value in input.inputs.items():
            chain_run_args[key] = value

        prompt_template = input.settings.get("prompt_template", "")
        messages = [
            {"role": "system", "content": prompt_template},
            {"role": "user", "content": str(chain_run_args)},
        ]
        client = AsyncOpenAI(api_key=openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo", messages=messages, temperature=0.8
        )
        evaluation_output = response.choices[0].message.content.strip()
    return {"outputs": {"score": evaluation_output}}


async def auto_starts_with(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("starts_with", output)
        inputs = {"prediction": output}
        response = await starts_with(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        return Result(type="text", value=response["outputs"]["success"])
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Starts With evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def starts_with(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    prefix = input.settings.get("prefix", "")
    case_sensitive = input.settings.get("case_sensitive", True)

    output = str(input.inputs["prediction"])
    if not case_sensitive:
        output = output.lower()
        prefix = prefix.lower()

    result = output.startswith(prefix)
    return {"outputs": {"success": result}}


async def auto_ends_with(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("ends_with", output)
        inputs = {"prediction": output}
        response = await ends_with(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Ends With evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def ends_with(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    suffix = input.settings.get("suffix", "")
    case_sensitive = input.settings.get("case_sensitive", True)

    output = str(input.inputs["prediction"])
    if not case_sensitive:
        output = output.lower()
        suffix = suffix.lower()

    result = output.endswith(suffix)
    return {"outputs": {"success": result}}


async def auto_contains(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("contains", output)
        inputs = {"prediction": output}
        response = await contains(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def contains(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    substring = input.settings.get("substring", "")
    case_sensitive = input.settings.get("case_sensitive", True)

    output = str(input.inputs["prediction"])
    if not case_sensitive:
        output = output.lower()
        substring = substring.lower()

    result = substring in output
    return {"outputs": {"success": result}}


async def auto_contains_any(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("contains_any", output)
        inputs = {"prediction": output}
        response = await contains_any(
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains Any evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def contains_any(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    substrings_str = input.settings.get("substrings", "")
    substrings = [substring.strip() for substring in substrings_str.split(",")]
    case_sensitive = input.settings.get("case_sensitive", True)

    output = str(input.inputs["prediction"])
    if not case_sensitive:
        output = output.lower()
        substrings = [substring.lower() for substring in substrings]

    return {
        "outputs": {"success": any(substring in output for substring in substrings)}
    }


async def auto_contains_all(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("contains_all", output)
        response = await contains_all(
            input=EvaluatorInputInterface(
                **{"inputs": {"prediction": output}, "settings": settings_values}
            )
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains All evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def contains_all(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    substrings_str = input.settings.get("substrings", "")
    substrings = [substring.strip() for substring in substrings_str.split(",")]
    case_sensitive = input.settings.get("case_sensitive", True)

    output = str(input.inputs["prediction"])
    if not case_sensitive:
        output = output.lower()
        substrings = [substring.lower() for substring in substrings]

    result = all(substring in output for substring in substrings)
    return {"outputs": {"success": result}}


async def auto_contains_json(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],  # pylint: disable=unused-argument
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        # parsing llm app output format if v2
        output = output.get("data", "") if isinstance(output, dict) else output
        if isinstance(output, dict):
            output = json.dumps(
                output
            )  # contains_json expects inputs.prediction to be a string
        elif not isinstance(output, (str, dict)):
            raise Exception(
                f"Evaluator contains_json requires the app output to be either a JSON string or object, but received {type(output).__name__} instead."
            )
        response = await contains_json(
            input=EvaluatorInputInterface(**{"inputs": {"prediction": output}})
        )
        return Result(type="bool", value=response["outputs"]["success"])
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains JSON evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def contains_json(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    try:
        start_index = str(input.inputs["prediction"]).index("{")
        end_index = str(input.inputs["prediction"]).rindex("}") + 1
        potential_json = str(input.inputs["prediction"])[start_index:end_index]
        json.loads(potential_json)
        contains_json = True
    except (ValueError, json.JSONDecodeError) as e:
        contains_json = False

    return {"outputs": {"success": contains_json}}


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


async def auto_json_diff(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Any,
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],  # pylint: disable=unused-argument
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        # 2. extract ground truth from data point
        correct_answer = get_correct_answer(data_point, settings_values)

        response = await json_diff(
            input=EvaluatorInputInterface(
                **{
                    "inputs": {"prediction": output, "ground_truth": correct_answer},
                    "settings": settings_values,
                }
            )
        )
        return Result(type="number", value=response["outputs"]["score"])
    except json.JSONDecodeError:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Expected answer is not a valid JSON",
                stacktrace=traceback.format_exc(),
            ),
        )
    except (ValueError, Exception):
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during JSON diff evaluation",
                stacktrace=traceback.format_exc(),
            ),
        )


async def json_diff(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    ground_truth = input.inputs["ground_truth"]
    if isinstance(ground_truth, str):
        ground_truth = json.loads(ground_truth)  # if this fails we will return an error

    # 1. extract llm app output if app output format is v2+
    app_output = input.inputs["prediction"]
    assert isinstance(
        app_output, (str, dict)
    ), "App output is expected to be a string or a JSON object"
    app_output = (
        app_output.get("data", "") if isinstance(app_output, dict) else app_output
    )
    if isinstance(app_output, str):
        try:
            app_output = json.loads(app_output)
        except json.JSONDecodeError:
            app_output = (
                {}
            )  # we will return 0 score for json diff in case we cannot parse the output as json

    score = compare_jsons(
        ground_truth=ground_truth,
        app_output=app_output,
        settings_values=input.settings,
    )
    return {"outputs": {"score": score}}


async def measure_rag_consistency(
    input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    if not openai_api_key:
        raise Exception(
            "No OpenAI key was found. RAG evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again."
        )

    # Initialize RAG evaluator to calculate faithfulness score
    faithfulness = Faithfulness(api_key=openai_api_key)
    eval_score = await faithfulness._run_eval_async(
        output=input.inputs["answer_key"],
        input=input.inputs["question_key"],
        context=input.inputs["contexts_key"],
    )
    return {"outputs": {"score": eval_score.score}}


async def rag_faithfulness(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],  # pylint: disable=unused-argument
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        if isinstance(output, str):
            logging.error("'output' is most likely not BaseResponse.")
            raise NotImplementedError(
                "Please update the SDK to the latest version, which supports RAG evaluators."
            )

        # Get required keys for rag evaluator
        mapping_keys = remove_trace_prefix(settings_values=settings_values)
        question_key: Union[str, None] = mapping_keys.get("question_key", None)
        answer_key: Union[str, None] = mapping_keys.get("answer_key", None)
        contexts_key: Union[str, None] = mapping_keys.get("contexts_key", None)

        if None in [question_key, answer_key, contexts_key]:
            logging.error(
                f"Missing evaluator settings ? {['question', question_key is None, 'answer', answer_key is None, 'context', contexts_key is None]}"
            )
            raise ValueError(
                "Missing required configuration keys: 'question_key', 'answer_key', or 'contexts_key'. Please check your evaluator settings and try again."
            )

        # Turn distributed trace into trace tree
        trace = {}
        version = output.get("version")
        if version == "3.0":
            trace = output.get("tree", {})
        elif version == "2.0":
            trace = output.get("trace", {})

        trace = process_distributed_trace_into_trace_tree(trace, version)

        # Get value of required keys for rag evaluator
        question_val: Any = get_field_value_from_trace_tree(
            trace, question_key, version
        )
        answer_val: Any = get_field_value_from_trace_tree(trace, answer_key, version)
        contexts_val: Any = get_field_value_from_trace_tree(
            trace, contexts_key, version
        )

        if None in [question_val, answer_val, contexts_val]:
            logging.error(
                f"Missing trace field ? {['question', question_val is None, 'answer', answer_val is None, 'context', contexts_val is None]}"
            )

            message = ""
            if question_val is None:
                message += (
                    f"'question_key' is set to {question_key} which can't be found. "
                )
            if answer_val is None:
                message += f"'answer_key' is set to {answer_key} which can't be found. "
            if contexts_val is None:
                message += (
                    f"'contexts_key' is set to {contexts_key} which can't be found. "
                )
            message += "Please check your evaluator settings and try again."

            raise ValueError(message)

        measurement = await measure_rag_consistency(
            input=EvaluatorInputInterface(
                **{
                    "inputs": {
                        "question_key": question_val,
                        "contexts_key": contexts_val,
                        "answer_key": answer_val,
                    },
                    "settings": settings_values,
                    "credentials": lm_providers_keys,
                }
            )
        )
        return Result(type="number", value=measurement["outputs"]["score"])

    except Exception:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during RAG Faithfulness evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def measure_context_coherence(
    input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    if not openai_api_key:
        raise Exception(
            "No OpenAI key was found. RAG evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again."
        )

    # Initialize RAG evaluator to calculate context relevancy score
    context_rel = ContextRelevancy(api_key=openai_api_key)
    eval_score = await context_rel._run_eval_async(
        output=input.inputs["answer_key"],
        input=input.inputs["question_key"],
        context=input.inputs["contexts_key"],
    )
    return {"outputs": {"score": eval_score.score}}


async def rag_context_relevancy(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],  # pylint: disable=unused-argument
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],  # pylint: disable=unused-argument
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        if isinstance(output, str):
            logging.error("'output' is most likely not BaseResponse.")
            raise NotImplementedError(
                "Please update the SDK to the latest version, which supports RAG evaluators."
            )

        # Get required keys for rag evaluator
        mapping_keys = remove_trace_prefix(settings_values=settings_values)
        question_key: Union[str, None] = mapping_keys.get("question_key", None)
        answer_key: Union[str, None] = mapping_keys.get("answer_key", None)
        contexts_key: Union[str, None] = mapping_keys.get("contexts_key", None)

        if None in [question_key, answer_key, contexts_key]:
            logging.error(
                f"Missing evaluator settings ? {['question', question_key is None, 'answer', answer_key is None, 'context', contexts_key is None]}"
            )
            raise ValueError(
                "Missing required configuration keys: 'question_key', 'answer_key', or 'contexts_key'. Please check your evaluator settings and try again."
            )

        # Turn distributed trace into trace tree
        trace = {}
        version = output.get("version")
        if version == "3.0":
            trace = output.get("tree", {})
        elif version == "2.0":
            trace = output.get("trace", {})

        trace = process_distributed_trace_into_trace_tree(trace, version)

        # Get value of required keys for rag evaluator
        question_val: Any = get_field_value_from_trace_tree(
            trace, question_key, version
        )
        answer_val: Any = get_field_value_from_trace_tree(trace, answer_key, version)
        contexts_val: Any = get_field_value_from_trace_tree(
            trace, contexts_key, version
        )

        if None in [question_val, answer_val, contexts_val]:
            logging.error(
                f"Missing trace field ? {['question', question_val is None, 'answer', answer_val is None, 'context', contexts_val is None]}"
            )

            message = ""
            if question_val is None:
                message += (
                    f"'question_key' is set to {question_key} which can't be found. "
                )
            if answer_val is None:
                message += f"'answer_key' is set to {answer_key} which can't be found. "
            if contexts_val is None:
                message += (
                    f"'contexts_key' is set to {contexts_key} which can't be found. "
                )
            message += "Please check your evaluator settings and try again."

            raise ValueError(message)

        measurement = await measure_context_coherence(
            input=EvaluatorInputInterface(
                **{
                    "inputs": {
                        "question_key": question_val,
                        "contexts_key": contexts_val,
                        "answer_key": answer_val,
                    },
                    "settings": settings_values,
                    "credentials": lm_providers_keys,
                }
            )
        )
        return Result(type="number", value=measurement["outputs"]["score"])

    except Exception:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during RAG Context Relevancy evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def levenshtein_distance(
    input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    prediction = input.inputs["prediction"]
    ground_truth = input.inputs["ground_truth"]

    if len(ground_truth) == 0:
        return len(prediction)

    previous_row = range(len(ground_truth) + 1)
    for i, c1 in enumerate(prediction):
        current_row = [i + 1]
        for j, c2 in enumerate(ground_truth):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    distance = previous_row[-1]
    if "threshold" in input.settings:
        threshold = input.settings["threshold"]
        is_within_threshold = distance <= threshold
        return {"outputs": {"success": is_within_threshold}}

    return {"outputs": {"score": distance}}


async def auto_levenshtein_distance(
    inputs: Dict[str, Any],  # pylint: disable=unused-argument
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],  # pylint: disable=unused-argument
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],  # pylint: disable=unused-argument
) -> Result:
    try:
        output = validate_string_output("levenshtein_distance", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        response = await levenshtein_distance(
            input=EvaluatorInputInterface(
                **{
                    "inputs": {"prediction": output, "ground_truth": correct_answer},
                    "settings": settings_values,
                }
            )
        )
        if "success" in response["outputs"]:
            return Result(type="number", value=response["outputs"]["success"])
        return Result(type="number", value=response["outputs"]["score"])

    except ValueError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=str(e),
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Levenshtein threshold evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def auto_similarity_match(
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        output = validate_string_output("similarity_match", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        response = await similarity_match(
            input=EvaluatorInputInterface(
                **{
                    "inputs": {"prediction": output, "ground_truth": correct_answer},
                    "settings": settings_values,
                }
            )
        )
        result = Result(type="bool", value=response["outputs"]["success"])
        return result
    except ValueError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=str(e),
            ),
        )
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Similarity Match evaluation",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def similarity_match(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    set1 = set(input.inputs["prediction"].split())
    set2 = set(input.inputs["ground_truth"].split())
    intersect = set1.intersection(set2)
    union = set1.union(set2)

    similarity = len(intersect) / len(union)
    is_similar = True if similarity > input.settings["similarity_threshold"] else False
    return {"outputs": {"success": is_similar}}


async def semantic_similarity(
    input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    """Calculate the semantic similarity score of the LLM app using OpenAI's Embeddings API.

    Args:
        input (EvaluatorInputInterface): the evaluator input

    Returns:
        float: the semantic similarity score
    """

    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    if not openai_api_key:
        raise Exception(
            "No OpenAI key was found. Semantic evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again."
        )

    openai = AsyncOpenAI(api_key=openai_api_key)

    async def encode(text: str):
        response = await openai.embeddings.create(
            model="text-embedding-3-small", input=text
        )
        return np.array(response.data[0].embedding)

    def cosine_similarity(output_vector: array, correct_answer_vector: array) -> float:
        return np.dot(output_vector, correct_answer_vector)

    output_vector = await encode(input.inputs["prediction"])
    correct_answer_vector = await encode(input.inputs["ground_truth"])
    similarity_score = cosine_similarity(output_vector, correct_answer_vector)
    return {"outputs": {"score": similarity_score}}


async def auto_semantic_similarity(
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        output = validate_string_output("semantic_similarity", output)
        correct_answer = get_correct_answer(data_point, settings_values)
        inputs = {"prediction": output, "ground_truth": correct_answer}
        response = await semantic_similarity(
            input=EvaluatorInputInterface(
                **{
                    "inputs": inputs,
                    "credentials": lm_providers_keys,
                }
            )
        )
        return Result(type="number", value=response["outputs"]["score"])
    except Exception:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Semantic Similarity",
                stacktrace=str(traceback.format_exc()),
            ),
        )


EVALUATOR_FUNCTIONS = {
    "auto_exact_match": auto_exact_match,
    "auto_regex_test": auto_regex_test,
    "field_match_test": auto_field_match_test,
    "auto_webhook_test": auto_webhook_test,
    "auto_custom_code_run": auto_custom_code_run,
    "auto_ai_critique": auto_ai_critique,
    "auto_starts_with": auto_starts_with,
    "auto_ends_with": auto_ends_with,
    "auto_contains": auto_contains,
    "auto_contains_any": auto_contains_any,
    "auto_contains_all": auto_contains_all,
    "auto_contains_json": auto_contains_json,
    "auto_json_diff": auto_json_diff,
    "auto_semantic_similarity": auto_semantic_similarity,
    "auto_levenshtein_distance": auto_levenshtein_distance,
    "auto_similarity_match": auto_similarity_match,
    "rag_faithfulness": rag_faithfulness,
    "rag_context_relevancy": rag_context_relevancy,
}

RUN_EVALUATOR_FUNCTIONS = {
    "auto_exact_match": exact_match,
    "auto_regex_test": regex_test,
    "field_match_test": field_match_test,
    "auto_webhook_test": webhook_test,
    "auto_custom_code_run": custom_code_run,
    "auto_ai_critique": ai_critique,
    "auto_starts_with": starts_with,
    "auto_ends_with": ends_with,
    "auto_contains": contains,
    "auto_contains_any": contains_any,
    "auto_contains_all": contains_all,
    "auto_contains_json": contains_json,
    "auto_json_diff": json_diff,
    "auto_levenshtein_distance": levenshtein_distance,
    "auto_similarity_match": similarity_match,
    "auto_semantic_similarity": semantic_similarity,
    "rag_faithfulness": measure_rag_consistency,
    "rag_context_relevancy": measure_context_coherence,
}


async def evaluate(
    evaluator_key: str,
    inputs: Dict[str, Any],
    output: Union[str, Dict[str, Any]],
    data_point: Dict[str, Any],
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    evaluation_function = EVALUATOR_FUNCTIONS.get(evaluator_key, None)
    if not evaluation_function:
        return Result(
            type="error",
            value=None,
            error=Error(
                message=f"Evaluation method '{evaluator_key}' not found.",
            ),
        )
    try:
        return await evaluation_function(
            inputs,
            output,
            data_point,
            app_params,
            settings_values,
            lm_providers_keys,
        )
    except Exception as exc:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error occurred while running {evaluator_key} evaluation. ",
                stacktrace=str(exc),
            ),
        )


async def run(
    evaluator_key: str, evaluator_input: EvaluatorInputInterface
) -> EvaluatorOutputInterface:
    evaluator_function = RUN_EVALUATOR_FUNCTIONS.get(evaluator_key, None)
    if not evaluator_function:
        raise NotImplementedError(f"Evaluator {evaluator_key} not found")

    output = await evaluator_function(evaluator_input)
    return output
