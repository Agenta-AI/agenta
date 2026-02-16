from typing import List, Any, Optional, Any, Dict, Union
from json import dumps, loads
import traceback
import json
import re
import math

import httpx

import litellm

from pydantic import BaseModel, Field
from openai import AsyncOpenAI, OpenAIError
from difflib import SequenceMatcher

from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.litellm import mockllm
from agenta.sdk.types import PromptTemplate, Message
from agenta.sdk.managers.secrets import SecretsManager

from agenta.sdk.decorators.tracing import instrument

from agenta.sdk.models.shared import Data
from agenta.sdk.models.tracing import Trace
from agenta.sdk.workflows.sandbox import execute_code_safely
from agenta.sdk.workflows.errors import (
    InvalidConfigurationParametersV0Error,
    MissingConfigurationParameterV0Error,
    InvalidConfigurationParameterV0Error,
    InvalidInputsV0Error,
    MissingInputV0Error,
    InvalidInputV0Error,
    InvalidOutputsV0Error,
    MissingOutputV0Error,
    InvalidSecretsV0Error,
    JSONDiffV0Error,
    LevenshteinDistanceV0Error,
    SyntacticSimilarityV0Error,
    SemanticSimilarityV0Error,
    WebhookServerV0Error,
    WebhookClientV0Error,
    CustomCodeServerV0Error,
    RegexPatternV0Error,
    PromptFormattingV0Error,
    PromptCompletionV0Error,
)

from agenta.sdk.litellm import mockllm
from agenta.sdk.litellm.litellm import litellm_handler

litellm.logging = False
litellm.set_verbose = False
litellm.drop_params = True
# litellm.turn_off_message_logging = True
mockllm.litellm = litellm

litellm.callbacks = [litellm_handler()]

log = get_module_logger(__name__)


async def _compute_embedding(openai: Any, model: str, input: str) -> List[float]:
    response = await openai.embeddings.create(model=model, input=input)
    # embeddings API already returns a list of floats
    return response.data[0].embedding


