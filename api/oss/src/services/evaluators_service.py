import re
import json
import traceback
from typing import Any, Dict, Union, List, Optional

import litellm
import httpx
import numpy as np
from openai import AsyncOpenAI
from fastapi import HTTPException
from numpy._core._multiarray_umath import array
from autoevals.ragas import Faithfulness, ContextRelevancy

from oss.src.utils.logging import get_module_logger
from oss.src.services.security import sandbox
from oss.src.models.shared_models import Error, Result
from oss.src.models.api.evaluation_model import (
    EvaluatorInputInterface,
    EvaluatorOutputInterface,
    EvaluatorMappingInputInterface,
    EvaluatorMappingOutputInterface,
)
from oss.src.utils.traces import (
    remove_trace_prefix,
    process_distributed_trace_into_trace_tree,
    get_field_value_from_trace_tree,
)

from agenta.sdk.managers.secrets import SecretsManager
from agenta.sdk.models.workflows import WorkflowServiceRequest, WorkflowServiceRequestData
from agenta.sdk.workflows.builtin import auto_custom_code_run as sdk_auto_custom_code_run


log = get_module_logger(__name__)


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


def detect_prompt_variables(
    prompt: Union[str, List[Dict[str, str]]],
) -> List[str]:
    """
    Detects variable placeholders in a prompt string or message-based prompt.
    Looks for patterns like {variable_name} or {{variable_name}}

    Args:
        prompt: Either a string or a list of message dictionaries with 'content' field

    Returns:
        List[str]: List of variable names found in the prompt
    """
    import re

    # Match both single and double curly brace variables
    pattern = r"\{+([a-zA-Z_][a-zA-Z0-9_.]*)\}+"
    # log.info(f"Variable detection using pattern: {pattern}")

    if isinstance(prompt, list):
        # For message-based prompts, search in all message contents
        variables = set()
        for i, message in enumerate(prompt):
            if isinstance(message, dict) and "content" in message:
                content = message["content"]
                matches = re.findall(pattern, content)
                variables.update(matches)
        result = list(variables)
        return result
    else:
        matches = re.findall(pattern, prompt)
        result = list(set(matches))
        return result


def validate_prompt_variables(
    prompt: Union[str, List[Dict[str, str]]],
    inputs: Dict[str, Any],
) -> None:
    """
    Validates that all variables in the prompt have corresponding values in inputs.

    Args:
        prompt (str): The prompt string containing potential variables
        inputs (Dict[str, Any]): The inputs dictionary that should contain variable values

    Raises:
        ValueError: If any variable in the prompt is missing from inputs
    """

    variables = detect_prompt_variables(prompt)
    missing_vars = [var for var in variables if var not in inputs]

    if missing_vars:
        raise ValueError(
            f"Prompt includes variables that are missing from inputs: {', '.join(missing_vars)}. "
            "Please provide values for these variables in your inputs."
        )


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
    data_point: Dict[str, Any],
    settings_values: Dict[str, Any],
    required: bool = True,
) -> Any:
    """
    Helper function to retrieve the correct answer from the data point based on the settings values.

    Args:
        data_point (Dict[str, Any]): The data point containing the correct answer.
        settings_values (Dict[str, Any]): The settings values containing the key for the correct answer.
        required (bool, optional): Whether to raise an error if the column is missing. Defaults to ``True``.

    Returns:
        Any: The correct answer from the data point.

    Raises:
        ValueError: If ``required`` is ``True`` and the correct answer column is missing in the data point.
    """
    correct_answer_key = settings_values.get("correct_answer_key")
    if correct_answer_key is None:
        if required:
            raise ValueError("No correct answer keys provided.")
        return None
    if isinstance(correct_answer_key, str) and correct_answer_key.startswith(
        "testcase."
    ):
        correct_answer_key = correct_answer_key[len("testcase.") :]
    if correct_answer_key not in data_point:
        if required:
            raise ValueError(
                f"Correct answer column '{correct_answer_key}' not found in the testset."
            )
        return None
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
    except Exception:  # pylint: disable=broad-except
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
            input=EvaluatorInputInterface(
                **{"inputs": inputs, "settings": settings_values}
            )
        )
        return Result(type="bool", value=response["outputs"]["success"])
    except Exception:
        return Result(
            type="bool",
            value=False,
            error=Error(
                message="Could not parse output as JSON",
                stacktrace=str(traceback.format_exc()),
            ),
        )


