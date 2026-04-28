import asyncio
import json
import math
import os
import re
import socket
import ipaddress
import traceback
from difflib import SequenceMatcher
from json import dumps, loads
from typing import Any, Dict, List, Optional, Union, Iterable, Tuple
from urllib.parse import urlparse

import httpx

from pydantic import BaseModel, Field

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.helpers import apply_replacements_with_tracking, _PLACEHOLDER_RE
from agenta.sdk.utils.lazy import (
    _load_jinja2,
    _load_jsonpath,
    _load_litellm,
    _load_openai,
)

from agenta.sdk.litellm import mockllm
from agenta.sdk.utils.types import (  # noqa: F401
    FallbackPolicy,
    Message,
    Messages,
    ModelConfig,
    PromptTemplate,
    RetryConfig,
    RetryPolicy,
)
from agenta.sdk.managers.secrets import SecretsManager
from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.models.shared import Data
from agenta.sdk.engines.running.sandbox import execute_code_safely
from agenta.sdk.engines.running.templates import EVALUATOR_TEMPLATES
from agenta.sdk.engines.running.errors import (
    CustomCodeServerV0Error,
    ErrorStatus,
    InvalidConfigurationParametersV0Error,
    InvalidConfigurationParameterV0Error,
    InvalidInputsV0Error,
    InvalidInputV0Error,
    InvalidOutputsV0Error,
    InvalidSecretsV0Error,
    JSONDiffV0Error,
    LevenshteinDistanceV0Error,
    MissingConfigurationParameterV0Error,
    MissingInputV0Error,
    PromptCompletionV0Error,
    PromptFormattingV0Error,
    RegexPatternV0Error,
    SemanticSimilarityV0Error,
    SyntacticSimilarityV0Error,
    WebhookClientV0Error,
    WebhookServerV0Error,
    MatchV0Error,
    CodeV0Error,
    ConfigV0Error,
    FeedbackV0Error,
)

log = get_module_logger(__name__)