def _compute_similarity(embedding_1: List[float], embedding_2: List[float]) -> float:
    # Cosine similarity
    dot = sum(a * b for a, b in zip(embedding_1, embedding_2))
    norm1 = math.sqrt(sum(a * a for a in embedding_1))
    norm2 = math.sqrt(sum(b * b for b in embedding_2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


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

        replacements, _unresolved = build_replacements(original_placeholders, kwargs)

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


def _flatten_json(json_obj: Union[list, dict]) -> Dict[str, Any]:
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


def _compare_jsons(
    ground_truth: Union[list, dict],
    app_output: Union[list, dict],
    settings_values: dict,
):
    """
    This function takes two JSON objects (ground truth and application output), flattens them using the `_flatten_json` function, and then compares the fields.

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

    flattened_ground_truth = _flatten_json(ground_truth)
    flattened_app_output = _flatten_json(app_output)

    keys = set(flattened_ground_truth.keys())
    if settings_values.get("predict_keys", False):
        keys = keys.union(set(flattened_app_output.keys()))

    cumulated_score = 0.0
    no_of_keys = len(keys)

    case_insensitive_keys = settings_values.get("case_insensitive_keys", False)
    compare_schema_only = settings_values.get("compare_schema_only", False)
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


@instrument()
def echo_v0(aloha: Any):
    return {"got": aloha}


@instrument(annotate=True)
def auto_exact_match_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Exact match evaluator for comparing outputs against reference outputs.

        inputs: Testcase data, which may contain reference outputs
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with success flag (True for match, False for mismatch)
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    # --------------------------------------------------------------------------
    success = False
    if isinstance(outputs, str) and isinstance(correct_answer, str):
        success = outputs == correct_answer
    elif isinstance(outputs, dict) and isinstance(correct_answer, dict):
        outputs = dumps(outputs, sort_keys=True)
        correct_answer = dumps(correct_answer, sort_keys=True)
        success = outputs == correct_answer
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_regex_test_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Regex test evaluator for checking if output matches a regex pattern.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with regex pattern and matching flag

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "regex_pattern" in parameters:
        raise MissingConfigurationParameterV0Error(path="regex_pattern")

    regex_pattern = parameters["regex_pattern"]

    if not isinstance(regex_pattern, str):
        raise InvalidConfigurationParameterV0Error(
            path="regex_pattern",
            expected="str",
            got=regex_pattern,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    regex_should_match = parameters.get("regex_should_match", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    try:
        pattern = re.compile(
            regex_pattern,
            flags=0 if case_sensitive else re.IGNORECASE,
        )
    except Exception as e:
        raise RegexPatternV0Error(pattern=regex_pattern) from e

    result = pattern.search(outputs_str)

    success = bool(result) == regex_should_match
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def field_match_test_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Field match test evaluator for extracting and comparing a specific field from JSON output.

    Args:
        inputs: Testcase data with ground truth
        outputs: Output from the workflow execution (expected to be JSON string or dict)
        parameters: Configuration for the evaluator with json_field to extract

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "json_field" in parameters:
        raise MissingConfigurationParameterV0Error(path="json_field")

    json_field = str(parameters["json_field"])

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        # raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)
        return {"success": False}

    outputs_dict = outputs
    if isinstance(outputs, str):
        try:
            outputs_dict = loads(outputs)
        except json.JSONDecodeError as e:
            # raise InvalidOutputsV0Error(expected="dict", got=outputs) from e
            return {"success": False}

    if not isinstance(outputs_dict, dict):
        # raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)
        return {"success": False}

    if not json_field in outputs_dict:
        # raise MissingOutputV0Error(path=json_field)
        return {"success": False}

    # --------------------------------------------------------------------------
    success = outputs_dict[json_field] == correct_answer
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
async def auto_webhook_test_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Webhook test evaluator for sending output to an external service for evaluation.

    Args:
        inputs: Testcase data with ground truth
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with webhook_url

    Returns:
        Evaluation result with score from the webhook
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "webhook_url" in parameters:
        raise MissingConfigurationParameterV0Error(path="webhook_url")

    webhook_url = str(parameters["webhook_url"])

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    json_payload = {
        "inputs": inputs,
        "output": outputs_str,
        "correct_answer": correct_answer,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url=webhook_url,
                json=json_payload,
            )
        except Exception as e:
            raise WebhookClientV0Error(
                message=str(e),
            ) from e

        if response.status_code != 200:
            raise WebhookServerV0Error(
                code=response.status_code,
                message=response.json(),
            )

        try:
            _outputs = response.json()
        except Exception as e:
            raise WebhookClientV0Error(
                message=str(e),
            ) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    if isinstance(_outputs, bool):
        return {"success": _outputs}

    if isinstance(_outputs, dict) or isinstance(_outputs, str):
        return _outputs

    raise InvalidOutputsV0Error(expected=["dict", "str"], got=_outputs)


@instrument(annotate=True)
async def auto_custom_code_run_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Custom code execution evaluator for running arbitrary code to evaluate outputs.

    Args:
        inputs: Testcase data with ground truth
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with code to execute

    Returns:
        Evaluation result with score from the custom code
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "code" in parameters:
        raise MissingConfigurationParameterV0Error(path="code")

    code = str(parameters["code"])

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    try:
        _outputs = execute_code_safely(
            app_params={},
            inputs=inputs,
            output=outputs,
            correct_answer=correct_answer,
            code=code,
        )
    except Exception as e:
        raise CustomCodeServerV0Error(
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    if isinstance(_outputs, bool):
        return {"success": _outputs}

    if isinstance(_outputs, dict) or isinstance(_outputs, str):
        return _outputs

    raise InvalidOutputsV0Error(expected=["dict", "str"], got=_outputs)


@instrument(annotate=True)
async def auto_ai_critique_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    # return {"score": 0.75, "success": True}

    """
    AI critique evaluator for using an LLM to evaluate outputs.

    Args:
        inputs: Testcase data with ground truth
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with prompt_template and model

    Returns:
        Evaluation result with score from the AI
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    correct_answer_key = parameters.get("correct_answer_key")

    if not "prompt_template" in parameters:
        raise MissingConfigurationParameterV0Error(path="prompt_template")

    prompt_template = parameters.get("prompt_template")

    if not isinstance(prompt_template, list):
        raise InvalidConfigurationParameterV0Error(
            path="prompt_template",
            expected="list",
            got=prompt_template,
        )

    template_version = parameters.get("version") or "3"

    default_format = "fstring" if template_version == "2" else "curly"

    template_format = str(parameters.get("template_format") or default_format)

    model = parameters.get("model") or "gpt-3.5-turbo"

    if not isinstance(model, str):
        raise InvalidConfigurationParameterV0Error(
            path="model",
            expected="str",
            got=model,
        )

    response_type = parameters.get("response_type") or (
        "json_schema" if template_version == "4" else "text"
    )

    if not response_type in ["text", "json_object", "json_schema"]:
        raise InvalidConfigurationParameterV0Error(
            path="response_type",
            expected=["text", "json_object", "json_schema"],
            got=response_type,
        )

    json_schema = parameters.get("json_schema") or None

    json_schema = json_schema if response_type == "json_schema" else None

    if response_type == "json_schema" and not isinstance(json_schema, dict):
        raise InvalidConfigurationParameterV0Error(
            path="json_schema",
            expected="dict",
            got=json_schema,
        )

    response_format: dict = dict(type=response_type)

    if response_type == "json_schema":
        response_format["json_schema"] = json_schema

    correct_answer = None

    if inputs:
        if not isinstance(inputs, dict):
            raise InvalidInputsV0Error(expected="dict", got=inputs)

        if correct_answer_key:
            if correct_answer_key in inputs:
                correct_answer = inputs[correct_answer_key]

    secrets = await SecretsManager.retrieve_secrets()

    if secrets is None or not isinstance(secrets, list):
        raise InvalidSecretsV0Error(expected="list", got=secrets)

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
                anthropic_api_key = provider_data.get("key") or anthropic_api_key
            if secret_data.get("kind") == "openrouter":
                provider_data = secret_data.get("provider", {})
                openrouter_api_key = provider_data.get("key") or openrouter_api_key
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

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
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

    try:
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
    except Exception as e:
        raise PromptFormattingV0Error(
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e

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
        raise PromptCompletionV0Error(
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e
    # --------------------------------------------------------------------------

    try:
        _outputs = json.loads(_outputs)
    except:
        pass

    if isinstance(_outputs, (int, float)):
        return {
            "score": _outputs,
            "success": _outputs >= threshold,
        }

    if isinstance(_outputs, bool):
        return {
            "success": _outputs,
        }

    if isinstance(_outputs, dict):
        return _outputs

    raise InvalidOutputsV0Error(expected=["dict", "str", "int", "float"], got=_outputs)


@instrument(annotate=True)
def auto_starts_with_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Starts with evaluator for checking if output starts with a specific prefix.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with prefix and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "prefix" in parameters:
        raise MissingConfigurationParameterV0Error(path="prefix")

    prefix = parameters["prefix"]

    if not isinstance(prefix, str):
        raise InvalidConfigurationParameterV0Error(
            path="prefix",
            expected="str",
            got=prefix,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        prefix = prefix.lower()

    success = outputs_str.startswith(prefix)
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_ends_with_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Ends with evaluator for checking if output ends with a specific suffix.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with suffix and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "suffix" in parameters:
        raise MissingConfigurationParameterV0Error(path="suffix")

    suffix = parameters["suffix"]

    if not isinstance(suffix, str):
        raise InvalidConfigurationParameterV0Error(
            path="suffix",
            expected="str",
            got=suffix,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        suffix = suffix.lower()

    success = outputs_str.endswith(suffix)
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_contains_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Contains evaluator for checking if output contains a specific substring.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substring and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "substring" in parameters:
        raise MissingConfigurationParameterV0Error(path="substring")

    substring = parameters["substring"]

    if not isinstance(substring, str):
        raise InvalidConfigurationParameterV0Error(
            path="substring",
            expected="str",
            got=substring,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        substring = substring.lower()

    success = substring in outputs_str
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_contains_any_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Contains any evaluator for checking if output contains any of the specified substrings.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substrings list and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "substrings" in parameters:
        raise MissingConfigurationParameterV0Error(path="substrings")

    substrings = parameters["substrings"]

    if not isinstance(substrings, list):
        raise InvalidConfigurationParameterV0Error(
            path="substrings",
            expected="list",
            got=substrings,
        )

    substrings = [s.strip() for s in substrings]

    if not all(isinstance(s, str) for s in substrings):
        raise InvalidConfigurationParameterV0Error(
            path="substrings",
            expected="list[str]",
            got=substrings,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        substrings = [s.lower() for s in substrings]

    success = any(substring in outputs_str for substring in substrings)
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_contains_all_v0(
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Contains all evaluator for checking if output contains all of the specified substrings.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substrings list and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "substrings" in parameters:
        raise MissingConfigurationParameterV0Error(path="substrings")

    substrings = parameters["substrings"]

    if not isinstance(substrings, list):
        raise InvalidConfigurationParameterV0Error(
            path="substrings",
            expected="list",
            got=substrings,
        )

    substrings = [s.strip() for s in substrings]

    if not all(isinstance(s, str) for s in substrings):
        raise InvalidConfigurationParameterV0Error(
            path="substrings",
            expected="list[str]",
            got=substrings,
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        substrings = [s.lower() for s in substrings]

    success = all(substring in outputs_str for substring in substrings)
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_contains_json_v0(
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Contains JSON evaluator for checking if output contains valid JSON content.

    Args:
        inputs: Testcase data
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with success flag
    """
    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    # --------------------------------------------------------------------------
    success = True
    potential_json = ""

    try:
        start_index = outputs_str.index("{")
        end_index = outputs_str.rindex("}") + 1
        potential_json = outputs_str[start_index:end_index]
    except Exception:  # pylint: disable=broad-exception-caught
        success = False

    if success:
        try:
            json.loads(potential_json)
        except Exception:  # pylint: disable=broad-exception-caught
            success = False
    # --------------------------------------------------------------------------

    return {"success": success}


@instrument(annotate=True)
def auto_json_diff_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    JSON diff evaluator for finding differences between JSON structures.

    Args:
        inputs: Testcase data with reference JSON
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with score only (no diff explanation)
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidInputV0Error(
            path=correct_answer_key, expected=["dict", "str"], got=correct_answer
        )

    correct_answer_dict = (
        correct_answer if isinstance(correct_answer, dict) else loads(correct_answer)
    )

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_dict = outputs
    if isinstance(outputs, str):
        try:
            outputs_dict = loads(outputs)
        except json.JSONDecodeError as e:
            raise InvalidOutputsV0Error(expected="dict", got=outputs) from e

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    try:
        _outputs = _compare_jsons(
            ground_truth=correct_answer_dict,
            app_output=outputs_dict,  # type: ignore
            settings_values=parameters,
        )

    except Exception as e:
        raise JSONDiffV0Error(message=str(e), stacktrace=traceback.format_exc()) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    raise JSONDiffV0Error(
        message=f"json-diff error: got ({type(_outputs)}) {_outputs}, expected (int, float)."
    )


@instrument(annotate=True)
def auto_levenshtein_distance_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Levenshtein distance evaluator using pure Python implementation.
    Measures edit distance and returns normalized similarity score.

    Args:
        inputs: Testcase data with reference string.
        outputs: Output from the workflow execution.
        parameters: Configuration for the evaluator.

    Returns:
        Dictionary with normalized similarity score (0 to 1),
        or error message if evaluation fails.
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidInputV0Error(
            path=correct_answer_key, expected=["dict", "str"], got=correct_answer
        )

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        correct_answer_str = correct_answer_str.lower()

    try:
        # Compute Levenshtein distance
        if len(correct_answer_str) == 0:
            distance = len(outputs_str)
        else:
            previous_row = list(range(len(correct_answer_str) + 1))
            for i, c1 in enumerate(outputs_str):
                current_row = [i + 1]
                for j, c2 in enumerate(correct_answer_str):
                    insert = previous_row[j + 1] + 1
                    delete = current_row[j] + 1
                    substitute = previous_row[j] + (c1 != c2)
                    current_row.append(min(insert, delete, substitute))
                previous_row = current_row
            distance = previous_row[-1]

        # Normalize similarity score
        max_length = max(len(outputs_str), len(correct_answer_str))
        _outputs = 1.0 if max_length == 0 else 1.0 - (distance / max_length)
    except Exception as e:
        raise LevenshteinDistanceV0Error(
            message=str(e), stacktrace=traceback.format_exc()
        ) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    raise LevenshteinDistanceV0Error(
        message=f"levenshtein-distance error: got ({type(_outputs)}) {_outputs}, expected (int, float)."
    )


@instrument(annotate=True)
def auto_similarity_match_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Similarity match evaluator for measuring string similarity between output and reference.

    Args:
        inputs: Testcase data with reference string
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with similarity score
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidInputV0Error(
            path=correct_answer_key, expected=["dict", "str"], got=correct_answer
        )

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    threshold = (
        parameters.get("threshold") or parameters.get("similarity_threshold") or 0.5
    )

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    if not case_sensitive:
        outputs_str = outputs_str.lower()
        correct_answer_str = correct_answer_str.lower()

    try:
        matcher = SequenceMatcher(None, outputs_str, correct_answer_str)

        _outputs = matcher.ratio()
    except Exception as e:
        raise SyntacticSimilarityV0Error(
            message=str(e), stacktrace=traceback.format_exc()
        ) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    raise SyntacticSimilarityV0Error(
        message=f"syntactic-similarity-match error: got ({type(_outputs)}) {_outputs}, expected (int, float)."
    )


@instrument(annotate=True)
async def auto_semantic_similarity_v0(
    *,
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Semantic similarity evaluator for measuring semantic similarity between output and reference using embeddings.

    Args:
        inputs: Testcase data with reference string
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with embedding model and credentials

    Returns:
        Evaluation result with cosine similarity score
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "correct_answer_key" in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    embedding_model = parameters.get("embedding_model", "text-embedding-3-small")

    if not isinstance(embedding_model, str):
        raise InvalidConfigurationParametersV0Error(expected="str", got=embedding_model)

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not correct_answer_key in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidInputV0Error(
            path=correct_answer_key, expected=["dict", "str"], got=correct_answer
        )

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    outputs_str = outputs if isinstance(outputs, str) else dumps(outputs)

    secrets = await SecretsManager.retrieve_secrets()

    if secrets is None or not isinstance(secrets, list):
        raise InvalidSecretsV0Error(expected="list", got=secrets)

    openai_api_key = None  # secrets.get("OPENAI_API_KEY")

    for secret in secrets:
        if secret.get("kind") == "provider_key":
            secret_data = secret.get("data", {})
            if secret_data.get("kind") == "openai":
                provider_data = secret_data.get("provider", {})
                openai_api_key = provider_data.get("key") or openai_api_key

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float):
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float",
            got=threshold,
        )

    if not 0.0 < threshold <= 1.0:
        raise InvalidConfigurationParameterV0Error(
            path="threshold",
            expected="float[0.0, 1.0]",
            got=threshold,
        )

    _outputs = None

    # --------------------------------------------------------------------------
    try:
        openai = AsyncOpenAI(api_key=openai_api_key)
    except OpenAIError as e:
        raise OpenAIError("OpenAIException - " + e.args[0])

    output_embedding = await _compute_embedding(
        openai,
        embedding_model,
        outputs_str,
    )

    reference_embedding = await _compute_embedding(
        openai,
        embedding_model,
        correct_answer_str,
    )

    _outputs = float(
        _compute_similarity(
            output_embedding,
            reference_embedding,
        )
    )
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    raise SemanticSimilarityV0Error(
        message=f"semantic-similarity error: got ({type(_outputs)}) {_outputs}, expected (int, float)."
    )


class SinglePromptConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


@instrument()
async def completion_v0(
    parameters: Data,
    inputs: Dict[str, str],
) -> Any:
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if not "prompt" in parameters:
        raise MissingConfigurationParameterV0Error(path="prompt")

    params: Dict[str, Any] = {**(parameters or {})}

    config = SinglePromptConfig(**params)
    if config.prompt.input_keys is not None:
        required_keys = set(config.prompt.input_keys)
        provided_keys = set(inputs.keys())

        if required_keys != provided_keys:
            raise InvalidInputsV0Error(
                expected=sorted(required_keys),
                got=sorted(provided_keys),
            )

    await SecretsManager.ensure_secrets_in_workflow()

    provider_settings = SecretsManager.get_provider_settings_from_workflow(
        config.prompt.llm_config.model
    )

    if not provider_settings:
        raise InvalidSecretsV0Error(expected="dict", got=provider_settings)

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v
                for k, v in config.prompt.format(**inputs).to_openai_kwargs().items()
                if k != "model"
            },
            **provider_settings,
        )

    message = response.choices[0].message  # type: ignore

    if message.content is not None:
        return message.content
    if hasattr(message, "refusal") and message.refusal is not None:  # type: ignore
        return message.refusal  # type: ignore
    if hasattr(message, "parsed") and message.parsed is not None:  # type: ignore
        return message.parsed  # type: ignore
    if hasattr(message, "tool_calls") and message.tool_calls is not None:
        return [tool_call.dict() for tool_call in message.tool_calls]


@instrument()
async def chat_v0(
    parameters: Data,
    inputs: Optional[Dict[str, str]] = None,
    messages: Optional[List[Message]] = None,
):
    params: Dict[str, Any] = {**(parameters or {})}

    config = SinglePromptConfig(**params)
    if config.prompt.input_keys is not None:
        required_keys = set(config.prompt.input_keys)
        provided_keys = set(inputs.keys()) if inputs is not None else set()

        if required_keys != provided_keys:
            raise InvalidInputsV0Error(
                expected=sorted(required_keys),
                got=sorted(provided_keys),
            )

    if inputs is not None:
        formatted_prompt = config.prompt.format(**inputs)
    else:
        formatted_prompt = config.prompt
    openai_kwargs = formatted_prompt.to_openai_kwargs()

    if messages is not None:
        openai_kwargs["messages"].extend(messages)

    await SecretsManager.ensure_secrets_in_workflow()

    provider_settings = SecretsManager.get_provider_settings_from_workflow(
        config.prompt.llm_config.model
    )

    if not provider_settings:
        raise InvalidSecretsV0Error(expected="dict", got=provider_settings)

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v for k, v in openai_kwargs.items() if k != "model"
            },  # we should use the model_name from provider_settings
            **provider_settings,
        )

    return response.choices[0].message.model_dump(exclude_none=True)  # type: ignore