async def field_match_test(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    try:
        json_field = input.settings["json_field"]
    except KeyError:
        log.error("No json_field provided as part of the settings")
        raise ValueError("No json_field provided as part of the settings")

    try:
        prediction_json = json.loads(input.inputs["prediction"])
        result = prediction_json[json_field] == input.inputs["ground_truth"]
    except ValueError:
        result = False
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


async def sdk_custom_code_run(
    input: EvaluatorInputInterface,
) -> EvaluatorOutputInterface:
    inputs = input.inputs or {}
    settings = input.settings or {}

    code = settings.get("code")
    if code is None:
        raise ValueError("Missing evaluator setting: code")

    correct_answer_key = settings.get("correct_answer_key")
    if not correct_answer_key:
        correct_answer_key = "ground_truth" if "ground_truth" in inputs else "correct_answer"

    threshold = settings.get("threshold", 0.5)

    workflow = sdk_auto_custom_code_run(
        code=str(code),
        correct_answer_key=str(correct_answer_key),
        threshold=float(threshold),
    )

    outputs = inputs.get("prediction", inputs.get("output"))
    request = WorkflowServiceRequest(
        data=WorkflowServiceRequestData(
            inputs=inputs,
            outputs=outputs,
        ),
    )

    response = await workflow.invoke(request=request)
    result = response.data.outputs if response.data else None

    if isinstance(result, dict) and "score" in result:
        score = result["score"]
    else:
        score = result

    return {"outputs": {"score": score}}


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
        correct_answer = get_correct_answer(data_point, settings_values, required=False)
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
        return Result(type="number", value=response["outputs"]["score"])
    except Exception as e:  # pylint: disable=broad-except
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto AI Critique",
                stacktrace=str(traceback.format_exc()),
            ),
        )


import json
import re
from typing import Any, Dict, Iterable, Tuple, Optional

try:
    import jsonpath  # ✅ use module API
    from jsonpath import JSONPointer  # pointer class is fine to use
except Exception:
    jsonpath = None
    JSONPointer = None

# ========= Scheme detection =========


def detect_scheme(expr: str) -> str:
    """Return 'json-path', 'json-pointer', or 'dot-notation' based on the placeholder prefix."""
    if expr.startswith("$"):
        return "json-path"
    if expr.startswith("/"):
        return "json-pointer"
    return "dot-notation"


# ========= Resolvers =========


def resolve_dot_notation(expr: str, data: dict) -> object:
    if "[" in expr or "]" in expr:
        raise KeyError(f"Bracket syntax is not supported in dot-notation: {expr!r}")

    # First, check if the expression exists as a literal key (e.g., "topic.story" as a single key)
    # This allows users to use dots in their variable names without nested access
    if expr in data:
        return data[expr]

    # If not found as a literal key, try to parse as dot-notation path
    cur = data
    for token in (p for p in expr.split(".") if p):
        if isinstance(cur, list) and token.isdigit():
            cur = cur[int(token)]
        else:
            if not isinstance(cur, dict):
                raise KeyError(
                    f"Cannot access key {token!r} on non-dict while resolving {expr!r}"
                )
            if token not in cur:
                raise KeyError(f"Missing key {token!r} while resolving {expr!r}")
            cur = cur[token]
    return cur


def resolve_json_path(expr: str, data: dict) -> object:
    if jsonpath is None:
        raise ImportError("python-jsonpath is required for json-path ($...)")

    if not (expr == "$" or expr.startswith("$.") or expr.startswith("$[")):
        raise ValueError(
            f"Invalid json-path expression {expr!r}. "
            "Must start with '$', '$.' or '$[' (no implicit normalization)."
        )

    # Use package-level APIf
    results = jsonpath.findall(expr, data)  # always returns a list
    return results[0] if len(results) == 1 else results


def resolve_json_pointer(expr: str, data: Dict[str, Any]) -> Any:
    """Resolve a JSON Pointer; returns a single value."""
    if JSONPointer is None:
        raise ImportError("python-jsonpath is required for json-pointer (/...)")
    return JSONPointer(expr).resolve(data)