_WEBHOOK_RESPONSE_MAX_BYTES = 1 * 1024 * 1024.0  # 1 MB
_WEBHOOK_ALLOW_INSECURE = (
    os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE") or "true"
).lower() in {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    if _WEBHOOK_ALLOW_INSECURE:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _validate_webhook_url(url: str) -> None:
    if not url:
        raise ValueError("Webhook URL is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("Webhook URL must use http or https.")
    if scheme == "http" and not _WEBHOOK_ALLOW_INSECURE:
        raise ValueError("Webhook URL must use https.")
    if not parsed.netloc:
        raise ValueError("Webhook URL must include a host.")
    if parsed.username or parsed.password:
        raise ValueError("Webhook URL must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("Webhook URL must include a valid hostname.")
    if (
        hostname in {"localhost", "localhost.localdomain"}
        and not _WEBHOOK_ALLOW_INSECURE
    ):
        raise ValueError("Webhook URL hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip):
            raise ValueError("Webhook URL resolves to a blocked IP range.")
        return

    try:
        addresses = {
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        }
    except socket.gaierror as exc:
        raise ValueError("Webhook URL hostname could not be resolved.") from exc

    if not addresses or any(_is_blocked_ip(ip) for ip in addresses):
        raise ValueError("Webhook URL resolves to a blocked IP range.")


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


# ========= Scheme detection =========


from agenta.sdk.utils.resolvers import (  # noqa: E402
    detect_scheme,  # noqa: F401
    resolve_dot_notation,  # noqa: F401
    resolve_json_path,  # noqa: F401
    resolve_json_pointer,  # noqa: F401
    resolve_json_selector,  # noqa: F401
    resolve_any,  # noqa: F401
)


# ========= Placeholder & coercion helpers =========


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


def missing_lib_hints(unreplaced: set) -> Optional[str]:
    """Suggest installing python-jsonpath if placeholders indicate json-path or json-pointer usage."""
    if any(expr.startswith("$") or expr.startswith("/") for expr in unreplaced):
        json_path, json_pointer = _load_jsonpath()
        if json_path is None or json_pointer is None:
            return "Install python-jsonpath to enable json-path ($...) and json-pointer (/...)"
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
        SandboxedEnvironment, TemplateError = _load_jinja2()
        env = SandboxedEnvironment()

        try:
            return env.from_string(content).render(**kwargs)
        except TemplateError as e:
            log.warning(
                "Jinja2 template rendering failed (possible sandbox violation): %s",
                str(e),
            )
            return content

    elif format == "curly":
        original_placeholders = set(extract_placeholders(content))

        replacements, _unresolved = build_replacements(original_placeholders, kwargs)

        result, successfully_replaced = apply_replacements_with_tracking(
            content, replacements
        )

        # Only the placeholders that were NOT successfully replaced are errors
        # This avoids false positives when substituted values contain {{...}} patterns
        truly_unreplaced = original_placeholders - successfully_replaced

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
                1.0 if (gt_key == ao_key and type(gt_value) == type(ao_value)) else 0.0  # noqa: E721
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


@instrument()
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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


@instrument()
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

    if "regex_pattern" not in parameters:
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


@instrument()
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

    if "json_field" not in parameters:
        raise MissingConfigurationParameterV0Error(path="json_field")

    json_field = str(parameters["json_field"])

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        # raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)
        return {"success": False}

    outputs_dict = outputs
    if isinstance(outputs, str):
        try:
            outputs_dict = loads(outputs)
        except json.JSONDecodeError:
            # raise InvalidOutputsV0Error(expected="dict", got=outputs) from e
            return {"success": False}

    if not isinstance(outputs_dict, dict):
        # raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)
        return {"success": False}

    if json_field not in outputs_dict:
        # raise MissingOutputV0Error(path=json_field)
        return {"success": False}

    # --------------------------------------------------------------------------
    success = outputs_dict[json_field] == correct_answer
    # --------------------------------------------------------------------------

    return {"success": success}


def _get_nested_value(obj: Any, path: str) -> Any:
    """
    Get value from nested object using resolve_any() with graceful None on failure.

    Supports multiple path formats:
        - Dot notation: "user.address.city", "items.0.name"
        - JSON Path: "$.user.address.city", "$.items[0].name"
        - JSON Pointer: "/user/address/city", "/items/0/name"

    Args:
        obj: The object to traverse (dict or list)
        path: Path expression in any supported format

    Returns:
        The value at the path, or None if path doesn't exist or resolution fails
    """
    if obj is None:
        return None

    try:
        return resolve_any(path, obj)
    except (KeyError, IndexError, ValueError, TypeError, ImportError):
        return None


@instrument()
def json_multi_field_match_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
) -> Any:
    """
    Multi-field JSON match evaluator for comparing multiple fields between expected and actual JSON.

    Each configured field becomes a separate score (0 or 1), and an aggregate_score shows
    the percentage of matching fields. Useful for entity extraction validation.

    Args:
        inputs: Testcase data with ground truth JSON
        outputs: Output from the workflow execution (expected to be JSON string or dict)
        parameters: Configuration with:
            - fields: List of field paths to compare (e.g., ["name", "user.address.city"])
            - correct_answer_key: Key in inputs containing the expected JSON

    Returns:
        Dict with per-field scores and aggregate_score, e.g.:
        {"name": 1.0, "email": 0.0, "aggregate_score": 0.5}
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if "fields" not in parameters:
        raise MissingConfigurationParameterV0Error(path="fields")

    fields = parameters["fields"]

    if not isinstance(fields, list) or len(fields) == 0:
        raise InvalidConfigurationParameterV0Error(
            path="fields",
            expected="non-empty list",
            got=fields,
        )

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
        raise MissingInputV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    # Parse ground truth JSON
    if isinstance(correct_answer, str):
        try:
            expected = json.loads(correct_answer)
        except json.JSONDecodeError:
            raise InvalidInputV0Error(
                path=correct_answer_key,
                expected="valid JSON string",
                got=correct_answer,
            )
    elif isinstance(correct_answer, dict):
        expected = correct_answer
    else:
        raise InvalidInputV0Error(
            path=correct_answer_key,
            expected=["dict", "str"],
            got=correct_answer,
        )

    # Parse output JSON
    if not isinstance(outputs, str) and not isinstance(outputs, dict):
        # Return all zeros if output is invalid
        results: Dict[str, Any] = {field: 0.0 for field in fields}
        results["aggregate_score"] = 0.0
        return results

    if isinstance(outputs, str):
        try:
            actual = json.loads(outputs)
        except json.JSONDecodeError:
            # Return all zeros if output is not valid JSON
            results = {field: 0.0 for field in fields}
            results["aggregate_score"] = 0.0
            return results
    else:
        actual = outputs

    if not isinstance(actual, dict):
        # Return all zeros if parsed output is not a dict
        results = {field: 0.0 for field in fields}
        results["aggregate_score"] = 0.0
        return results

    # --------------------------------------------------------------------------
    # Compare each configured field
    results = {}
    matches = 0

    for field_path in fields:
        expected_val = _get_nested_value(expected, field_path)
        actual_val = _get_nested_value(actual, field_path)

        # Exact match comparison
        match = expected_val == actual_val

        results[field_path] = 1.0 if match else 0.0
        if match:
            matches += 1

    # Aggregate score is the percentage of matching fields
    results["aggregate_score"] = matches / len(fields) if fields else 0.0
    # --------------------------------------------------------------------------

    return results


@instrument()
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

    if "webhook_url" not in parameters:
        raise MissingConfigurationParameterV0Error(path="webhook_url")

    webhook_url = str(parameters["webhook_url"])
    try:
        _validate_webhook_url(webhook_url)
    except ValueError as exc:
        raise InvalidConfigurationParameterV0Error(
            path="webhook_url",
            expected="http/https URL",
            got=webhook_url,
        ) from exc

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

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
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url=webhook_url,
                json=json_payload,
                timeout=httpx.Timeout(10.0, connect=5.0),
            )
        except Exception as e:
            raise WebhookClientV0Error(
                message=str(e),
            ) from e

        if response.status_code != 200:
            try:
                message = response.json()
            except Exception:
                message = response.text
            raise WebhookServerV0Error(
                code=response.status_code,
                message=message,
            )

        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > _WEBHOOK_RESPONSE_MAX_BYTES:
            raise WebhookClientV0Error(message="Webhook response exceeded size limit.")

        response_bytes = response.content
        if len(response_bytes) > _WEBHOOK_RESPONSE_MAX_BYTES:
            raise WebhookClientV0Error(message="Webhook response exceeded size limit.")

        try:
            _outputs = json.loads(response_bytes)
        except Exception as e:
            raise WebhookClientV0Error(message=str(e)) from e
    # --------------------------------------------------------------------------

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    if isinstance(_outputs, bool):
        return {"success": _outputs}

    if isinstance(_outputs, dict) or isinstance(_outputs, str):
        return _outputs

    raise InvalidOutputsV0Error(expected=["dict", "str"], got=_outputs)


@instrument()
async def auto_custom_code_run_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
) -> Any:
    """
    Custom code execution evaluator for running arbitrary code to evaluate outputs.

    Supports two interface versions controlled by parameters["version"]:
    - v1 (default/"1"): evaluate(app_params, inputs, output, correct_answer)
    - v2 ("2"):         evaluate(inputs, outputs, trace)

    Args:
        inputs: Testcase data / app inputs
        outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with code to execute
        trace: Full trace data with spans, metrics (v2 only)

    Returns:
        Evaluation result with score from the custom code
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if "code" not in parameters:
        raise MissingConfigurationParameterV0Error(path="code")

    code = str(parameters["code"])

    declared_version = str(parameters.get("version") or "").strip() or None

    if inputs is not None and not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if not isinstance(outputs, (str, dict)):
        raise InvalidOutputsV0Error(expected=["dict", "str"], got=outputs)

    _outputs_value: Union[dict, str] = outputs

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

    runtime = parameters.get("runtime") or "python"

    if runtime not in ["python", "javascript", "typescript"]:
        raise InvalidConfigurationParameterV0Error(
            path="runtime",
            expected="['python', 'javascript', 'typescript']",
            got=runtime,
        )

    effective_version = declared_version if declared_version in {"1", "2"} else "1"

    def _run_v2() -> Any:
        try:
            return execute_code_safely(
                app_params={},
                inputs=inputs or {},
                output=_outputs_value,
                correct_answer=None,
                code=code,
                runtime=runtime,
                templates=EVALUATOR_TEMPLATES.get("v1", {}),
                version="2",
                trace=trace,
            )
        except ErrorStatus:
            raise
        except Exception as e:
            raise CustomCodeServerV0Error(
                message=str(e),
                stacktrace=traceback.format_exc(),
            ) from e

    def _run_v1() -> Any:
        if "correct_answer_key" not in parameters:
            raise MissingConfigurationParameterV0Error(path="correct_answer_key")

        correct_answer_key = str(parameters["correct_answer_key"])

        if inputs is None or not isinstance(inputs, dict):
            raise InvalidInputsV0Error(expected="dict", got=inputs)

        if correct_answer_key not in inputs:
            raise MissingInputV0Error(path=correct_answer_key)

        correct_answer = inputs[correct_answer_key]

        try:
            return execute_code_safely(
                app_params={},
                inputs=inputs,
                output=_outputs_value,
                correct_answer=correct_answer,
                code=code,
                runtime=runtime,
                templates=EVALUATOR_TEMPLATES.get("v0", {}),
                version="1",
                trace=None,
            )
        except ErrorStatus:
            raise
        except Exception as e:
            raise CustomCodeServerV0Error(
                message=str(e),
                stacktrace=traceback.format_exc(),
            ) from e

    _outputs = _run_v2() if effective_version == "2" else _run_v1()

    if isinstance(_outputs, (int, float)):
        return {"score": _outputs, "success": _outputs >= threshold}

    if isinstance(_outputs, bool):
        return {"success": _outputs}

    if isinstance(_outputs, dict) or isinstance(_outputs, str):
        return _outputs

    raise InvalidOutputsV0Error(expected=["dict", "str"], got=_outputs)


@instrument()
async def auto_ai_critique_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
) -> Any:
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

    if "prompt_template" not in parameters:
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

    if response_type not in ["text", "json_object", "json_schema"]:
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

    secrets, _, _ = await SecretsManager.retrieve_secrets()

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

    # Lazy import litellm (configuration is done automatically in _load_litellm)
    litellm = _load_litellm()
    if not litellm:
        raise ImportError("litellm is required for completion handling.")

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

    if correct_answer is not None:
        context.update(
            **{
                "ground_truth": correct_answer,
                "correct_answer": correct_answer,
                "reference": correct_answer,
            }
        )

    if outputs is not None:
        context.update(
            **{
                "prediction": outputs,
                "outputs": outputs,
            }
        )

    if inputs is not None:
        context.update(**inputs)
        context.update(
            **{
                "inputs": inputs,
            }
        )

    if trace is not None:
        context.update(
            **{
                "trace": trace,
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
    except Exception:
        log.warning("LLM output is not valid JSON, using raw output.", exc_info=True)
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


@instrument()
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

    if "prefix" not in parameters:
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


@instrument()
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

    if "suffix" not in parameters:
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


@instrument()
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

    if "substring" not in parameters:
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


@instrument()
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

    if "substrings" not in parameters:
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


@instrument()
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

    if "substrings" not in parameters:
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


@instrument()
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


@instrument()
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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


@instrument()
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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


@instrument()
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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


@instrument()
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    embedding_model = parameters.get("embedding_model", "text-embedding-3-small")

    if not isinstance(embedding_model, str):
        raise InvalidConfigurationParametersV0Error(expected="str", got=embedding_model)

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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

    secrets, _, _ = await SecretsManager.retrieve_secrets()

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
    AsyncOpenAI, OpenAIError = _load_openai()
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


def _apply_responses_bridge_if_needed(
    provider_settings: Dict,
    llm_config: ModelConfig,
) -> Dict:
    """
    Checks if web_search_preview tool is present and applies responses bridge if needed.

    If a web_search_preview, code_execution, or mcp tool is detected, this function
    modifies the provider_settings to use the responses bridge by prepending
    'openai/responses/' to the model name.

    Args:
        provider_settings: The provider settings dictionary that may be modified
        llm_config: The LLM config containing tool definitions

    Returns:
        The provider_settings dictionary, potentially modified to use responses bridge
    """
    tools = llm_config.tools
    if tools:
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") in [
                "web_search_preview",
                "code_execution",
                "mcp",
            ]:
                model_val = provider_settings.get("model")
                if model_val and "/" not in model_val:
                    provider_settings["model"] = f"openai/responses/{model_val}"
    return provider_settings


def _coerce_retry_config(retry_config: Optional[RetryConfig]) -> RetryConfig:
    return retry_config or RetryConfig()


def _coerce_retry_policy(retry_policy: Optional[RetryPolicy]) -> RetryPolicy:
    return retry_policy or RetryPolicy.OFF


def _coerce_fallback_policy(
    fallback_policy: Optional[FallbackPolicy],
) -> FallbackPolicy:
    return fallback_policy or FallbackPolicy.OFF


def _prompt_llm_configs(prompt: PromptTemplate) -> List[ModelConfig]:
    return [prompt.llm_config, *(prompt.fallback_configs or [])]


def _error_status_code(error: Exception) -> Optional[int]:
    status_code = getattr(error, "status_code", None)
    if isinstance(status_code, int):
        return status_code

    response = getattr(error, "response", None)
    status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code

    return None


def _error_text(error: Exception) -> str:
    return f"{type(error).__name__} {str(error)}".lower()


def _is_context_window_error(error: Exception) -> bool:
    error_text = _error_text(error)
    return any(
        marker in error_text
        for marker in (
            "context length",
            "context window",
            "context limit",
            "maximum context",
            "max context",
            "token limit",
            "too many tokens",
            "input is too long",
        )
    )


def _classify_fallback_error(error: Exception) -> Optional[str]:
    if isinstance(error, InvalidSecretsV0Error):
        return "access"

    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return "availability"

    if isinstance(error, httpx.RequestError):
        return "availability"

    status_code = _error_status_code(error)
    if status_code in (401, 403):
        return "access"
    if status_code == 429:
        return "capacity"
    if status_code == 503 or (status_code is not None and 500 <= status_code <= 599):
        return "availability"
    if status_code in (400, 422) and _is_context_window_error(error):
        return "context"
    if status_code in (400, 404, 422):
        return "any"

    return None


def _classify_retry_error(error: Exception) -> Optional[str]:
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return "availability"

    if isinstance(error, httpx.RequestError):
        return "availability"

    status_code = _error_status_code(error)
    if status_code == 429:
        return "capacity"
    if status_code == 503 or (status_code is not None and 500 <= status_code <= 599):
        return "availability"
    if status_code in (409, 423):
        return "transient"

    if status_code is not None:
        return "any"

    return None


def _should_retry(
    error: Exception,
    retry_config: Optional[RetryConfig],
    retry_policy: Optional[RetryPolicy],
) -> bool:
    config = _coerce_retry_config(retry_config)
    policy = _coerce_retry_policy(retry_policy)
    if config.max_retries <= 0 or policy == RetryPolicy.OFF:
        return False

    category = _classify_retry_error(error)
    if category is None:
        return False

    allowed_categories = {
        RetryPolicy.AVAILABILITY: {"availability"},
        RetryPolicy.CAPACITY: {"availability", "capacity"},
        RetryPolicy.TRANSIENT: {"availability", "capacity", "transient"},
        RetryPolicy.ANY: {"availability", "capacity", "transient", "any"},
    }
    return category in allowed_categories.get(policy, set())


def _should_fallback(
    error: Exception, fallback_policy: Optional[FallbackPolicy]
) -> bool:
    policy = _coerce_fallback_policy(fallback_policy)
    if policy == FallbackPolicy.OFF:
        return False

    category = _classify_fallback_error(error)
    if category is None:
        return False

    allowed_categories = {
        FallbackPolicy.AVAILABILITY: {"availability"},
        FallbackPolicy.CAPACITY: {"availability", "capacity"},
        FallbackPolicy.ACCESS: {"availability", "capacity", "access"},
        FallbackPolicy.CONTEXT: {
            "availability",
            "capacity",
            "access",
            "context",
        },
        FallbackPolicy.ANY: {
            "availability",
            "capacity",
            "access",
            "context",
            "any",
        },
    }
    return category in allowed_categories.get(policy, set())


async def _run_prompt_llm_config_with_retry(
    formatted_prompt: PromptTemplate,
    llm_config: ModelConfig,
    retry_config: Optional[RetryConfig],
    retry_policy: Optional[RetryPolicy],
    messages: Optional[List[Message]] = None,
):
    config = _coerce_retry_config(retry_config)
    attempts = config.max_retries + 1
    last_error = None

    for attempt in range(attempts):
        try:
            provider_settings = SecretsManager.get_provider_settings_from_workflow(
                llm_config.model
            )

            if not provider_settings:
                raise InvalidSecretsV0Error(
                    expected="dict", got=provider_settings, model=llm_config.model
                )

            provider_settings = _apply_responses_bridge_if_needed(
                dict(provider_settings),
                llm_config=llm_config,
            )
            openai_kwargs = formatted_prompt.to_openai_kwargs(llm_config)

            if messages is not None:
                openai_kwargs["messages"] = [*openai_kwargs["messages"], *messages]

            with mockllm.user_aws_credentials_from(provider_settings):
                return await mockllm.acompletion(
                    **{k: v for k, v in openai_kwargs.items() if k != "model"},
                    **provider_settings,
                )
        except Exception as exc:
            last_error = exc
            if attempt >= attempts - 1 or not _should_retry(
                exc,
                retry_config=config,
                retry_policy=retry_policy,
            ):
                break
            if config.delay_ms > 0:
                await asyncio.sleep(config.delay_ms / 1000)

    raise last_error  # type: ignore[misc]


async def _run_prompt_with_fallback(
    formatted_prompt: PromptTemplate,
    messages: Optional[List[Message]] = None,
):
    llm_configs = _prompt_llm_configs(formatted_prompt)
    last_error = None

    for index, current_llm_config in enumerate(llm_configs):
        try:
            return await _run_prompt_llm_config_with_retry(
                formatted_prompt=formatted_prompt,
                llm_config=current_llm_config,
                retry_config=formatted_prompt.retry_config,
                retry_policy=formatted_prompt.retry_policy,
                messages=messages,
            )
        except Exception as exc:
            last_error = exc
            has_next_config = index < len(llm_configs) - 1
            if has_next_config and _should_fallback(
                exc, formatted_prompt.fallback_policy
            ):
                continue
            raise

    raise last_error  # type: ignore[misc]


@instrument(ignore_inputs=["parameters"])
async def completion_v0(
    parameters: Data,
    inputs: Dict[str, Any],
    #
) -> Any:
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(
            expected="dict",
            got=parameters,
        )

    if "prompt" not in parameters:
        raise MissingConfigurationParameterV0Error(path="prompt")

    if inputs is not None and not isinstance(inputs, dict):
        raise InvalidInputsV0Error(
            expected="dict",
            got=inputs,
        )

    _variables = dict(inputs or {})

    config = SinglePromptConfig(**parameters)

    if config.prompt.input_keys is not None:
        required_keys = set(config.prompt.input_keys)
        provided_keys = set(_variables.keys())

        if required_keys != provided_keys:
            raise InvalidInputsV0Error(
                expected=sorted(required_keys),
                got=sorted(provided_keys),
            )

    if inputs is not None:
        formatted_prompt = config.prompt.format(**_variables)
    else:
        formatted_prompt = config.prompt

    await SecretsManager.ensure_secrets_in_workflow()

    response = await _run_prompt_with_fallback(formatted_prompt)

    message = response.choices[0].message  # type: ignore

    if message.content is not None:
        return message.content
    if hasattr(message, "refusal") and message.refusal is not None:  # type: ignore
        return message.refusal  # type: ignore
    if hasattr(message, "parsed") and message.parsed is not None:  # type: ignore
        return message.parsed  # type: ignore
    if hasattr(message, "tool_calls") and message.tool_calls is not None:
        return [tool_call.dict() for tool_call in message.tool_calls]


@instrument(ignore_inputs=["parameters"])
async def chat_v0(
    parameters: Data,
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Message]] = None,
):
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(
            expected="dict",
            got=parameters,
        )

    if "prompt" not in parameters:
        raise MissingConfigurationParameterV0Error(path="prompt")

    if inputs is not None and not isinstance(inputs, dict):
        raise InvalidInputsV0Error(
            expected="dict",
            got=inputs,
        )

    _variables = dict(inputs or {})
    _messages = _variables.pop("messages", None)
    _messages = _messages if messages is None else messages

    config = SinglePromptConfig(**parameters)

    if config.prompt.input_keys is not None:
        required_keys = set(config.prompt.input_keys) - {"messages"}
        provided_keys = set(_variables.keys())

        if required_keys != provided_keys:
            raise InvalidInputsV0Error(
                expected=sorted(required_keys),
                got=sorted(provided_keys),
            )

        config.prompt = config.prompt.model_copy(
            update={"input_keys": sorted(required_keys)},
            deep=True,
        )

    if inputs is not None:
        formatted_prompt = config.prompt.format(**_variables)
    else:
        formatted_prompt = config.prompt

    await SecretsManager.ensure_secrets_in_workflow()

    response = await _run_prompt_with_fallback(formatted_prompt, messages=_messages)

    message = response.choices[0].message  # type: ignore

    return message.model_dump(exclude_none=True)  # type: ignore


@instrument(ignore_inputs=["parameters"])
async def hook_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    #
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    #
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Webhook-based application handler for CUSTOM app types.

    Forwards the request to an external webhook URL and returns the response.
    The webhook URL is read from the workflow interface (``url`` field in
    revision data), not from ``parameters``.

    Args:
        request: Optional canonical request envelope.
        revision: Optional revision data containing the webhook URL.
        parameters: Configuration parameters forwarded to the webhook.
        inputs: Inputs to forward to the webhook.
        outputs: Optional outputs to forward to the webhook.
        trace: Optional trace data to forward to the webhook.
        testcase: Optional testcase data to forward to the webhook.

    Returns:
        The response from the webhook.
    """
    from agenta.sdk.contexts.running import RunningContext

    def _extract_webhook_url(value: Optional[Data]) -> Optional[str]:
        if isinstance(value, dict):
            data = value.get("data") if "data" in value else value
            if isinstance(data, dict):
                url = data.get("url")
                return str(url) if url else None
        return None

    ctx = RunningContext.get()
    webhook_url = _extract_webhook_url(revision) or _extract_webhook_url(ctx.revision)

    if not webhook_url:
        raise MissingConfigurationParameterV0Error(path="url")

    webhook_url = str(webhook_url)
    try:
        _validate_webhook_url(webhook_url)
    except ValueError as exc:
        raise InvalidConfigurationParameterV0Error(
            path="url",
            expected="http/https URL",
            got=webhook_url,
        ) from exc

    json_payload = {
        "inputs": inputs or {},
        "parameters": parameters or {},
    }
    if outputs is not None:
        json_payload["outputs"] = outputs
    if trace is not None:
        json_payload["trace"] = trace
    if testcase is not None:
        json_payload["testcase"] = testcase

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url=webhook_url,
                json=json_payload,
                timeout=httpx.Timeout(30.0, connect=5.0),
            )
        except Exception as e:
            raise WebhookClientV0Error(
                message=str(e),
            ) from e

        if response.status_code != 200:
            try:
                message = response.json()
            except Exception:
                message = response.text
            raise WebhookServerV0Error(
                code=response.status_code,
                message=message,
            )

        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > _WEBHOOK_RESPONSE_MAX_BYTES:
            raise WebhookClientV0Error(message="Webhook response exceeded size limit.")

        response_bytes = response.content
        if len(response_bytes) > _WEBHOOK_RESPONSE_MAX_BYTES:
            raise WebhookClientV0Error(message="Webhook response exceeded size limit.")

        try:
            return json.loads(response_bytes)
        except Exception:
            return response_bytes.decode("utf-8")


def _resolve_reference_value(reference: Any, request: Dict[str, Any]) -> Any:
    """Resolve a reference that may be a JSONPath/Pointer selector or a literal value.

    Per design spec: if the string starts with '$' (JSONPath) or '/' (JSON Pointer),
    resolve it from the request context. Otherwise treat as a literal.
    """
    if not isinstance(reference, str):
        return reference
    if reference.startswith("$.") or reference == "$" or reference.startswith("$["):
        try:
            return resolve_json_path(reference, request)
        except Exception:
            return reference  # fall back to literal on resolution failure
    if reference.startswith("/"):
        try:
            return resolve_json_pointer(reference, request)
        except Exception:
            return reference
    return reference


def _make_match_result(
    success: bool,
    score: float,
    error: Optional[str] = None,
    children: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "success": success,
        "score": score,
        "error": error,
    }
    if children is not None:
        result.update(children)
    return result


def _execute_match_valid(actual: Any, mode: str) -> Tuple[bool, float]:
    """match=valid: check that the value at target conforms to mode."""
    if mode == "text":
        success = isinstance(actual, str)
    elif mode == "json":
        if isinstance(actual, (dict, list)):
            success = True
        elif isinstance(actual, str):
            try:
                json.loads(actual)
                success = True
            except json.JSONDecodeError:
                success = False
        else:
            success = False
    else:
        success = False
    return success, 1.0 if success else 0.0


def _coerce_to_str(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return str(value) if value is not None else ""


def _execute_match_exact(
    actual: Any,
    reference: Any,
    case_sensitive: bool,
) -> Tuple[bool, float]:
    """mode=exact: direct equality comparison."""
    actual_str = _coerce_to_str(actual)
    ref_str = _coerce_to_str(reference)
    if not case_sensitive:
        actual_str = actual_str.lower()
        ref_str = ref_str.lower()
    success = actual_str == ref_str
    return success, 1.0 if success else 0.0


def _execute_match_starts_with(
    actual: Any,
    reference: Any,
    case_sensitive: bool,
) -> Tuple[bool, float]:
    """mode=starts_with: prefix check."""
    actual_str = _coerce_to_str(actual)
    ref_str = _coerce_to_str(reference)
    if not case_sensitive:
        actual_str = actual_str.lower()
        ref_str = ref_str.lower()
    success = actual_str.startswith(ref_str)
    return success, 1.0 if success else 0.0


def _execute_match_ends_with(
    actual: Any,
    reference: Any,
    case_sensitive: bool,
) -> Tuple[bool, float]:
    """mode=ends_with: suffix check."""
    actual_str = _coerce_to_str(actual)
    ref_str = _coerce_to_str(reference)
    if not case_sensitive:
        actual_str = actual_str.lower()
        ref_str = ref_str.lower()
    success = actual_str.endswith(ref_str)
    return success, 1.0 if success else 0.0


def _execute_match_contains(
    actual: Any,
    reference: Any,
    references: Optional[List[Any]],
    match_mode: str,
    case_sensitive: bool,
) -> Tuple[bool, float]:
    """mode=contains: substring check, single or multi-value."""
    actual_str = _coerce_to_str(actual)
    if not case_sensitive:
        actual_str = actual_str.lower()

    if references:
        checks = []
        for ref in references:
            ref_str = _coerce_to_str(ref)
            if not case_sensitive:
                ref_str = ref_str.lower()
            checks.append(ref_str in actual_str)
        success = any(checks) if match_mode == "any" else all(checks)
    else:
        ref_str = _coerce_to_str(reference)
        if not case_sensitive:
            ref_str = ref_str.lower()
        success = ref_str in actual_str

    return success, 1.0 if success else 0.0


def _execute_match_regex(
    actual: Any,
    reference: Any,
    case_sensitive: bool,
) -> Tuple[bool, float]:
    """mode=regex: apply the reference as a regex pattern against the actual value."""
    # Coerce actual to string
    if isinstance(actual, str):
        actual_str = actual
    elif isinstance(actual, (dict, list)):
        actual_str = json.dumps(actual, sort_keys=True)
    else:
        actual_str = str(actual) if actual is not None else ""

    # Reference is the regex pattern (after resolution)
    if not isinstance(reference, str):
        pattern_str = str(reference) if reference is not None else ""
    else:
        pattern_str = reference

    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(pattern_str, flags=flags)
    except re.error as e:
        raise RegexPatternV0Error(pattern=pattern_str) from e

    matched = bool(pattern.search(actual_str))
    return matched, 1.0 if matched else 0.0


def _execute_match_similarity_sync(
    actual: Any,
    reference: Any,
    similarity: str,
    case_sensitive: bool,
) -> float:
    """match=similarity for jaccard and levenshtein similarities (synchronous)."""
    actual_str = (
        actual if isinstance(actual, str) else json.dumps(actual, sort_keys=True)
    )
    ref_str = (
        reference
        if isinstance(reference, str)
        else json.dumps(reference, sort_keys=True)
    )

    if not case_sensitive:
        actual_str = actual_str.lower()
        ref_str = ref_str.lower()

    if similarity == "jaccard":
        # Design note: named "jaccard" but uses SequenceMatcher for legacy parity
        matcher = SequenceMatcher(None, actual_str, ref_str)
        return float(matcher.ratio())

    elif similarity == "levenshtein":
        if len(ref_str) == 0:
            dist = len(actual_str)
        else:
            prev_row = list(range(len(ref_str) + 1))
            for i, c1 in enumerate(actual_str):
                curr_row = [i + 1]
                for j, c2 in enumerate(ref_str):
                    insert = prev_row[j + 1] + 1
                    delete = curr_row[j] + 1
                    substitute = prev_row[j] + (c1 != c2)
                    curr_row.append(min(insert, delete, substitute))
                prev_row = curr_row
            dist = prev_row[-1]
        max_len = max(len(actual_str), len(ref_str))
        return 1.0 if max_len == 0 else 1.0 - (dist / max_len)

    else:
        raise MatchV0Error(
            message=f"Unknown similarity metric: {similarity!r}. Expected 'jaccard', 'levenshtein', or 'cosine'."
        )


async def _execute_match_similarity_cosine(
    actual: Any,
    reference: Any,
    embedding_model: str,
) -> float:
    """mode=similarity with distance=cosine (async, requires OpenAI)."""
    actual_str = (
        actual if isinstance(actual, str) else json.dumps(actual, sort_keys=True)
    )
    ref_str = (
        reference
        if isinstance(reference, str)
        else json.dumps(reference, sort_keys=True)
    )

    secrets, _, _ = await SecretsManager.retrieve_secrets()

    openai_api_key = None
    if isinstance(secrets, list):
        for secret in secrets:
            if secret.get("kind") == "provider_key":
                secret_data = secret.get("data", {})
                if secret_data.get("kind") == "openai":
                    provider_data = secret_data.get("provider", {})
                    openai_api_key = provider_data.get("key") or openai_api_key

    AsyncOpenAI, OpenAIError = _load_openai()
    try:
        openai = AsyncOpenAI(api_key=openai_api_key)
    except OpenAIError as e:
        raise OpenAIError("OpenAIException - " + e.args[0])

    output_embedding = await _compute_embedding(openai, embedding_model, actual_str)
    reference_embedding = await _compute_embedding(openai, embedding_model, ref_str)
    return float(_compute_similarity(output_embedding, reference_embedding))


def _execute_match_diff(
    target: Any,
    reference: Any,
    diff: str,
    case_sensitive: bool,
) -> float:
    """match=diff: scored comparison over flattened JSON fields."""
    # Parse JSON strings if needed
    if isinstance(target, str):
        try:
            target = json.loads(target)
        except json.JSONDecodeError:
            return 0.0
    if isinstance(reference, str):
        try:
            reference = json.loads(reference)
        except json.JSONDecodeError:
            return 0.0

    if not isinstance(target, (dict, list)) or not isinstance(reference, (dict, list)):
        return 0.0

    settings = {
        "compare_schema_only": diff == "schema",
        "predict_keys": diff == "strict",
        "case_insensitive_keys": not case_sensitive,
    }
    return _compare_jsons(
        ground_truth=reference,
        app_output=target,
        settings_values=settings,
    )


def _aggregate_child_results(
    child_matchers: List[Dict],
    child_results: List[Dict],
    score: str,
    success: str,
    threshold: float,
) -> Tuple[bool, float]:
    """Aggregate child matcher results.

    Score aggregation (score):
      - "weighted" → weighted mean (weight per matcher, defaults to 1)
      - "min"      → minimum child score
      - "max"      → maximum child score

    Success aggregation (success):
      - "all"       → all child successes must be True
      - "any"       → at least one child success must be True
      - "threshold" → aggregated score >= threshold
    """
    if not child_results:
        return True, 1.0

    scores = [r["score"] for r in child_results]
    if score == "min":
        agg_score = min(scores)
    elif score == "max":
        agg_score = max(scores)
    else:  # "weighted" or default
        weights = [float(m.get("weight", 1.0)) for m in child_matchers]
        total_weight = sum(weights) if sum(weights) > 0 else 1.0
        agg_score = sum(s * w for s, w in zip(scores, weights)) / total_weight

    successes = [r["success"] for r in child_results]
    if success == "any":
        agg_success = any(successes)
    elif success == "threshold":
        agg_success = agg_score >= threshold
    else:  # "all" or default
        agg_success = all(successes)

    return agg_success, agg_score


async def _execute_match_node(
    matcher: Dict[str, Any],
    request: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute a single matcher node, recursing into children when present."""
    target = str(matcher.get("target", ""))
    mode = str(matcher.get("mode", "text"))
    match_type = str(matcher.get("match", "valid"))
    case_sensitive = matcher.get("case_sensitive", True) is True
    threshold = float(matcher.get("threshold", 1.0))

    # Execute child matchers depth-first
    child_matchers: List[Dict] = matcher.get("matchers") or []
    children: Dict[str, Any] = {}
    for child in child_matchers:
        child_result = await _execute_match_node(child, request)
        children[str(child.get("key", ""))] = child_result

    # Resolve the actual value at target path
    try:
        actual = resolve_any(target, request)
    except Exception as e:
        return _make_match_result(
            False,
            0.0,
            error=f"Target resolution failed for '{target}': {e}",
            children=children or None,
        )

    # If node has children, aggregate and return (own mode provides context only)
    if children:
        score_agg = str(matcher.get("score", "weighted"))
        success_agg = str(matcher.get("success", "threshold"))
        agg_success, agg_score = _aggregate_child_results(
            child_matchers, list(children.values()), score_agg, success_agg, threshold
        )
        return _make_match_result(agg_success, agg_score, children=children)

    # No children: execute own mode
    reference_expr = matcher.get("reference")
    reference: Any = None
    if reference_expr is not None:
        reference = _resolve_reference_value(reference_expr, request)

    # Resolve multi-value reference list
    references_exprs: Optional[List] = matcher.get("references")
    references: Optional[List[Any]] = None
    if references_exprs is not None:
        references = [_resolve_reference_value(s, request) for s in references_exprs]

    contains_mode = str(matcher.get("contains", "all"))

    try:
        if match_type == "valid":
            success, score = _execute_match_valid(actual, mode)

        elif match_type == "exact":
            success, score = _execute_match_exact(actual, reference, case_sensitive)

        elif match_type == "starts_with":
            success, score = _execute_match_starts_with(
                actual, reference, case_sensitive
            )

        elif match_type == "ends_with":
            success, score = _execute_match_ends_with(actual, reference, case_sensitive)

        elif match_type == "contains":
            success, score = _execute_match_contains(
                actual, reference, references, contains_mode, case_sensitive
            )

        elif match_type == "regex":
            success, score = _execute_match_regex(actual, reference, case_sensitive)

        elif match_type == "similarity":
            similarity = str(matcher.get("similarity", "jaccard"))
            if similarity == "cosine":
                embedding_model = "text-embedding-3-small"
                score = await _execute_match_similarity_cosine(
                    actual, reference, embedding_model
                )
            else:
                score = _execute_match_similarity_sync(
                    actual, reference, similarity, case_sensitive
                )
            success = score >= threshold

        elif match_type == "diff":
            diff_mode = str(matcher.get("diff", "full"))
            score = _execute_match_diff(
                actual,
                reference,
                diff_mode,
                case_sensitive,
            )
            success = score >= threshold

        else:
            raise MatchV0Error(
                message=f"Unknown match: {match_type!r}. Expected one of: 'valid', 'exact', 'starts_with', 'ends_with', 'contains', 'regex', 'similarity', 'diff'."
            )

        return _make_match_result(success, score)

    except ErrorStatus as e:
        return _make_match_result(False, 0.0, error=e.message)
    except Exception as e:
        return _make_match_result(False, 0.0, error=str(e))


# --- NEW URI


@instrument()
async def feedback_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Interface-only handler for agenta:custom:feedback:v0.

    Unified handler for invocation/annotation workflows where the response
    (app output or human annotation) arrives via external links rather than
    a direct return value.

    This URI exists as a schema/interface registry entry only.
    It cannot be invoked directly.
    """
    raise FeedbackV0Error(
        message="agenta:custom:feedback:v0 is interface-only and cannot be invoked directly.",
    )


@instrument(ignore_inputs=["parameters"])
async def code_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    #
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    #
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Code evaluator using the canonical evaluate(inputs, outputs, trace) interface.

    Executes ``parameters["code"]`` as ``evaluate(inputs, outputs, trace)``
    and normalises the return value to a typed evaluation result.

    Parameters:
        code:      Python (or JS/TS) source containing an ``evaluate`` function.
        runtime:   Execution runtime — ``"python"`` (default), ``"javascript"``,
                   or ``"typescript"``.
        threshold: Score threshold for success when the code returns a number.
                   Defaults to 0.5.

    Returns:
        ``{"score": float, "success": bool}``  when code returns a number.
        ``{"success": bool}``                  when code returns a bool.
        The raw dict / str                     when code returns one of those.
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if "code" not in parameters:
        raise MissingConfigurationParameterV0Error(path="code")

    code = str(parameters["code"])
    runtime = str(parameters.get("runtime") or "python")

    if runtime not in ["python", "javascript", "typescript"]:
        raise InvalidConfigurationParameterV0Error(
            path="runtime",
            expected=["python", "javascript", "typescript"],
            got=runtime,
        )

    threshold = float(parameters.get("threshold") or 0.5)

    if outputs is not None and not isinstance(outputs, (str, dict)):
        raise InvalidOutputsV0Error(expected=["dict", "str", "None"], got=outputs)

    try:
        _result = execute_code_safely(
            app_params={},
            inputs=inputs or {},
            output=outputs,
            correct_answer=None,
            code=code,
            runtime=runtime,
            templates=EVALUATOR_TEMPLATES.get("v1", {}),
            version="2",
            trace=trace,
        )
    except ErrorStatus:
        raise
    except Exception as e:
        raise CodeV0Error(
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e

    if isinstance(_result, bool):
        return {"success": _result}

    if isinstance(_result, (int, float)):
        score = float(_result)
        return {"score": score, "success": score >= threshold}

    if isinstance(_result, (dict, str)):
        return _result

    raise InvalidOutputsV0Error(
        expected=["dict", "str", "int", "float", "bool"], got=_result
    )


@instrument()
@instrument()
async def config_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Interface-only handler for agenta:custom:config:v0.

    Configurations are not directly invocable.
    """
    raise ConfigV0Error(
        message="agenta:custom:config:v0 is not runnable.",
    )


async def match_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Match evaluator with recursive matcher tree (agenta:builtin:match:v0).

    Consolidates the following legacy builtin evaluators:
    - auto_exact_match     → mode="text", match="exact", string=ESCAPED_VALUE
    - auto_regex_test      → mode="text", match="regex"
    - auto_starts_with     → mode="text", match="regex", string="^PREFIX"
    - auto_ends_with       → mode="text", match="regex", string="SUFFIX$"
    - auto_contains        → mode="text", match="regex", string="SUBSTRING"
    - auto_contains_any    → mode="text", match="regex", string="(OPT1|OPT2|...)"
    - auto_contains_all    → mode="text", match="regex", string="(?=.*S1)(?=.*S2).*"
    - auto_similarity_match    → mode="text", match="similarity", similarity="jaccard"
    - auto_semantic_similarity → mode="text", match="similarity", similarity="cosine"
    - auto_levenshtein_distance → mode="text", match="similarity", similarity="levenshtein"
    - field_match_test     → mode="text", match="regex", target="$.outputs.FIELD"
    - json_multi_field_match → mode="json", match="diff" + child matchers
    - auto_contains_json   → mode="json", match="valid"
    - auto_json_diff       → mode="json", match="diff"

    Parameters:
        parameters: {"matchers": [...]}  — recursive matcher tree
        inputs:     testcase inputs (accessible as $.inputs.*)
        outputs:    workflow outputs (accessible as $.outputs or $.outputs.*)
        trace:      trace data (accessible as $.trace.*)

    Returns:
        {key: result_node, ..., "score": float, "success": bool}  — flat result dict
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if "matchers" not in parameters:
        raise MissingConfigurationParameterV0Error(path="matchers")

    matchers = parameters["matchers"]
    if not isinstance(matchers, list):
        raise InvalidConfigurationParameterV0Error(
            path="matchers", expected="list", got=matchers
        )

    # Build request context for path resolution
    request: Dict[str, Any] = {}
    if inputs is not None:
        request["inputs"] = inputs
    if outputs is not None:
        request["outputs"] = outputs
    if trace is not None:
        request["trace"] = trace

    score_agg = str(parameters.get("score", "weighted"))
    success_agg = str(parameters.get("success", "threshold"))
    threshold = float(parameters.get("threshold", 1.0))

    results: Dict[str, Any] = {}
    for matcher in matchers:
        result = await _execute_match_node(matcher, request)
        results[str(matcher.get("key", ""))] = result

    if not results:
        return {"score": 1.0, "success": True}

    scores = [r["score"] for r in results.values()]
    if score_agg == "min":
        root_score = min(scores)
    elif score_agg == "max":
        root_score = max(scores)
    else:  # "weighted"
        weights = [float(m.get("weight", 1.0)) for m in matchers]
        total_weight = sum(weights) if sum(weights) > 0 else 1.0
        root_score = sum(s * w for s, w in zip(scores, weights)) / total_weight

    successes = [r["success"] for r in results.values()]
    if success_agg == "any":
        root_success = any(successes)
    elif success_agg == "threshold":
        root_success = root_score >= threshold
    else:  # "all"
        root_success = all(successes)

    return {
        **results,
        "score": root_score,
        "success": root_success,
    }


# ---------------------------------------------------------------------------
# llm_v0 helpers
# ---------------------------------------------------------------------------


def _merge_usage(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two LiteLLM usage dicts by summing numeric fields."""
    result = dict(a)
    for k, v in b.items():
        if isinstance(v, (int, float)):
            result[k] = result.get(k, 0) + v
        else:
            result[k] = v
    return result


def _merge_consent(
    param_consent: Optional[Dict[str, Any]],
    input_consent: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Merge parameter-level consent policy with per-run consent input.
    Returns None when both are absent (no consent gate).
    """
    if param_consent is None and not input_consent:
        return None
    base = dict(param_consent or {})
    override = dict(input_consent or {})
    # Merge decisions by key
    base_decisions = dict(base.get("decisions") or {})
    override_decisions = dict(override.get("decisions") or {})
    merged = {**base, **override, "decisions": {**base_decisions, **override_decisions}}
    return merged


def _apply_variables(
    messages: List[Dict[str, Any]],
    variables: Dict[str, Any],
    template_format: str,
) -> List[Dict[str, Any]]:
    """Apply template variable substitution to message content strings."""
    if not variables:
        return messages
    result = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            try:
                content = _format_with_template(
                    content=content,
                    format=template_format,
                    kwargs=variables,
                )
            except Exception as e:
                raise PromptFormattingV0Error(
                    message=str(e),
                    stacktrace=traceback.format_exc(),
                ) from e
        result.append({**msg, "content": content})
    return result


def _build_llm_tools(tools_config: Optional[Dict[str, Any]]) -> Optional[List[Dict]]:
    """Convert tools config into a litellm-compatible tools list."""
    if not tools_config:
        return None
    internal_names: List[str] = list(tools_config.get("internal") or [])
    external_defs: List[Dict] = list(tools_config.get("external") or [])
    tool_defs = list(external_defs)
    # Register built-in internal tool schemas
    _INTERNAL_TOOL_SCHEMAS: Dict[str, Dict] = {
        "files.list": {
            "type": "function",
            "function": {
                "name": "files.list",
                "description": "List files in a directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "default": "."},
                        "pattern": {"type": "string"},
                    },
                },
            },
        },
        "files.read": {
            "type": "function",
            "function": {
                "name": "files.read",
                "description": "Read the contents of a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                    },
                    "required": ["path"],
                },
            },
        },
        "files.search": {
            "type": "function",
            "function": {
                "name": "files.search",
                "description": "Search for text in files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "path": {"type": "string", "default": "."},
                    },
                    "required": ["query"],
                },
            },
        },
        "control.terminate": {
            "type": "function",
            "function": {
                "name": "control.terminate",
                "description": "Signal that the agent considers the run complete.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                    },
                },
            },
        },
        "control.request_consent": {
            "type": "function",
            "function": {
                "name": "control.request_consent",
                "description": "Ask the caller to collect consent for an internal tool call.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tool_call_id": {"type": "string"},
                        "tool_name": {"type": "string"},
                        "arguments": {},
                        "reason": {"type": "string"},
                    },
                    "required": ["tool_call_id", "tool_name"],
                },
            },
        },
    }
    for name in internal_names:
        schema = _INTERNAL_TOOL_SCHEMAS.get(name)
        if schema:
            tool_defs.append(schema)
    return tool_defs or None


