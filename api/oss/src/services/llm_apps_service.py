import json
import asyncio
import shlex
import traceback
import aiohttp
from datetime import datetime
from typing import Any, Dict, List, Optional

from oss.src.utils.logging import get_module_logger
from oss.src.services.auth_service import sign_secret_token
from oss.src.services.db_manager import get_project_by_id
from oss.src.models.shared_models import InvokationResult, Result, Error

log = get_module_logger(__name__)


def get_nested_value(d: dict, keys: list, default=None):
    """
    Helper function to safely retrieve nested values.
    """
    try:
        for key in keys:
            if isinstance(d, dict):
                d = d.get(key, default)
            else:
                return default
        return d
    except Exception as e:
        log.error(f"Error accessing nested value: {e}")
        return default


def extract_result_from_response(response: dict):
    # Initialize default values
    value = None
    latency = None
    cost = None
    tokens = None

    try:
        # Validate input
        if not isinstance(response, dict):
            raise ValueError("The response must be a dictionary.")

        # Handle version 3.0 response
        if response.get("version") == "3.0":
            value = response
            # Ensure 'data' is a dictionary or convert it to a string
            if not isinstance(value.get("data"), dict):
                value["data"] = str(value.get("data"))

            if "tree" in response:
                trace_tree = response.get("tree", {}).get("nodes", [])[0]

                duration_ms = get_nested_value(
                    trace_tree, ["metrics", "acc", "duration", "total"]
                )
                if duration_ms:
                    duration_seconds = duration_ms / 1000
                else:
                    start_time = get_nested_value(trace_tree, ["time", "start"])
                    end_time = get_nested_value(trace_tree, ["time", "end"])

                    if start_time and end_time:
                        duration_seconds = (
                            datetime.fromisoformat(end_time)
                            - datetime.fromisoformat(start_time)
                        ).total_seconds()
                    else:
                        duration_seconds = None

                latency = duration_seconds
                cost = get_nested_value(
                    trace_tree, ["metrics", "acc", "costs", "total"]
                )
                tokens = get_nested_value(
                    trace_tree, ["metrics", "acc", "tokens", "total"]
                )

        # Handle version 2.0 response
        elif response.get("version") == "2.0":
            value = response
            if not isinstance(value.get("data"), dict):
                value["data"] = str(value.get("data"))

            if "trace" in response:
                latency = response["trace"].get("latency", None)
                cost = response["trace"].get("cost", None)
                tokens = response["trace"].get("tokens", None)

        # Handle generic response (neither 2.0 nor 3.0)
        else:
            value = {"data": str(response.get("message", ""))}
            latency = response.get("latency", None)
            cost = response.get("cost", None)
            tokens = response.get("tokens", None)

        # Determine the type of 'value' (either 'text' or 'object')
        kind = "text" if isinstance(value, str) else "object"

    except ValueError as ve:
        log.error(f"Input validation error: {ve}")
        value = {"error": str(ve)}
        kind = "error"

    except KeyError as ke:
        log.error(f"Missing key: {ke}")
        value = {"error": f"Missing key: {ke}"}
        kind = "error"

    except TypeError as te:
        log.error(f"Type error: {te}")
        value = {"error": f"Type error: {te}"}
        kind = "error"

    except Exception as e:
        log.error(f"Unexpected error: {e}")
        value = {"error": f"Unexpected error: {e}"}
        kind = "error"

    return value, kind, cost, tokens, latency


def _parse_legacy_chat_messages(datapoint: Any) -> list[Any]:
    # Legacy rows may store chat history under either `messages` or `chat`.
    raw_messages = datapoint.get("messages") or datapoint.get("chat", "[]")

    if isinstance(raw_messages, list):
        return raw_messages

    if isinstance(raw_messages, str):
        try:
            return json.loads(raw_messages) if raw_messages else []
        except (json.JSONDecodeError, TypeError):
            log.warn(f"Failed to parse messages data, using empty list: {raw_messages}")
            return []

    log.warn(f"Unexpected format for messages data, using empty list: {raw_messages}")
    return []


