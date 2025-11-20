import re
import json
import httpx
import traceback
from json import dumps, loads
from typing import Optional, Any

import litellm
import numpy as np
from openai import AsyncOpenAI
from difflib import SequenceMatcher
from numpy._core._multiarray_umath import array
from autoevals.ragas import Faithfulness, ContextRelevancy

from oss.src.services.security import sandbox

from oss.src.utils.traces import (
    remove_trace_prefix,
    process_distributed_trace_into_trace_tree,
    get_field_value_from_trace_tree,
)

from oss.src.utils.logging import get_module_logger

from oss.src.apis.fastapi.workflows.models import (
    WorkflowServiceRequest,
    WorkflowRevision,
)

from oss.src.core.workflows.dtos import (
    Data,
    Trace,
    Tree,
    VersionedTree,
)

from oss.src.core.workflows.errors import (
    InvalidParametersV0Error,
    InvalidCredentialsV0Error,
    InvalidParameterPathV0Error,
    MissingParametersPathV0Error,
    InvalidInputsV0Error,
    MissingInputsPathV0Error,
    InvalidTraceOutputsV0Error,
    MissingTraceOutputsPathV0Error,
    InvalidOutputsV0Error,
    MissingOutputsPathV0Error,
    InvalidCredentialsV0Error,
    InvalidSecretsV0Error,
    MissingSecretsPathV0Error,
    WebhookServerV0Error,
    WebhookClientV0Error,
    CustomCodeServerV0Error,
    RegexPatternV0Error,
    PromptFormattingV0Error,
    PromptCompletionV0Error,
)

from oss.src.core.workflows.helpers import compare_jsons


log = get_module_logger(__name__)


async def _compute_embedding(openai: Any, model: str, input: str):
    response = await openai.embeddings.create(model=model, input=input)

    return np.array(response.data[0].embedding)


def _compute_similarity(embedding_1: array, embedding_2: array) -> float:
    return np.dot(embedding_1, embedding_2)


