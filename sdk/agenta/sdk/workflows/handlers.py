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
from agenta.sdk.types import PromptTemplate, Message
from agenta.sdk.managers.secrets import SecretsManager
from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.models.shared import Data
from agenta.sdk.workflows.sandbox import execute_code_safely
from agenta.sdk.workflows.templates import EVALUATOR_TEMPLATES
from agenta.sdk.workflows.errors import (
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
        if _is_blocked_ip(ip):
            raise ValueError("Webhook URL resolves to a blocked IP range.")
        return
    except ValueError:
        pass

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
    json_path, _ = _load_jsonpath()
    if json_path is None:
        raise ImportError("python-jsonpath is required for json-path ($...)")

    if not (expr == "$" or expr.startswith("$.") or expr.startswith("$[")):
        raise ValueError(
            f"Invalid json-path expression {expr!r}. "
            "Must start with '$', '$.' or '$[' (no implicit normalization)."
        )

    # Use package-level APIf
    results = json_path.findall(expr, data)  # always returns a list
    return results[0] if len(results) == 1 else results


def resolve_json_pointer(expr: str, data: Dict[str, Any]) -> Any:
    """Resolve a JSON Pointer; returns a single value."""
    _, json_pointer = _load_jsonpath()
    if json_pointer is None:
        raise ImportError("python-jsonpath is required for json-pointer (/...)")
    return json_pointer(expr).resolve(data)


def resolve_any(expr: str, data: Dict[str, Any]) -> Any:
    """Dispatch to the right resolver based on detected scheme."""
    scheme = detect_scheme(expr)
    if scheme == "json-path":
        return resolve_json_path(expr, data)
    if scheme == "json-pointer":
        return resolve_json_pointer(expr, data)
    return resolve_dot_notation(expr, data)


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


@instrument(annotate=True)
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

    if "correct_answer_key" not in parameters:
        raise MissingConfigurationParameterV0Error(path="correct_answer_key")

    correct_answer_key = str(parameters["correct_answer_key"])

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=inputs)

    if correct_answer_key not in inputs:
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


@instrument(annotate=True)
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


@instrument(annotate=True)
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
    formatted_prompt: PromptTemplate, provider_settings: Dict
) -> Dict:
    """
    Checks if web_search_preview tool is present and applies responses bridge if needed.

    If a web_search_preview, code_execution, or mcp tool is detected, this function
    modifies the provider_settings to use the responses bridge by prepending
    'openai/responses/' to the model name.

    Args:
        formatted_prompt: The formatted prompt template containing LLM config and tools
        provider_settings: The provider settings dictionary that may be modified

    Returns:
        The provider_settings dictionary, potentially modified to use responses bridge
    """
    tools = formatted_prompt.llm_config.tools
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


@instrument(ignore_inputs=["parameters"])
async def completion_v0(
    parameters: Data,
    inputs: Dict[str, str],
) -> Any:
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidConfigurationParametersV0Error(expected="dict", got=parameters)

    if "prompt" not in parameters:
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
        model = getattr(
            getattr(getattr(config, "prompt", None), "llm_config", None), "model", None
        )
        raise InvalidSecretsV0Error(expected="dict", got=provider_settings, model=model)

    formatted_prompt = config.prompt.format(**inputs)

    provider_settings = _apply_responses_bridge_if_needed(
        formatted_prompt, provider_settings
    )

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v
                for k, v in formatted_prompt.to_openai_kwargs().items()
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


@instrument(ignore_inputs=["parameters"])
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
        model = getattr(
            getattr(getattr(config, "prompt", None), "llm_config", None), "model", None
        )
        raise InvalidSecretsV0Error(expected="dict", got=provider_settings, model=model)

    provider_settings = _apply_responses_bridge_if_needed(
        formatted_prompt, provider_settings
    )

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v for k, v in openai_kwargs.items() if k != "model"
            },  # we should use the model_name from provider_settings
            **provider_settings,
        )

    return response.choices[0].message.model_dump(exclude_none=True)  # type: ignore


@instrument(ignore_inputs=["parameters"])
async def hook_v0(
    parameters: Optional[Data] = None,
    inputs: Optional[Data] = None,
) -> Any:
    """
    Webhook-based application handler for CUSTOM app types.

    Forwards the request to an external webhook URL and returns the response.
    The webhook URL is read from the workflow interface (``url`` field in
    revision data), not from ``parameters``.

    Args:
        parameters: Configuration parameters forwarded to the webhook.
        inputs: Inputs to forward to the webhook.

    Returns:
        The response from the webhook.
    """
    from agenta.sdk.contexts.running import RunningContext

    ctx = RunningContext.get()
    webhook_url = ctx.interface.url if ctx.interface else None

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