def _extract_input_keys(parameters: Any) -> List[str]:
    input_keys: List[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested_value in value.items():
                if key == "input_keys" and isinstance(nested_value, list):
                    for item in nested_value:
                        if isinstance(item, str) and item not in input_keys:
                            input_keys.append(item)
                    continue
                visit(nested_value)
            return

        if isinstance(value, list):
            for item in value:
                visit(item)

    visit(parameters)
    return input_keys


def parse_legacy_inputs(
    datapoint: Any,
    parameters: Any,
    is_chat: Optional[bool] = None,
) -> Dict:
    if not isinstance(datapoint, dict):
        return {}

    input_keys = _extract_input_keys(parameters)
    if input_keys:
        inputs = {key: datapoint.get(key, None) for key in input_keys}
    else:
        inputs = dict(datapoint)

    if is_chat:
        inputs["messages"] = _parse_legacy_chat_messages(datapoint)

    return inputs


def _format_curl_request(
    *,
    url: str,
    headers: Dict[str, str],
    json_body: Dict[str, Any],
) -> str:
    # Keep any future debug curl output safe by redacting sensitive headers.
    redacted_headers = {
        key: "[REDACTED]"
        if key.lower() in {"authorization", "proxy-authorization", "cookie"}
        else value
        for key, value in headers.items()
    }
    parts = ["curl", "-X", "POST", shlex.quote(url)]

    for key, value in redacted_headers.items():
        parts.extend(["-H", shlex.quote(f"{key}: {value}")])

    parts.extend(
        [
            "--data-raw",
            shlex.quote(json.dumps(json_body, ensure_ascii=False)),
        ]
    )

    return " ".join(parts)


def build_invoke_request(
    *,
    inputs: Dict[str, Any],
    parameters: Dict[str, Any],
    references: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    request = {
        "data": {
            "parameters": parameters,
            "inputs": inputs,
        }
    }

    if references:
        request["references"] = references

    return request


def _extract_error_details(
    app_response: Any,
    *,
    fallback_message: str,
    fallback_stacktrace: str,
) -> tuple[str, str]:
    if isinstance(app_response, dict):
        detail = app_response.get("detail")
        if isinstance(detail, dict):
            return (
                detail.get("error", fallback_message),
                detail.get("message") or detail.get("traceback") or fallback_stacktrace,
            )
        if isinstance(detail, str):
            return detail, fallback_stacktrace

        status = app_response.get("status")
        if isinstance(status, dict):
            return (
                status.get("message", fallback_message),
                status.get("stacktrace") or fallback_stacktrace,
            )

    if isinstance(app_response, str) and app_response:
        return app_response, fallback_stacktrace

    return fallback_message, fallback_stacktrace


async def invoke_app(
    uri: str,
    datapoint: Any,
    parameters: Dict,
    openapi_is_chat: Optional[bool],
    user_id: str,
    project_id: str,
    scenario_id: Optional[str] = None,
    **kwargs,
) -> InvokationResult:
    """
    Invoke an application for one testcase row.

    Args:
        uri (str): The URI of the app to invoke.
        datapoint (Any): The testcase row data to send as `data.inputs`.
        parameters (Dict): The application parameters to send as `data.parameters`.

    Returns:
        InvokationResult: The output of the app.

    Raises:
        aiohttp.ClientError: If the POST request fails.
    """

    url = f"{uri}/invoke"

    inputs = parse_legacy_inputs(
        datapoint,
        parameters,
        is_chat=openapi_is_chat,
    )
    request_body = build_invoke_request(
        inputs=inputs,
        parameters=parameters,
        references=kwargs.get("references"),
    )

    project = await get_project_by_id(
        project_id=project_id,
    )

    secret_token = await sign_secret_token(
        user_id=str(user_id),
        project_id=str(project_id),
        workspace_id=str(project.workspace_id),
        organization_id=str(project.organization_id),
    )

    headers = {}
    if secret_token:
        headers = {"Authorization": f"Secret {secret_token}"}
    headers["ngrok-skip-browser-warning"] = "1"

    async with aiohttp.ClientSession() as client:
        app_response = {}

        try:
            log.info(
                "Invoking application...",
                scenario_id=scenario_id,
                testcase_id=(
                    datapoint["testcase_id"] if "testcase_id" in datapoint else None
                ),
                url=url,
            )
            response = await client.post(
                url,
                json=request_body,
                headers=headers,
                timeout=900,
            )
            app_response = await response.json()
            response.raise_for_status()

            (
                value,
                kind,
                cost,
                tokens,
                latency,
            ) = extract_result_from_response(app_response)

            trace_id = app_response.get("trace_id", None)
            span_id = app_response.get("span_id", None)

            log.info(
                "Invoked application.   ",
                scenario_id=scenario_id,
                trace_id=trace_id,
            )

            return InvokationResult(
                result=Result(
                    type=kind,
                    value=value,
                    error=None,
                ),
                latency=latency,
                cost=cost,
                tokens=tokens,
                trace_id=trace_id,
                span_id=span_id,
            )

        except aiohttp.ClientResponseError as e:
            log.error(
                "Application request failed",
                scenario_id=scenario_id,
                testcase_id=(
                    datapoint["testcase_id"] if "testcase_id" in datapoint else None
                ),
                url=url,
                status_code=e.status,
            )
            error_message, stacktrace = _extract_error_details(
                app_response,
                fallback_message=f"HTTP error {e.status}: {e.message}",
                fallback_stacktrace="".join(
                    traceback.format_exception_only(type(e), e)
                ),
            )
            log.error(f"HTTP error occurred during request: {error_message}")
        except aiohttp.ServerTimeoutError as e:
            error_message = "Request timed out"
            stacktrace = "".join(traceback.format_exception_only(type(e), e))
            log.error(error_message)
        except aiohttp.ClientConnectionError as e:
            error_message = f"Connection error: {str(e)}"
            stacktrace = "".join(traceback.format_exception_only(type(e), e))
            log.error(error_message)
        except json.JSONDecodeError as e:
            error_message = "Failed to decode JSON from response"
            stacktrace = "".join(traceback.format_exception_only(type(e), e))
            log.error(error_message)
        except Exception as e:
            error_message = f"Unexpected error: {str(e)}"
            stacktrace = "".join(traceback.format_exception_only(type(e), e))
            log.error(error_message)

        return InvokationResult(
            result=Result(
                type="error",
                error=Error(
                    message=error_message,
                    stacktrace=stacktrace,
                ),
            )
        )


async def run_with_retry(
    uri: str,
    input_data: Any,
    parameters: Dict,
    max_retry_count: int,
    retry_delay: int,
    openapi_is_chat: Optional[bool],
    user_id: str,
    project_id: str,
    scenario_id: Optional[str] = None,
    **kwargs,
) -> InvokationResult:
    """
    Runs the specified app with retry mechanism.

    Args:
        uri (str): The URI of the app.
        input_data (Any): The input data for the app.
        parameters (Dict): The parameters for the app.
        max_retry_count (int): The maximum number of retries.
        retry_delay (int): The delay between retries in seconds.
        openapi_is_chat (Optional[bool]): Whether the app is chat, if detected.

    Returns:
        InvokationResult: The invokation result.

    """

    if "references" in kwargs and "testcase_id" in input_data:
        kwargs["references"]["testcase"] = {"id": input_data["testcase_id"]}

    # references = kwargs.get("references", None)
    # links = kwargs.get("links", None)
    # hash_id = make_hash_id(references=references, links=links)

    retries = 0
    last_exception = None
    while retries < max_retry_count:
        try:
            result = await invoke_app(
                uri,
                input_data,
                parameters,
                openapi_is_chat,
                user_id,
                project_id,
                scenario_id,
                **kwargs,
            )
            return result
        except aiohttp.ClientError as e:
            last_exception = e
            log.error(f"Error in evaluation. Retrying in {retry_delay} seconds:", e)
            await asyncio.sleep(retry_delay)
            retries += 1
        except Exception as e:
            last_exception = e
            log.warn(
                f"Error processing datapoint: {input_data}.",
                exc_info=True,
            )
            log.warn("".join(traceback.format_exception_only(type(e), e)))
            retries += 1

    # If max retries is reached or an exception that isn't in the second block,
    # update & return the last exception
    log.warn("Max retries reached")
    exception_message = (
        "Max retries reached"
        if retries == max_retry_count
        else f"Error processing {input_data} datapoint"
    )

    return InvokationResult(
        result=Result(
            type="error",
            value=None,
            error=Error(message=exception_message, stacktrace=str(last_exception)),
        )
    )


async def batch_invoke(
    uri: str,
    testset_data: List[Dict],
    *,
    rate_limit_config: Dict,
    user_id: str,
    project_id: str,
    parameters: Optional[Dict] = None,
    scenarios: Optional[List[Dict]] = None,
    revision: Optional[Any] = None,
    schemas: Optional[Dict[str, Any]] = None,
    is_chat: Optional[bool] = None,
    **kwargs,
) -> List[InvokationResult]:
    """
    Invokes the LLm apps in batches, processing the testset data.

    Args:
        uri (str): The URI of the LLm app.
        testset_data (List[Dict]): The testset data to be processed.
        parameters (Dict): The parameters for the LLm app.
        rate_limit_config (Dict): The rate limit configuration.

    Returns:
        List[InvokationResult]: The list of app outputs after running all batches.
    """
    (
        effective_parameters,
        effective_schemas,
        effective_is_chat,
    ) = _extract_batch_invoke_metadata(
        revision=revision,
        parameters=parameters,
        schemas=schemas,
        is_chat=is_chat,
    )

    batch_size = rate_limit_config[
        "batch_size"
    ]  # Number of testset to make in each batch
    max_retries = rate_limit_config[
        "max_retries"
    ]  # Maximum number of times to retry the failed llm call
    retry_delay = rate_limit_config[
        "retry_delay"
    ]  # Delay before retrying the failed llm call (in seconds)
    delay_between_batches = rate_limit_config[
        "delay_between_batches"
    ]  # Delay between batches (in seconds)

    list_of_app_outputs: List[
        InvokationResult
    ] = []  # Outputs after running all batches

    project = await get_project_by_id(
        project_id=project_id,
    )

    secret_token = await sign_secret_token(
        user_id=str(user_id),
        project_id=str(project_id),
        workspace_id=str(project.workspace_id),
        organization_id=str(project.organization_id),
    )

    headers = {}
    if secret_token:
        headers = {"Authorization": f"Secret {secret_token}"}
    headers["ngrok-skip-browser-warning"] = "1"

    schema_parameters, openapi_is_chat = get_parameters_from_schemas(
        schemas=effective_schemas,
        is_chat=effective_is_chat,
    )

    if not schema_parameters:
        max_recursive_depth = 5
        runtime_prefix = uri
        route_path = ""

        while max_recursive_depth > 0 and not schema_parameters:
            try:
                (
                    schema_parameters,
                    openapi_is_chat,
                ) = await get_parameters_from_inspect(
                    runtime_prefix,
                    route_path,
                    headers,
                )
            except Exception:  # pylint: disable=broad-exception-caught
                schema_parameters = None
                openapi_is_chat = None

            if not schema_parameters:
                max_recursive_depth -= 1
                if not runtime_prefix.endswith("/"):
                    route_path = "/" + runtime_prefix.split("/")[-1] + route_path
                    runtime_prefix = "/".join(runtime_prefix.split("/")[:-1])
                else:
                    route_path = ""
                    runtime_prefix = runtime_prefix[:-1]

        if not schema_parameters:
            schema_parameters, openapi_is_chat = await get_parameters_from_inspect(
                runtime_prefix,
                route_path,
                headers,
            )

    # 🆕 Rewritten loop instead of recursion
    for start_idx in range(0, len(testset_data), batch_size):
        tasks = []

        end_idx = min(start_idx + batch_size, len(testset_data))
        for index in range(start_idx, end_idx):
            task = asyncio.ensure_future(
                run_with_retry(
                    uri,
                    testset_data[index],
                    effective_parameters,
                    max_retries,
                    retry_delay,
                    openapi_is_chat,
                    user_id,
                    project_id,
                    scenarios[index].get("id") if scenarios else None,
                    **kwargs,
                )
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        for result in results:
            list_of_app_outputs.append(result)

        # Delay between batches if more to come
        if end_idx < len(testset_data):
            await asyncio.sleep(delay_between_batches)

    return list_of_app_outputs


def _to_json_dict(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", exclude_none=True)

    return value if isinstance(value, dict) else {}


def _extract_batch_invoke_metadata(
    *,
    revision: Optional[Any],
    parameters: Optional[Dict[str, Any]],
    schemas: Optional[Dict[str, Any]],
    is_chat: Optional[bool],
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]], Optional[bool]]:
    revision_dict = _to_json_dict(revision)
    revision_data = _to_json_dict(revision_dict.get("data"))
    revision_flags = _to_json_dict(revision_dict.get("flags"))

    effective_parameters = parameters
    if effective_parameters is None:
        revision_parameters = revision_data.get("parameters")
        effective_parameters = (
            revision_parameters if isinstance(revision_parameters, dict) else {}
        )

    effective_schemas = schemas
    if effective_schemas is None:
        revision_schemas = revision_data.get("schemas")
        effective_schemas = (
            revision_schemas if isinstance(revision_schemas, dict) else None
        )

    effective_is_chat = is_chat
    if effective_is_chat is None and "is_chat" in revision_flags:
        effective_is_chat = bool(revision_flags["is_chat"])

    return effective_parameters or {}, effective_schemas, effective_is_chat


def get_parameters_from_schemas(
    schemas: Optional[Dict[str, Any]],
    is_chat: Optional[bool] = None,
) -> tuple[List[Dict[str, Any]], Optional[bool]]:
    if hasattr(schemas, "model_dump"):
        schemas = schemas.model_dump(mode="json", exclude_none=True)

    if not isinstance(schemas, dict) or not schemas:
        return [], is_chat

    parameters_schema = schemas.get("parameters") or {}
    inputs_schema = schemas.get("inputs") or {}

    parameter_properties = (
        parameters_schema.get("properties", {})
        if isinstance(parameters_schema, dict)
        else {}
    )
    input_properties = (
        inputs_schema.get("properties", {}) if isinstance(inputs_schema, dict) else {}
    )

    parameters: List[Dict[str, Any]] = []

    if isinstance(parameters_schema, dict):
        parameters.append(
            {
                "name": "ag_config",
                "type": "dict",
                "default": list(parameter_properties.keys()),
            }
        )

    input_names: List[str] = []
    has_messages = False

    for name, schema in input_properties.items():
        if not isinstance(schema, dict):
            continue

        is_messages_field = name == "messages" or schema.get("x-ag-type-ref") in {
            "messages",
            "message",
        }

        if is_messages_field:
            has_messages = True
            parameters.append(
                {
                    "name": name,
                    "type": "messages",
                    "default": schema.get("default", []),
                }
            )
            continue

        if schema.get("x-ag-type") == "file_url":
            parameters.append(
                {
                    "name": name,
                    "type": "file_url",
                    "default": schema.get("default", ""),
                }
            )
            continue

        input_names.append(name)

    inferred_is_chat = is_chat if is_chat is not None else has_messages

    parameters.append(
        {
            "name": "inputs",
            "type": "dict",
            "default": input_names,
        }
    )

    if inferred_is_chat and not has_messages:
        parameters.append(
            {
                "name": "messages",
                "type": "messages",
                "default": [],
            }
        )

    return parameters, inferred_is_chat


async def get_parameters_from_inspect(
    runtime_prefix: str,
    route_path: str,
    headers: Optional[Dict[str, str]],
) -> tuple[List[Dict], Optional[bool]]:
    """
    Read runtime inspect output for an LLM app and derive the UI parameter list.
    """
    inspect_url = _build_inspect_url(
        runtime_prefix=runtime_prefix,
        route_path=route_path,
    )
    payload = await _post_json_to_uri(
        uri=inspect_url,
        headers=headers,
        body={},
    )

    revision = (payload.get("data") or {}).get("revision") or {}
    revision_data = revision.get("data") or {}
    schemas = revision_data.get("schemas")
    flags = payload.get("flags")

    is_chat = None
    if isinstance(flags, dict) and "is_chat" in flags:
        is_chat = bool(flags["is_chat"])

    return get_parameters_from_schemas(
        schemas=schemas,
        is_chat=is_chat,
    )


def _build_inspect_url(
    *,
    runtime_prefix: str,
    route_path: str,
) -> str:
    runtime_prefix = runtime_prefix.rstrip("/")
    route_path = route_path.strip("/")

    if route_path:
        return f"{runtime_prefix}/{route_path}/inspect"

    return f"{runtime_prefix}/inspect"


async def _post_json_to_uri(
    uri: str,
    headers: Optional[Dict[str, str]],
    body: Dict[str, Any],
):
    if headers is None:
        headers = {}
    headers["ngrok-skip-browser-warning"] = "1"

    async with aiohttp.ClientSession() as client:
        resp = await client.post(uri, headers=headers, json=body, timeout=5)
        resp_text = await resp.text()
        json_data = json.loads(resp_text)
        return json_data