def resolve_any(expr: str, data: Dict[str, Any]) -> Any:
    """Dispatch to the right resolver based on detected scheme."""
    scheme = detect_scheme(expr)
    if scheme == "json-path":
        return resolve_json_path(expr, data)
    if scheme == "json-pointer":
        return resolve_json_pointer(expr, data)
    return resolve_dot_notation(expr, data)


# ========= Placeholder & coercion helpers =========

_PLACEHOLDER_RE = re.compile(r"\{\{\s*(.*?)\s*\}\}")


def extract_placeholders(template: str) -> Iterable[str]:
    """Yield the inner text of all {{ ... }} occurrences (trimmed)."""
    for m in _PLACEHOLDER_RE.finditer(template):
        yield m.group(1).strip()


def coerce_to_str(value: Any) -> str:
    """Pretty stringify values for embedding into templates."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def build_replacements(
    placeholders: Iterable[str], data: Dict[str, Any]
) -> Tuple[Dict[str, str], set]:
    """
    Resolve all placeholders against data.
    Returns (replacements, unresolved_placeholders).
    """
    replacements: Dict[str, str] = {}
    unresolved: set = set()
    for expr in set(placeholders):
        try:
            val = resolve_any(expr, data)
            # Escape backslashes to avoid regex replacement surprises
            replacements[expr] = coerce_to_str(val).replace("\\", "\\\\")
        except Exception:
            unresolved.add(expr)
    return replacements, unresolved


def apply_replacements(template: str, replacements: Dict[str, str]) -> str:
    """Replace {{ expr }} using a callback to avoid regex-injection issues."""

    def _repl(m: re.Match) -> str:
        expr = m.group(1).strip()
        return replacements.get(expr, m.group(0))

    return _PLACEHOLDER_RE.sub(_repl, template)


def compute_truly_unreplaced(original: set, rendered: str) -> set:
    """Only count placeholders that were in the original template and remain."""
    now = set(extract_placeholders(rendered))
    return original & now


def missing_lib_hints(unreplaced: set) -> Optional[str]:
    """Suggest installing python-jsonpath if placeholders indicate json-path or json-pointer usage."""
    if any(expr.startswith("$") or expr.startswith("/") for expr in unreplaced) and (
        jsonpath is None or JSONPointer is None
    ):
        return (
            "Install python-jsonpath to enable json-path ($...) and json-pointer (/...)"
        )
    return None


def _format_with_template(
    content: str,
    format: str,
    kwargs: Dict[str, Any],
) -> str:
    """Internal method to format content based on template_format"""
    try:
        if format == "fstring":
            return content.format(**kwargs)

        elif format == "jinja2":
            from jinja2 import Template, TemplateError

            try:
                return Template(content).render(**kwargs)
            except TemplateError:
                return content

        elif format == "curly":
            original_placeholders = set(extract_placeholders(content))

            replacements, _unresolved = build_replacements(
                original_placeholders,
                kwargs,
            )

            result = apply_replacements(content, replacements)

            truly_unreplaced = compute_truly_unreplaced(original_placeholders, result)

            if truly_unreplaced:
                hint = missing_lib_hints(truly_unreplaced)
                suffix = f" Hint: {hint}" if hint else ""
                raise ValueError(
                    f"Template variables not found or unresolved: "
                    f"{', '.join(sorted(truly_unreplaced))}.{suffix}"
                )

            return result

        return content
    except Exception as e:
        log.error(f"Error during template formatting: {str(e)}")
        return content


async def ai_critique(input: EvaluatorInputInterface) -> EvaluatorOutputInterface:
    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    anthropic_api_key = input.credentials.get("ANTHROPIC_API_KEY", None)
    litellm.openai_key = openai_api_key
    litellm.anthropic_key = anthropic_api_key
    litellm.drop_params = True

    if not openai_api_key:
        raise Exception(
            "No OpenAI key was found. AI Critique evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again."
        )

    # Validate prompt variables if there's a prompt in the inputs
    if input.settings.get("prompt_template") and input.settings.get("version") not in [
        "3",
        "4",
    ]:
        try:
            validate_prompt_variables(
                prompt=input.settings.get("prompt_template", []),
                inputs=input.inputs,
            )
        except ValueError as e:
            raise e

    if (
        (input.settings.get("version") == "4")
        and (  # this check is used when running in the background (taskiq)
            type(input.settings.get("prompt_template", "")) is not str
        )
    ):  # this check is used when running in the frontend (since in that case we'll alway have version 2)
        try:
            parameters = input.settings or dict()

            if not isinstance(parameters, dict):
                parameters = dict()

            inputs = input.inputs or None

            if not isinstance(inputs, dict):
                inputs = dict()

            outputs = input.inputs.get("prediction") or None

            if "ground_truth" in inputs:
                del inputs["ground_truth"]
            if "prediction" in inputs:
                del inputs["prediction"]

            # ---------------------------------------------------------------- #

            correct_answer_key = parameters.get("correct_answer_key")

            prompt_template: List = parameters.get("prompt_template") or list()

            template_version = parameters.get("version") or "4"

            template_format = parameters.get("template_format") or "curly"

            response_type = input.settings.get("response_type") or "json_schema"

            json_schema = input.settings.get("json_schema") or None

            json_schema = json_schema if response_type == "json_schema" else None

            response_format = dict(type=response_type)

            if response_type == "json_schema":
                response_format["json_schema"] = json_schema

            model = parameters.get("model") or "gpt-4o-mini"

            correct_answer = None

            if inputs and isinstance(inputs, dict) and correct_answer_key:
                correct_answer = inputs[correct_answer_key]

            secrets = await SecretsManager.retrieve_secrets()

            openai_api_key = None  # secrets.get("OPENAI_API_KEY")
            anthropic_api_key = None  # secrets.get("ANTHROPIC_API_KEY")
            openrouter_api_key = None  # secrets.get("OPENROUTER_API_KEY")
            cohere_api_key = None  # secrets.get("COHERE_API_KEY")
            azure_api_key = None  # secrets.get("AZURE_API_KEY")
            groq_api_key = None  # secrets.get("GROQ_API_KEY")

            for secret in secrets:
                if secret.get("kind") == "provider_key":
                    secret_data = secret.get("data", {})
                    if secret_data.get("kind") == "openai":
                        provider_data = secret_data.get("provider", {})
                        openai_api_key = provider_data.get("key") or openai_api_key
                    if secret_data.get("kind") == "anthropic":
                        provider_data = secret_data.get("provider", {})
                        anthropic_api_key = (
                            provider_data.get("key") or anthropic_api_key
                        )
                    if secret_data.get("kind") == "openrouter":
                        provider_data = secret_data.get("provider", {})
                        openrouter_api_key = (
                            provider_data.get("key") or openrouter_api_key
                        )
                    if secret_data.get("kind") == "cohere":
                        provider_data = secret_data.get("provider", {})
                        cohere_api_key = provider_data.get("key") or cohere_api_key
                    if secret_data.get("kind") == "azure":
                        provider_data = secret_data.get("provider", {})
                        azure_api_key = provider_data.get("key") or azure_api_key
                    if secret_data.get("kind") == "groq":
                        provider_data = secret_data.get("provider", {})
                        groq_api_key = provider_data.get("key") or groq_api_key

            threshold = parameters.get("threshold") or 0.5

            score = None
            success = None

            litellm.openai_key = openai_api_key
            litellm.anthropic_key = anthropic_api_key
            litellm.openrouter_key = openrouter_api_key
            litellm.cohere_key = cohere_api_key
            litellm.azure_key = azure_api_key
            litellm.groq_key = groq_api_key

            context: Dict[str, Any] = dict()

            if parameters:
                context.update(
                    **{
                        "parameters": parameters,
                    }
                )

            if correct_answer:
                context.update(
                    **{
                        "ground_truth": correct_answer,
                        "correct_answer": correct_answer,
                        "reference": correct_answer,
                    }
                )

            if outputs:
                context.update(
                    **{
                        "prediction": outputs,
                        "outputs": outputs,
                    }
                )

            if inputs:
                context.update(**inputs)
                context.update(
                    **{
                        "inputs": inputs,
                    }
                )

            formatted_prompt_template = [
                {
                    "role": message["role"],
                    "content": _format_with_template(
                        content=message["content"],
                        format=template_format,
                        kwargs=context,
                    ),
                }
                for message in prompt_template
            ]

            try:
                response = await litellm.acompletion(
                    model=model,
                    messages=formatted_prompt_template,
                    temperature=0.01,
                    response_format=response_format,
                )

                _outputs = response.choices[0].message.content.strip()  # type: ignore

            except litellm.AuthenticationError as e:  # type: ignore
                e.message = e.message.replace(
                    "litellm.AuthenticationError: AuthenticationError: ", ""
                )
                raise e

            except Exception as e:
                raise ValueError(f"AI Critique evaluation failed: {str(e)}") from e
            # --------------------------------------------------------------------------

            try:
                _outputs = json.loads(_outputs)
            except:
                pass

            if isinstance(_outputs, (int, float)):
                return EvaluatorOutputInterface(
                    outputs={
                        "score": _outputs,
                        "success": _outputs >= threshold,
                    },
                )

            if isinstance(_outputs, bool):
                return EvaluatorOutputInterface(
                    outputs={
                        "success": _outputs,
                    },
                )

            if isinstance(_outputs, dict):
                return EvaluatorOutputInterface(
                    outputs=_outputs,
                )

            raise ValueError(f"Could not parse output: {_outputs}")
        except Exception as e:
            raise RuntimeError(f"Evaluation failed: {str(e)}")
    elif (
        (input.settings.get("version") == "3")
        and (  # this check is used when running in the background (taskiq)
            type(input.settings.get("prompt_template", "")) is not str
        )
    ):  # this check is used when running in the frontend (since in that case we'll alway have version 2)
        try:
            parameters = input.settings or dict()

            if not isinstance(parameters, dict):
                parameters = dict()

            inputs = input.inputs or None

            if not isinstance(inputs, dict):
                inputs = dict()

            outputs = input.inputs.get("prediction") or None

            if "ground_truth" in inputs:
                del inputs["ground_truth"]
            if "prediction" in inputs:
                del inputs["prediction"]

            # ---------------------------------------------------------------- #

            correct_answer_key = parameters.get("correct_answer_key")

            prompt_template: List = parameters.get("prompt_template") or list()

            template_version = parameters.get("version") or "3"

            default_format = "fstring" if template_version == "2" else "curly"

            template_format = parameters.get("template_format") or default_format

            model = parameters.get("model") or "gpt-3.5-turbo"

            correct_answer = None

            if inputs and isinstance(inputs, dict) and correct_answer_key:
                correct_answer = inputs[correct_answer_key]

            secrets = await SecretsManager.retrieve_secrets()

            openai_api_key = None  # secrets.get("OPENAI_API_KEY")
            anthropic_api_key = None  # secrets.get("ANTHROPIC_API_KEY")
            openrouter_api_key = None  # secrets.get("OPENROUTER_API_KEY")
            cohere_api_key = None  # secrets.get("COHERE_API_KEY")
            azure_api_key = None  # secrets.get("AZURE_API_KEY")
            groq_api_key = None  # secrets.get("GROQ_API_KEY")

            for secret in secrets:
                if secret.get("kind") == "provider_key":
                    secret_data = secret.get("data", {})
                    if secret_data.get("kind") == "openai":
                        provider_data = secret_data.get("provider", {})
                        openai_api_key = provider_data.get("key") or openai_api_key
                    if secret_data.get("kind") == "anthropic":
                        provider_data = secret_data.get("provider", {})
                        anthropic_api_key = (
                            provider_data.get("key") or anthropic_api_key
                        )
                    if secret_data.get("kind") == "openrouter":
                        provider_data = secret_data.get("provider", {})
                        openrouter_api_key = (
                            provider_data.get("key") or openrouter_api_key
                        )
                    if secret_data.get("kind") == "cohere":
                        provider_data = secret_data.get("provider", {})
                        cohere_api_key = provider_data.get("key") or cohere_api_key
                    if secret_data.get("kind") == "azure":
                        provider_data = secret_data.get("provider", {})
                        azure_api_key = provider_data.get("key") or azure_api_key
                    if secret_data.get("kind") == "groq":
                        provider_data = secret_data.get("provider", {})
                        groq_api_key = provider_data.get("key") or groq_api_key

            threshold = parameters.get("threshold") or 0.5

            score = None
            success = None

            litellm.openai_key = openai_api_key
            litellm.anthropic_key = anthropic_api_key
            litellm.openrouter_key = openrouter_api_key
            litellm.cohere_key = cohere_api_key
            litellm.azure_key = azure_api_key
            litellm.groq_key = groq_api_key

            context: Dict[str, Any] = dict()

            if parameters:
                context.update(
                    **{
                        "parameters": parameters,
                    }
                )

            if correct_answer:
                context.update(
                    **{
                        "ground_truth": correct_answer,
                        "correct_answer": correct_answer,
                        "reference": correct_answer,
                    }
                )

            if outputs:
                context.update(
                    **{
                        "prediction": outputs,
                        "outputs": outputs,
                    }
                )

            if inputs:
                context.update(**inputs)
                context.update(
                    **{
                        "inputs": inputs,
                    }
                )

            formatted_prompt_template = [
                {
                    "role": message["role"],
                    "content": _format_with_template(
                        content=message["content"],
                        format=template_format,
                        kwargs=context,
                    ),
                }
                for message in prompt_template
            ]

            response = await litellm.acompletion(
                model=model,
                messages=formatted_prompt_template,
                temperature=0.01,
            )
            outputs = response.choices[0].message.content.strip()
            try:
                score = float(outputs)

                success = score >= threshold

                return EvaluatorOutputInterface(
                    outputs={"score": score, "success": success},
                )
            except ValueError:
                # if the output is not a float, we try to extract a float from the text
                match = re.search(r"[-+]?\d*\.\d+|\d+", outputs)
                if match:
                    score = float(match.group())
                    return EvaluatorOutputInterface(outputs={"score": score})
                else:
                    raise ValueError(f"Could not parse output as float: {outputs}")
        except Exception as e:
            raise RuntimeError(f"Evaluation failed: {str(e)}")
    elif (
        (input.settings.get("version") == "2")
        and (  # this check is used when running in the background (taskiq)
            type(input.settings.get("prompt_template", "")) is not str
        )
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

    return {"outputs": {"score": float(evaluation_output)}}


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
        return Result(type="bool", value=response["outputs"]["success"])
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
    assert isinstance(app_output, (str, dict)), (
        "App output is expected to be a string or a JSON object"
    )
    app_output = (
        app_output.get("data", "") if isinstance(app_output, dict) else app_output
    )
    if isinstance(app_output, str):
        try:
            app_output = json.loads(app_output)
        except json.JSONDecodeError:
            app_output = {}  # we will return 0 score for json diff in case we cannot parse the output as json

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
            log.error("'output' is most likely not BaseResponse.")
            raise NotImplementedError(
                "Please update the SDK to the latest version, which supports RAG evaluators."
            )

        # Get required keys for rag evaluator
        mapping_keys = remove_trace_prefix(settings_values=settings_values)
        question_key: Union[str, None] = mapping_keys.get("question_key", None)
        answer_key: Union[str, None] = mapping_keys.get("answer_key", None)
        contexts_key: Union[str, None] = mapping_keys.get("contexts_key", None)

        if None in [question_key, answer_key, contexts_key]:
            log.error(
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
            log.warn(
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
            log.error("'output' is most likely not BaseResponse.")
            raise NotImplementedError(
                "Please update the SDK to the latest version, which supports RAG evaluators."
            )

        # Get required keys for rag evaluator
        mapping_keys = remove_trace_prefix(settings_values=settings_values)
        question_key: Union[str, None] = mapping_keys.get("question_key", None)
        answer_key: Union[str, None] = mapping_keys.get("answer_key", None)
        contexts_key: Union[str, None] = mapping_keys.get("contexts_key", None)

        if None in [question_key, answer_key, contexts_key]:
            log.error(
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
            log.warn(
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
            return Result(type="bool", value=response["outputs"]["success"])
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

    correct_answer_key = input.settings.get("correct_answer_key", "correct_answer")

    openai_api_key = input.credentials.get("OPENAI_API_KEY", None)
    if not openai_api_key:
        raise HTTPException(
            status_code=422,
            detail="No OpenAI key was found. Semantic evaluator requires a valid OpenAI API key to function. Please configure your OpenAI API and try again.",
        )

    openai = AsyncOpenAI(api_key=openai_api_key)

    async def encode(text: str):
        response = await openai.embeddings.create(
            model="text-embedding-3-small", input=text
        )
        return np.array(response.data[0].embedding)

    def cosine_similarity(output_vector: array, correct_answer_vector: array) -> float:
        return np.dot(output_vector, correct_answer_vector)

    output_vector = await encode(input.inputs.get("prediction", ""))
    correct_answer_vector = await encode(input.inputs.get(correct_answer_key, ""))
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
    "auto_custom_code_run": sdk_custom_code_run,
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
                message=f"Error occurred while running {evaluator_key} evaluation. ",
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