async def _execute_internal_tool(
    name: str,
    arguments: Dict[str, Any],
    files_config: Optional[Dict[str, Any]],
    context: Dict[str, Any],
) -> Any:
    """Execute an internal tool and return its result."""
    import glob as _glob
    import os as _os

    fc = files_config or {}
    roots: List[str] = list(fc.get("roots") or ["."])
    allow_globs: List[str] = list(fc.get("allow_globs") or ["**/*"])
    deny_globs: List[str] = list(fc.get("deny_globs") or [])
    max_file_bytes: int = int(fc.get("max_file_bytes") or 65536)
    max_total_bytes: int = int(fc.get("max_total_bytes_per_turn") or 262144)
    include_hidden: bool = bool(fc.get("include_hidden", False))

    def _is_allowed(path: str) -> bool:
        import fnmatch

        if not include_hidden:
            parts = path.replace("\\", "/").split("/")
            if any(p.startswith(".") for p in parts):
                return False
        allowed = any(fnmatch.fnmatch(path, pat) for pat in allow_globs)
        denied = any(fnmatch.fnmatch(path, pat) for pat in deny_globs)
        return allowed and not denied

    if name == "files.list":
        path = str(arguments.get("path") or ".")
        pattern = str(arguments.get("pattern") or "**/*")
        results = []
        for root in roots:
            search_root = _os.path.join(root, path)
            for match in _glob.glob(
                _os.path.join(search_root, pattern), recursive=True
            ):
                rel = _os.path.relpath(match, root)
                if _is_allowed(rel) and _os.path.isfile(match):
                    results.append(rel)
        return {"files": results}

    if name == "files.read":
        path = str(arguments.get("path") or "")
        for root in roots:
            full = _os.path.join(root, path)
            if not _os.path.isfile(full):
                continue
            rel = _os.path.relpath(full, root)
            if not _is_allowed(rel):
                return {"error": f"Access denied: {path}"}
            size = _os.path.getsize(full)
            if size > max_file_bytes:
                return {
                    "error": f"File too large: {size} bytes (limit {max_file_bytes})"
                }
            with open(full, "r", encoding="utf-8", errors="replace") as fh:
                return {"path": path, "content": fh.read()}
        return {"error": f"File not found: {path}"}

    if name == "files.search":
        query = str(arguments.get("query") or "")
        path = str(arguments.get("path") or ".")
        matches = []
        total_bytes = 0
        for root in roots:
            search_root = _os.path.join(root, path)
            for fpath in _glob.glob(_os.path.join(search_root, "**/*"), recursive=True):
                if not _os.path.isfile(fpath):
                    continue
                rel = _os.path.relpath(fpath, root)
                if not _is_allowed(rel):
                    continue
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                        for lineno, line in enumerate(fh, 1):
                            if query in line:
                                entry = f"{rel}:{lineno}: {line.rstrip()}"
                                total_bytes += len(entry)
                                if total_bytes > max_total_bytes:
                                    return {"matches": matches, "truncated": True}
                                matches.append(entry)
                except OSError:
                    continue
        return {"matches": matches}

    return {"error": f"Unknown internal tool: {name}"}