async def auto_exact_match_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Exact match evaluator for comparing trace_outputs against reference trace_outputs.

        inputs: Test case data, which may contain reference trace_outputs
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with success flag (True for match, False for mismatch)
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    # --------------------------------------------------------------------------
    success = False
    if isinstance(trace_outputs, str) and isinstance(correct_answer, str):
        success = trace_outputs == correct_answer
    elif isinstance(trace_outputs, dict) and isinstance(correct_answer, dict):
        trace_outputs = dumps(trace_outputs, sort_keys=True)
        correct_answer = dumps(correct_answer, sort_keys=True)
        success = trace_outputs == correct_answer
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_regex_test_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Regex test evaluator for checking if output matches a regex pattern.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with regex pattern and matching flag

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "regex_pattern" in parameters:
        raise MissingParametersPathV0Error(path="regex_pattern")

    regex_pattern = parameters["regex_pattern"]

    if not isinstance(regex_pattern, str):
        raise InvalidParameterPathV0Error(
            path="regex_pattern",
            expected=str,
            got=type(regex_pattern),
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    regex_should_match = parameters.get("regex_should_match", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    try:
        pattern = re.compile(
            regex_pattern,
            flags=0 if case_sensitive else re.IGNORECASE,
        )
    except Exception as e:
        raise RegexPatternV0Error(pattern=regex_pattern) from e

    result = pattern.search(trace_outputs_str)

    success = bool(result) == regex_should_match
    # --------------------------------------------------------------------------

    return {"success": success}


async def field_match_test_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Field match test evaluator for extracting and comparing a specific field from JSON output.

    Args:
        inputs: Test case data with ground truth
        trace_outputs: Output from the workflow execution (expected to be JSON string or dict)
        parameters: Configuration for the evaluator with json_field to extract

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "json_field" in parameters:
        raise MissingParametersPathV0Error(path="json_field")

    json_field = parameters["json_field"]

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_dict = trace_outputs
    if isinstance(trace_outputs, str):
        try:
            trace_outputs_dict = loads(trace_outputs)
        except json.JSONDecodeError as e:
            raise InvalidTraceOutputsV0Error(
                expected=repr(dict) + " | json-object", got="non-json-object"
            ) from e

    if not isinstance(trace_outputs_dict, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    if not json_field in trace_outputs_dict:
        raise MissingTraceOutputsPathV0Error(path=json_field)

    # --------------------------------------------------------------------------
    success = trace_outputs_dict[json_field] == correct_answer
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_webhook_test_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Webhook test evaluator for sending output to an external service for evaluation.

    Args:
        inputs: Test case data with ground truth
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with webhook_url

    Returns:
        Evaluation result with score from the webhook
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "webhook_url" in parameters:
        raise MissingParametersPathV0Error(path="webhook_url")

    webhook_url = parameters["webhook_url"]

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    json_payload = {
        "inputs": inputs,
        "output": trace_outputs_str,
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
                code=500,
                message=str(e),
            ) from e

        if response.status_code != 200:
            raise WebhookServerV0Error(
                code=response.status_code,
                message=response.json(),
            )

        try:
            response = response.json()
        except Exception as e:
            raise WebhookClientV0Error(
                code=500,
                message=str(e),
            ) from e

        if response is None or not isinstance(response, dict):
            raise InvalidOutputsV0Error(expected=dict, got=type(response))

        if not "score" in response:
            raise MissingOutputsPathV0Error(path="score")

        score = response["score"]
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_custom_code_run_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Custom code execution evaluator for running arbitrary code to evaluate trace_outputs.

    Args:
        inputs: Test case data with ground truth
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with code to execute

    Returns:
        Evaluation result with score from the custom code
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "code" in parameters:
        raise MissingParametersPathV0Error(path="code")

    code = parameters["code"]

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    try:
        score = sandbox.execute_code_safely(
            app_params=trace_parameters,
            inputs=inputs,
            output=trace_outputs,
            correct_answer=correct_answer,
            code=code,
            datapoint=inputs,
        )
    except Exception as e:
        raise CustomCodeServerV0Error(
            code=500,
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_ai_critique_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    AI critique evaluator for using an LLM to evaluate trace_outputs.

    Args:
        inputs: Test case data with ground truth
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with prompt_template and model

    Returns:
        Evaluation result with score from the AI
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if not "prompt_template" in parameters:
        raise MissingParametersPathV0Error(path="prompt_template")

    prompt_template = parameters["prompt_template"]

    if not isinstance(prompt_template, list):
        raise InvalidParameterPathV0Error(
            path="prompt_template",
            expected=list,
            got=type(prompt_template),
        )

    model = parameters.get("model", "gpt-3.5-turbo")

    if not isinstance(model, str):
        raise InvalidParameterPathV0Error(
            path="model",
            expected=str,
            got=type(model),
        )

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    secrets = request.secrets

    if not secrets or not isinstance(secrets, dict):
        raise InvalidSecretsV0Error(expected=dict, got=type(secrets))

    openai_api_key = secrets.get("OPENAI_API_KEY")
    anthropic_api_key = secrets.get("ANTHROPIC_API_KEY")

    if not openai_api_key and not anthropic_api_key:
        raise MissingSecretsPathV0Error(
            path="OPENAI_API_KEY | ANTHROPIC_API_KEY",
        )

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    litellm.openai_key = openai_api_key
    litellm.anthropic_key = anthropic_api_key

    context = {
        **inputs,
        "prediction": trace_outputs,
        "ground_truth": correct_answer,
    }

    try:
        formatted_prompt_template = [
            {
                "role": message["role"],
                "content": message["content"].format(**context),
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
        )

        score = response.choices[0].message.content.strip()
    except Exception as e:
        raise PromptCompletionV0Error(
            message=str(e),
            stacktrace=traceback.format_exc(),
        ) from e
    # --------------------------------------------------------------------------

    try:
        score = float(score)
    except Exception as e:
        raise InvalidOutputsV0Error(expected=float, got=type(score)) from e

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_starts_with_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Starts with evaluator for checking if output starts with a specific prefix.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with prefix and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "prefix" in parameters:
        raise MissingParametersPathV0Error(path="prefix")

    prefix = parameters["prefix"]

    if not isinstance(prefix, str):
        raise InvalidParameterPathV0Error(
            path="prefix",
            expected=str,
            got=type(prefix),
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        prefix = prefix.lower()

    success = trace_outputs_str.startswith(prefix)
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_ends_with_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Ends with evaluator for checking if output ends with a specific suffix.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with suffix and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "suffix" in parameters:
        raise MissingParametersPathV0Error(path="suffix")

    suffix = parameters["suffix"]

    if not isinstance(suffix, str):
        raise InvalidParameterPathV0Error(
            path="suffix",
            expected=str,
            got=type(suffix),
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        suffix = suffix.lower()

    success = trace_outputs_str.endswith(suffix)
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_contains_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Contains evaluator for checking if output contains a specific substring.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substring and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "substring" in parameters:
        raise MissingParametersPathV0Error(path="substring")

    substring = parameters["substring"]

    if not isinstance(substring, str):
        raise InvalidParameterPathV0Error(
            path="substring",
            expected=str,
            got=type(substring),
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        substring = substring.lower()

    success = substring in trace_outputs_str
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_contains_any_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Contains any evaluator for checking if output contains any of the specified substrings.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substrings list and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "substrings" in parameters:
        raise MissingParametersPathV0Error(path="substrings")

    substrings = parameters["substrings"]

    if not isinstance(substrings, str):
        raise InvalidParameterPathV0Error(
            path="substrings",
            expected=str,
            got=type(substrings),
        )

    substrings = [s.strip() for s in substrings]

    if not all(isinstance(s, str) for s in substrings):
        raise InvalidParameterPathV0Error(
            path="substrings",
            expected="List[str]",
            got="List[Any]",
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        substrings = [s.lower() for s in substrings]

    success = any(substring in trace_outputs_str for substring in substrings)
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_contains_all_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Contains all evaluator for checking if output contains all of the specified substrings.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with substrings list and case sensitivity setting

    Returns:
        Evaluation result with success flag
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "substrings" in parameters:
        raise MissingParametersPathV0Error(path="substrings")

    substrings = parameters["substrings"]

    if not isinstance(substrings, str):
        raise InvalidParameterPathV0Error(
            path="substrings",
            expected=str,
            got=type(substrings),
        )

    substrings = [s.strip() for s in substrings]

    if not all(isinstance(s, str) for s in substrings):
        raise InvalidParameterPathV0Error(
            path="substrings",
            expected="List[str]",
            got="List[Any]",
        )

    case_sensitive = parameters.get("case_sensitive", True) is True

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        substrings = [s.lower() for s in substrings]

    success = all(substring in trace_outputs_str for substring in substrings)
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_contains_json_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: dict,
    inputs: dict,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Contains JSON evaluator for checking if output contains valid JSON content.

    Args:
        inputs: Test case data
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with success flag
    """
    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    # --------------------------------------------------------------------------
    success = True
    try:
        start_index = trace_outputs_str.index("{")
        end_index = trace_outputs_str.rindex("}") + 1
        potential_json = trace_outputs_str[start_index:end_index]
    except Exception:  # pylint: disable=broad-exception-caught
        success = False

    try:
        json.loads(potential_json)
    except Exception:  # pylint: disable=broad-exception-caught
        success = False
    # --------------------------------------------------------------------------

    return {"success": success}


async def auto_json_diff_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    JSON diff evaluator for finding differences between JSON structures.

    Args:
        inputs: Test case data with reference JSON
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with score only (no diff explanation)
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(correct_answer))

    correct_answer_dict = (
        correct_answer if isinstance(correct_answer, dict) else loads(correct_answer)
    )

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_dict = trace_outputs
    if isinstance(trace_outputs, str):
        try:
            trace_outputs_dict = loads(trace_outputs)
        except json.JSONDecodeError as e:
            raise InvalidTraceOutputsV0Error(
                expected=repr(dict) + " | json-object", got="non-json-object"
            ) from e

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    try:
        score = compare_jsons(
            ground_truth=correct_answer_dict,
            app_output=trace_outputs_dict,  # type: ignore
            settings_values=parameters,
        )

    except Exception as e:
        raise InvalidOutputsV0Error(expected=float, got=type(e)) from e
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def rag_faithfulness_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: dict,
    inputs: dict,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[VersionedTree] = None,
) -> Data:
    """
    RAG faithfulness evaluator for measuring how faithful a response is to the provided context.

    Args:
        inputs: Test case data with context and query information.
        trace_outputs: Output from the workflow execution.
        parameters: Configuration for the evaluator with model and credentials.

    Returns:
        Evaluation result with faithfulness score.
    """

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=type(inputs).__name__)

    # Check for SDK version compatibility
    if tree is not None and isinstance(tree, str):
        raise InvalidParametersV0Error(
            expected="VersionedTree or None", got="str (outdated SDK version)"
        )

    # Extract trace version and structure
    version = tree.version if tree is not None else None
    if version is None:
        raise InvalidParametersV0Error(expected="2.0 or 3.0", got="NoneType")

    trace = (
        tree
        if version == "3.0" and tree is not None
        else (
            trace_outputs.get("trace", trace if trace is not None else {})
            if isinstance(trace_outputs, dict)
            else {}
        )
    )

    def extract_spans_from_v2_trace(trace: Trace):
        spans = []
        for spans_tree in trace.values():
            if spans_tree.spans:
                for span_value in spans_tree.spans.values():
                    if isinstance(span_value, list):
                        spans.extend(span_value)
                    else:
                        spans.append(span_value)
        return spans

    # Process trace into trace tree
    nodes = (
        trace.model_dump()
        if isinstance(trace, VersionedTree)
        else (
            [span.model_dump() for span in extract_spans_from_v2_trace(trace)]
            if isinstance(trace, Trace)  # type: ignore
            else []
        )
    )
    trace_tree = process_distributed_trace_into_trace_tree(nodes, version)

    # Extract key mappings
    mapping_keys = remove_trace_prefix(settings_values=parameters)
    question_key = mapping_keys.get("question_key")
    answer_key = mapping_keys.get("answer_key")
    contexts_key = mapping_keys.get("contexts_key")
    secrets = request.secrets

    # Validate required parameter paths
    if question_key is None:
        raise MissingParametersPathV0Error(path="question_key")
    if answer_key is None:
        raise MissingParametersPathV0Error(path="answer_key")
    if contexts_key is None:
        raise MissingParametersPathV0Error(path="contexts_key")

    # Validate secrets
    if secrets is None or not isinstance(secrets, dict):
        raise InvalidCredentialsV0Error(expected="dict", got="None")

    # Extract values from trace tree
    question_val = get_field_value_from_trace_tree(trace_tree, question_key, version)
    answer_val = get_field_value_from_trace_tree(trace_tree, answer_key, version)
    contexts_val = get_field_value_from_trace_tree(trace_tree, contexts_key, version)

    # Validate required trace output values
    if question_val is None:
        raise MissingTraceOutputsPathV0Error(path=question_key)
    if answer_val is None:
        raise MissingTraceOutputsPathV0Error(path=answer_key)
    if contexts_val is None:
        raise MissingTraceOutputsPathV0Error(path=contexts_key)

    # Initialize RAG evaluator to calculate faithfulness score
    faithfulness = Faithfulness(api_key=secrets.get("OPENAI_API_KEY"))
    measurement = await faithfulness._run_eval_async(
        output=answer_val,
        input=question_val,
        context=contexts_val,
    )

    score = measurement.score if measurement.score else 0.0

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def rag_context_relevancy_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: dict,
    inputs: dict,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[VersionedTree] = None,
) -> Data:
    """
    RAG context relevancy evaluator for measuring how relevant the provided context is to the query.

    Args:
        inputs: Test case data with context and query information.
        trace_outputs: Output from the workflow execution (not used).
        parameters: Configuration for the evaluator with model and credentials.

    Returns:
        Evaluation result with relevancy score and explanation.
    """
    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected="dict", got=type(parameters).__name__)

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected="dict", got=type(inputs).__name__)

    # Check for SDK version compatibility
    if tree is not None and isinstance(tree, str):
        raise InvalidParametersV0Error(
            expected="VersionedTree or None", got="str (outdated SDK version)"
        )

    # Extract trace version and structure
    version = tree.version if tree is not None else None
    if version is None:
        raise InvalidParametersV0Error(expected="2.0 or 3.0", got="NoneType")

    trace = (
        tree
        if version == "3.0" and tree is not None
        else (
            trace_outputs.get("trace", trace if trace is not None else {})
            if isinstance(trace_outputs, dict)
            else {}
        )
    )

    def extract_spans_from_v2_trace(trace: Trace):
        spans = []
        for spans_tree in trace.values():
            if spans_tree.spans:
                for span_value in spans_tree.spans.values():
                    if isinstance(span_value, list):
                        spans.extend(span_value)
                    else:
                        spans.append(span_value)
        return spans

    # Process trace into trace tree
    nodes = (
        trace.model_dump()
        if isinstance(trace, VersionedTree)
        else (
            [span.model_dump() for span in extract_spans_from_v2_trace(trace)]
            if isinstance(trace, Trace)  # type: ignore
            else []
        )
    )
    trace_tree = process_distributed_trace_into_trace_tree(nodes, version)

    # Extract key mappings
    mapping_keys = remove_trace_prefix(settings_values=parameters)
    question_key = mapping_keys.get("question_key")
    answer_key = mapping_keys.get("answer_key")
    contexts_key = mapping_keys.get("contexts_key")
    secrets = request.secrets

    # Validate required parameter paths
    if question_key is None:
        raise MissingParametersPathV0Error(path="question_key")
    if answer_key is None:
        raise MissingParametersPathV0Error(path="answer_key")
    if contexts_key is None:
        raise MissingParametersPathV0Error(path="contexts_key")

    # Validate secrets
    if secrets is None or not isinstance(secrets, dict):
        raise InvalidCredentialsV0Error(expected="dict", got="None")

    # Extract values from trace tree
    question_val = get_field_value_from_trace_tree(trace_tree, question_key, version)
    answer_val = get_field_value_from_trace_tree(trace_tree, answer_key, version)
    contexts_val = get_field_value_from_trace_tree(trace_tree, contexts_key, version)

    # Validate required trace output values
    if question_val is None:
        raise MissingTraceOutputsPathV0Error(path=question_key)
    if answer_val is None:
        raise MissingTraceOutputsPathV0Error(path=answer_key)
    if contexts_val is None:
        raise MissingTraceOutputsPathV0Error(path=contexts_key)

    # Initialize RAG evaluator and calculate context relevancy score
    context_rel = ContextRelevancy(api_key=secrets.get("OPENAI_API_KEY"))
    measurement = await context_rel._run_eval_async(
        output=answer_val,
        input=question_val,
        context=contexts_val,
    )

    score = measurement.score if measurement.score else 0.0

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_levenshtein_distance_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: dict,
    inputs: dict,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Levenshtein distance evaluator using pure Python implementation.
    Measures edit distance and returns normalized similarity score.

    Args:
        inputs: Test case data with reference string.
        trace_outputs: Output from the workflow execution.
        parameters: Configuration for the evaluator.

    Returns:
        Dictionary with normalized similarity score (0 to 1),
        or error message if evaluation fails.
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(correct_answer))

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        correct_answer_str = correct_answer_str.lower()

    try:
        # Compute Levenshtein distance
        if len(correct_answer_str) == 0:
            distance = len(trace_outputs_str)
        else:
            previous_row = list(range(len(correct_answer_str) + 1))
            for i, c1 in enumerate(trace_outputs_str):
                current_row = [i + 1]
                for j, c2 in enumerate(correct_answer_str):
                    insert = previous_row[j + 1] + 1
                    delete = current_row[j] + 1
                    substitute = previous_row[j] + (c1 != c2)
                    current_row.append(min(insert, delete, substitute))
                previous_row = current_row
            distance = previous_row[-1]

        # Normalize similarity score
        max_length = max(len(trace_outputs_str), len(correct_answer_str))
        score = 1.0 if max_length == 0 else 1.0 - (distance / max_length)
    except Exception as e:
        raise InvalidOutputsV0Error(expected=float, got=None) from e
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_similarity_match_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Similarity match evaluator for measuring string similarity between output and reference.

    Args:
        inputs: Test case data with reference string
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator

    Returns:
        Evaluation result with similarity score
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    case_sensitive = parameters.get("case_sensitive", True) is True

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(correct_answer))

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    threshold = (
        parameters.get("threshold") or parameters.get("similarity_threshold") or 0.5
    )

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    if not case_sensitive:
        trace_outputs_str = trace_outputs_str.lower()
        correct_answer_str = correct_answer_str.lower()

    try:
        matcher = SequenceMatcher(None, trace_outputs_str, correct_answer_str)

        score = matcher.ratio()
    except Exception as e:
        raise InvalidOutputsV0Error(expected=float, got=None) from e
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}


async def auto_semantic_similarity_v0(
    *,
    revision: WorkflowRevision,
    request: WorkflowServiceRequest,
    #
    parameters: Data,
    inputs: Data,
    trace_outputs: Data | str,
    #
    trace_parameters: Optional[Data] = None,
    trace: Optional[Trace] = None,
    tree: Optional[Tree] = None,
) -> Data:
    """
    Semantic similarity evaluator for measuring semantic similarity between output and reference using embeddings.

    Args:
        inputs: Test case data with reference string
        trace_outputs: Output from the workflow execution
        parameters: Configuration for the evaluator with embedding model and credentials

    Returns:
        Evaluation result with cosine similarity score
    """
    if parameters is None or not isinstance(parameters, dict):
        raise InvalidParametersV0Error(expected=dict, got=type(parameters))

    if not "correct_answer_key" in parameters:
        raise MissingParametersPathV0Error(path="correct_answer_key")

    correct_answer_key = parameters["correct_answer_key"]

    embedding_model = parameters.get("embedding_model", "text-embedding-3-small")

    if not isinstance(embedding_model, str):
        raise InvalidParametersV0Error(expected=str, got=type(embedding_model))

    if inputs is None or not isinstance(inputs, dict):
        raise InvalidInputsV0Error(expected=dict, got=type(inputs))

    if not correct_answer_key in inputs:
        raise MissingInputsPathV0Error(path=correct_answer_key)

    correct_answer = inputs[correct_answer_key]

    if not isinstance(correct_answer, str) and not isinstance(correct_answer, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(correct_answer))

    correct_answer_str = (
        correct_answer if isinstance(correct_answer, str) else dumps(correct_answer)
    )

    if not isinstance(trace_outputs, str) and not isinstance(trace_outputs, dict):
        raise InvalidTraceOutputsV0Error(expected=dict | str, got=type(trace_outputs))

    trace_outputs_str = (
        trace_outputs if isinstance(trace_outputs, str) else dumps(trace_outputs)
    )

    secrets = request.secrets or {}

    threshold = parameters.get("threshold") or 0.5

    if not isinstance(threshold, float) and 0.0 < threshold <= 1.0:
        raise InvalidParameterPathV0Error(
            path="threshold",
            expected=float,
            got=type(threshold),
        )

    score = None
    success = None

    # --------------------------------------------------------------------------
    openai = AsyncOpenAI(api_key=secrets.get("OPENAI_API_KEY"))

    output_embedding = await _compute_embedding(
        openai,
        embedding_model,
        trace_outputs_str,
    )

    reference_embedding = await _compute_embedding(
        openai,
        embedding_model,
        correct_answer_str,
    )

    score = float(
        _compute_similarity(
            output_embedding,
            reference_embedding,
        )
    )
    # --------------------------------------------------------------------------

    if not isinstance(score, (int, float)):
        raise InvalidOutputsV0Error(expected=(int, float), got=type(score))

    success = score >= threshold

    if not isinstance(success, bool):
        raise InvalidOutputsV0Error(expected=bool, got=type(success))

    return {"score": score, "success": success}
