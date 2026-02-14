import json
import asyncio
import traceback
import aiohttp
from datetime import datetime
from typing import Any, Dict, List, Optional

from oss.src.utils.logging import get_module_logger
from oss.src.services import helpers
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


async def make_payload(
    datapoint: Any, parameters: Dict, openapi_parameters: List[Dict]
) -> Dict:
    """
    Constructs the payload for invoking an app based on OpenAPI parameters.

    Args:
        datapoint (Any): The data to be sent to the app.
        parameters (Dict): The parameters required by the app taken from the db.
        openapi_parameters (List[Dict]): The OpenAPI parameters of the app.

    Returns:
        Dict: The constructed payload for the app.
    """
    payload = {}
    inputs = {}
    messages = []

    for param in openapi_parameters:
        if param["name"] == "ag_config":
            payload["ag_config"] = parameters
        elif param["type"] == "input":
            item = datapoint.get(param["name"], parameters.get(param["name"], ""))
            assert param["name"] != "ag_config", (
                "ag_config should be handled separately"
            )
            payload[param["name"]] = item

        # in case of dynamic inputs (as in our templates)
        elif param["type"] == "dict":
            # let's get the list of the dynamic inputs
            if (
                param["name"] in parameters
            ):  # in case we have modified in the playground the default list of inputs (e.g. country_name)
                input_names = [_["name"] for _ in parameters[param["name"]]]
            else:  # otherwise we use the default from the openapi
                input_names = param["default"]

            for input_name in input_names:
                item = datapoint.get(input_name, "")
                inputs[input_name] = item
        elif param["type"] == "messages":
            # TODO: Right now the FE is saving chats always under the column name chats. The whole logic for handling chats and dynamic inputs is convoluted and needs rework in time.
            chat_data = datapoint.get("chat", "")
            item = json.loads(chat_data)
            payload[param["name"]] = item
        elif param["type"] == "file_url":
            item = datapoint.get(param["name"], "")
            payload[param["name"]] = item
        else:
            if param["name"] in parameters:  # hotfix
                log.warn(
                    f"Processing other param type '{param['type']}': {param['name']}"
                )
                item = parameters[param["name"]]
                payload[param["name"]] = item

    try:
        input_keys = helpers.find_key_occurrences(parameters, "input_keys") or []
        inputs = {key: datapoint.get(key, None) for key in input_keys}

        messages_data = datapoint.get("messages", "[]")
        messages = json.loads(messages_data)
        payload["messages"] = messages
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(f"Error making payload: {e}")

    payload["inputs"] = inputs

    return payload


async def invoke_app(
    uri: str,
    datapoint: Any,
    parameters: Dict,
    openapi_parameters: List[Dict],
    user_id: str,
    project_id: str,
    scenario_id: Optional[str] = None,
    **kwargs,
) -> InvokationResult:
    """
    Invokes an app for one datapoint using the openapi_parameters to determine
    how to invoke the app.

    Args:
        uri (str): The URI of the app to invoke.
        datapoint (Any): The data to be sent to the app.
        parameters (Dict): The parameters required by the app taken from the db.
        openapi_parameters (List[Dict]): The OpenAPI parameters of the app.

    Returns:
        InvokationResult: The output of the app.

    Raises:
        aiohttp.ClientError: If the POST request fails.
    """

    url = f"{uri}/test"
    if "application_id" in kwargs:
        url = url + f"?application_id={kwargs.get('application_id')}"

    payload = await make_payload(datapoint, parameters, openapi_parameters)

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
                json=payload,
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
            error_message = app_response.get("detail", {}).get(
                "error", f"HTTP error {e.status}: {e.message}"
            )
            stacktrace = app_response.get("detail", {}).get(
                "message"
            ) or app_response.get("detail", {}).get(
                "traceback", "".join(traceback.format_exception_only(type(e), e))
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
    openapi_parameters: List[Dict],
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
        openapi_parameters (List[Dict]): The OpenAPI parameters for the app.

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
                openapi_parameters,
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
    parameters: Dict,
    rate_limit_config: Dict,
    user_id: str,
    project_id: str,
    scenarios: Optional[List[Dict]] = None,
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

    openapi_parameters = None
    max_recursive_depth = 5
    runtime_prefix = uri
    route_path = ""

    while max_recursive_depth > 0 and not openapi_parameters:
        try:
            openapi_parameters = await get_parameters_from_openapi(
                runtime_prefix + "/openapi.json",
                route_path,
                headers,
            )
        except Exception:  # pylint: disable=broad-exception-caught
            openapi_parameters = None

        if not openapi_parameters:
            max_recursive_depth -= 1
            if not runtime_prefix.endswith("/"):
                route_path = "/" + runtime_prefix.split("/")[-1] + route_path
                runtime_prefix = "/".join(runtime_prefix.split("/")[:-1])
            else:
                route_path = ""
                runtime_prefix = runtime_prefix[:-1]

    # Final attempt to fetch OpenAPI parameters
    openapi_parameters = await get_parameters_from_openapi(
        runtime_prefix + "/openapi.json",
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
                    parameters,
                    max_retries,
                    retry_delay,
                    openapi_parameters,
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


async def get_parameters_from_openapi(
    runtime_prefix: str,
    route_path: str,
    headers: Optional[Dict[str, str]],
) -> List[Dict]:
    """
    Parse the OpenAI schema of an LLM app to return list of parameters that it takes with their type as determined by the x-parameter
    Args:
    uri (str): The URI of the OpenAPI schema.

    Returns:
        list: A list of parameters. Each a dict with name and type.
        Type can be one of: input, text, choice, float, dict, bool, int, file_url, messages.

    Raises:
        KeyError: If the required keys are not found in the schema.

    """

    schema = await _get_openai_json_from_uri(runtime_prefix, headers)

    try:
        body_schema_name = (
            schema["paths"][route_path + "/test"]["post"]["requestBody"]["content"][
                "application/json"
            ]["schema"]["$ref"]
            .split("/")
            .pop()
        )
    except KeyError:
        body_schema_name = ""

    try:
        properties = schema["components"]["schemas"][body_schema_name]["properties"]
    except KeyError:
        properties = {}

    parameters = []
    for name, param in properties.items():
        parameters.append(
            {
                "name": name,
                "type": param.get("x-parameter", "input"),
                "default": param.get("default", []),
            }
        )
    return parameters


async def _get_openai_json_from_uri(
    uri: str,
    headers: Optional[Dict[str, str]],
):
    if headers is None:
        headers = {}
    headers["ngrok-skip-browser-warning"] = "1"

    async with aiohttp.ClientSession() as client:
        resp = await client.get(uri, headers=headers, timeout=5)
        resp_text = await resp.text()
        json_data = json.loads(resp_text)
        return json_data