def _first_without_consent(
    tool_calls: List[Dict[str, Any]],
    consent_state: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Return the first tool call that lacks consent, or None if all are approved."""
    if consent_state is None:
        return None
    mode = consent_state.get("mode") or "per_call"
    if mode == "allow_all":
        return None
    if mode == "deny_all":
        return tool_calls[0] if tool_calls else None
    allowed_tools: List[str] = list(consent_state.get("allowed_tools") or [])
    denied_tools: List[str] = list(consent_state.get("denied_tools") or [])
    decisions: Dict[str, Any] = dict(consent_state.get("decisions") or {})
    for tc in tool_calls:
        fn_name = (tc.get("function") or {}).get("name", "")
        if fn_name in denied_tools:
            return tc
        if fn_name in allowed_tools:
            continue
        tc_id = tc.get("id", "")
        decision = decisions.get(tc_id) or decisions.get(fn_name)
        if not decision or decision.get("decision") != "allow":
            return tc
    return None


def _make_consent_request_call(missing: Dict[str, Any]) -> Dict[str, Any]:
    """Construct a control.request_consent tool call for a missing-consent internal call."""
    fn = missing.get("function") or {}
    return {
        "id": f"consent_{missing.get('id', 'unknown')}",
        "type": "function",
        "function": {
            "name": "control.request_consent",
            "arguments": json.dumps(
                {
                    "tool_call_id": missing.get("id", ""),
                    "tool_name": fn.get("name", ""),
                    "arguments": fn.get("arguments", "{}"),
                }
            ),
        },
    }


async def _call_llm_with_fallback(
    llms: List[Dict[str, Any]],
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict]],
) -> tuple:
    """
    Try each LLM entry in order.
    Falls back on authentication, rate limit, and availability errors.
    Returns (assistant_message_dict, usage_dict).
    Raises LLMUnavailableV0Error if all entries fail.
    """
    from agenta.sdk.engines.running.errors import LLMUnavailableV0Error

    litellm = _load_litellm()
    if not litellm:
        raise ImportError("litellm is required for llm_v0.")

    _retriable = tuple(
        cls
        for name in (
            "AuthenticationError",
            "RateLimitError",
            "ServiceUnavailableError",
            "NotFoundError",
        )
        if (cls := getattr(litellm, name, None)) is not None
    )

    secrets, _, _ = await SecretsManager.retrieve_secrets()
    if secrets and isinstance(secrets, list):
        for secret in secrets:
            if secret.get("kind") != "provider_key":
                continue
            data = secret.get("data", {})
            kind = data.get("kind")
            key = data.get("provider", {}).get("key")
            if kind == "openai" and key:
                litellm.openai_key = key
            elif kind == "anthropic" and key:
                litellm.anthropic_key = key
            elif kind == "openrouter" and key:
                litellm.openrouter_key = key
            elif kind == "cohere" and key:
                litellm.cohere_key = key
            elif kind == "azure" and key:
                litellm.azure_key = key
            elif kind == "groq" and key:
                litellm.groq_key = key

    last_error = None
    for llm_config in llms:
        model = llm_config.get("model")
        if not model:
            continue
        kwargs: Dict[str, Any] = {"model": str(model), "messages": messages}
        if tools:
            kwargs["tools"] = tools
            if llm_config.get("tool_choice"):
                kwargs["tool_choice"] = llm_config["tool_choice"]
        for field in (
            "temperature",
            "max_tokens",
            "top_p",
            "frequency_penalty",
            "presence_penalty",
            "reasoning_effort",
            "chat_template_kwargs",
        ):
            val = llm_config.get(field)
            if val is not None:
                kwargs[field] = val
        try:
            response = await litellm.acompletion(**kwargs)
            msg = response.choices[0].message
            assistant_message = (
                msg.model_dump(exclude_none=True)
                if hasattr(msg, "model_dump")
                else dict(msg)
            )
            usage = (
                dict(response.usage)
                if hasattr(response, "usage") and response.usage
                else {}
            )
            return assistant_message, usage
        except _retriable as exc:
            last_error = exc
            continue
        except Exception:
            raise

    raise LLMUnavailableV0Error(
        message=f"All LLM entries exhausted. Last error: {last_error}"
    )


# ---------------------------------------------------------------------------
# llm_v0 — unified prompt + agent handler
# ---------------------------------------------------------------------------


@instrument()
async def llm_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    """
    Unified LLM handler covering single-call prompt mode and multi-step agent loop.

    Parameters (stored per revision):
        llms:            Ordered list of LLM configs. Runtime tries each in order on
                         auth / rate-limit / availability errors.
        messages:        System/initial messages. Template substitution applied.
        template_format: "curly" (default), "fstring", or "jinja2".
        loop:            null → single LLM call (prompt mode).
                         dict → agent loop config with max_iterations etc.
        tools:           {"internal": [...], "external": [...]}. null → no tools.
        consent:         Consent policy dict. null → auto-approve all internal tools.
        response:        {"stream": false}.

    Inputs (per invocation):
        messages:   Incremental messages appended after parameters.messages.
        variables:  Template variables substituted into all messages.
        context:    Structured context merged with parameters.context.
        consent:    Consent decisions merged with parameters.consent.

    Returns always:
        {
            "status":  {"code": int, "type": str, "message": str},
            "messages": [...],   # full message history
            "context":  {...},
            "consent":  {...},
            "usage":    {...},
        }
    """
    from agenta.sdk.engines.running.errors import LLMUnavailableV0Error

    # --- Validate parameters
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    llms = parameters.get("llms")
    if not llms or not isinstance(llms, list):
        raise InvalidConfigurationParameterV0Error(
            path="llms", expected="non-empty list", got=llms
        )

    param_messages: List[Dict] = Messages.model_validate(
        parameters.get("messages") or []
    ).model_dump(exclude_none=True)
    template_format = str(parameters.get("template_format") or "curly")
    loop_config: Optional[Dict] = parameters.get("loop")
    tools_config: Optional[Dict] = parameters.get("tools")
    param_consent: Optional[Dict] = parameters.get("consent")
    param_context: Dict = dict(parameters.get("context") or {})

    # --- Parse inputs
    run_inputs: Dict = dict(inputs or {})
    if inputs is not None and not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    input_messages: List[Dict] = Messages.model_validate(
        run_inputs.get("messages") or []
    ).model_dump(exclude_none=True)
    variables: Dict = dict(run_inputs.get("variables") or {})
    input_context: Dict = dict(run_inputs.get("context") or {})
    input_consent: Optional[Dict] = run_inputs.get("consent")

    # --- Apply template variables and build message list
    fmt_param_messages = _apply_variables(param_messages, variables, template_format)
    fmt_input_messages = _apply_variables(input_messages, variables, template_format)
    all_messages: List[Dict] = [*fmt_param_messages, *fmt_input_messages]

    # --- Merge context and consent
    context: Dict = {**param_context, **input_context}
    consent_state: Optional[Dict] = _merge_consent(param_consent, input_consent)

    usage: Dict[str, Any] = {}

    # =========================================================================
    # PROMPT MODE: loop = null → single LLM call, return immediately
    # =========================================================================
    if loop_config is None:
        try:
            assistant_message, call_usage = await _call_llm_with_fallback(
                llms=llms,
                messages=all_messages,
                tools=_build_llm_tools(tools_config),
            )
        except LLMUnavailableV0Error:
            raise
        usage = _merge_usage(usage, call_usage)
        return {
            "status": {"code": 200, "type": "success", "message": "completed"},
            "messages": [*all_messages, assistant_message],
            "context": context,
            "consent": consent_state or {},
            "usage": usage,
        }

    # =========================================================================
    # AGENT MODE: loop present → multi-step loop
    # =========================================================================
    max_iterations = int(loop_config.get("max_iterations") or 8)
    max_internal_calls = int(loop_config.get("max_internal_tool_calls") or 16)
    max_consecutive_errors = int(loop_config.get("max_consecutive_errors") or 2)
    allow_implicit_stop = bool(loop_config.get("allow_implicit_stop", True))

    internal_names: set = set(list((tools_config or {}).get("internal") or []))
    external_names: set = set(list((tools_config or {}).get("external") or []))

    state: Dict[str, Any] = {
        "messages": all_messages,
        "context": context,
        "consent": consent_state,
        "iterations": 0,
        "internal_tool_calls": 0,
        "consecutive_errors": 0,
    }

    def _envelope(status_code: int, status_type: str, status_message: str) -> Dict:
        return {
            "status": {
                "code": status_code,
                "type": status_type,
                "message": status_message,
            },
            "messages": state["messages"],
            "context": state["context"],
            "consent": state["consent"] or {},
            "usage": usage,
        }

    while True:
        if state["iterations"] >= max_iterations:
            return _envelope(500, "failure", "iterations_exhausted")
        if state["internal_tool_calls"] >= max_internal_calls:
            return _envelope(500, "failure", "calls_exhausted")

        state["iterations"] += 1

        try:
            assistant_message, call_usage = await _call_llm_with_fallback(
                llms=llms,
                messages=state["messages"],
                tools=_build_llm_tools(tools_config),
            )
            state["consecutive_errors"] = 0
        except LLMUnavailableV0Error:
            return _envelope(503, "failure", "llm_unavailable")
        except Exception:
            state["consecutive_errors"] += 1
            if state["consecutive_errors"] >= max_consecutive_errors:
                return _envelope(500, "failure", "error_raised")
            continue

        usage = _merge_usage(usage, call_usage)
        state["messages"] = [*state["messages"], assistant_message]

        tool_calls: List[Dict] = list(assistant_message.get("tool_calls") or [])

        # No tool calls
        if not tool_calls:
            if allow_implicit_stop:
                return _envelope(200, "success", "completed")
            continue

        # control.terminate
        if any(
            (tc.get("function") or {}).get("name") == "control.terminate"
            for tc in tool_calls
        ):
            return _envelope(200, "success", "completed")

        # Classify tool calls
        external_calls = [
            tc
            for tc in tool_calls
            if (tc.get("function") or {}).get("name") in external_names
        ]
        internal_calls = [
            tc
            for tc in tool_calls
            if (tc.get("function") or {}).get("name") in internal_names
        ]

        # External tool calls → pause and return to caller
        if external_calls:
            return _envelope(202, "awaiting", "tool_requested")

        # Consent gate for internal tools
        if state["consent"] is not None:
            missing = _first_without_consent(internal_calls, state["consent"])
            if missing:
                consent_call = _make_consent_request_call(missing)
                last = dict(state["messages"][-1])
                last_tool_calls = list(last.get("tool_calls") or []) + [consent_call]
                state["messages"] = [
                    *state["messages"][:-1],
                    {**last, "tool_calls": last_tool_calls},
                ]
                return _envelope(202, "awaiting", "consent_requested")

        # Execute internal tools
        for tc in internal_calls:
            fn = tc.get("function") or {}
            fn_name = fn.get("name", "")
            try:
                fn_args = json.loads(fn.get("arguments") or "{}")
            except (json.JSONDecodeError, ValueError):
                fn_args = {}
            result = await _execute_internal_tool(
                name=fn_name,
                arguments=fn_args,
                files_config=parameters.get("files"),
                context=state["context"],
            )
            state["internal_tool_calls"] += 1
            state["messages"] = [
                *state["messages"],
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": json.dumps(result)
                    if not isinstance(result, str)
                    else result,
                },
            ]
