import json
import asyncio
import logging
import traceback
from typing import Any, Dict, List

import httpx

from agenta_backend.models.db_models import InvokationResult, Result, Error

# Set logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


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
    inputs_dict = {}
    for param in openapi_parameters:
        if param["type"] == "input":
            payload[param["name"]] = datapoint.get(param["name"], "")
        elif param["type"] == "dict":  # in case of dynamic inputs (as in our templates)
            # let's get the list of the dynamic inputs
            if (
                param["name"] in parameters
            ):  # in case we have modified in the playground the default list of inputs (e.g. country_name)
                input_names = [_["name"] for _ in parameters[param["name"]]]
            else:  # otherwise we use the default from the openapi
                input_names = param["default"]
            # now we put them in a dict which we would put under "inputs" in the payload

            for input_name in input_names:
                inputs_dict[input_name] = datapoint.get(input_name, "")
        elif param["type"] == "messages":
            # TODO: Right now the FE is saving chats always under the column name chats. The whole logic for handling chats and dynamic inputs is convoluted and needs rework in time.
            payload[param["name"]] = json.loads(datapoint.get("chat", ""))
        elif param["type"] == "file_url":
            payload[param["name"]] = datapoint.get(param["name"], "")
        else:
            payload[param["name"]] = parameters[param["name"]]

    if inputs_dict:
        payload["inputs"] = inputs_dict
    return payload


async def invoke_app(
    uri: str, datapoint: Any, parameters: Dict, openapi_parameters: List[Dict]
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
        httpx.HTTPError: If the POST request fails.
    """
    url = f"{uri}/generate"
    payload = await make_payload(datapoint, parameters, openapi_parameters)

    async with httpx.AsyncClient() as client:
        try:
            logger.debug(f"Invoking app {uri} with payload {payload}")
            response = await client.post(
                url, json=payload, timeout=httpx.Timeout(timeout=5, read=None, write=5)
            )
            response.raise_for_status()
            app_output = response.json()
            return InvokationResult(
                result=Result(type="text", value=app_output["message"], error=None)
            )

        except httpx.HTTPError as e:
            logger.error(f"Error occurred during request: {e}")
            return InvokationResult(
                result=Result(
                    type="error",
                    error=Error(
                        message="An error occurred while invoking the LLM App",
                        stacktrace=str(e),
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
    retries = 0
    last_exception = None
    while retries < max_retry_count:
        try:
            result = await invoke_app(uri, input_data, parameters, openapi_parameters)
            return result
        except (httpx.TimeoutException, httpx.ConnectTimeout, httpx.ConnectError) as e:
            last_exception = e
            print(f"Error in evaluation. Retrying in {retry_delay} seconds:", e)
            await asyncio.sleep(retry_delay)
            retries += 1

    # If max retries reached, return the last exception
    # return AppOutput(output=None, status=str(last_exception))
    return InvokationResult(
        result=Result(
            type="error",
            value=None,
            error=Error(message="max retries reached", stacktrace=last_exception),
        )
    )


async def batch_invoke(
    uri: str, testset_data: List[Dict], parameters: Dict, rate_limit_config: Dict
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

    list_of_app_outputs: List[InvokationResult] = (
        []
    )  # Outputs after running all batches
    try:
        openapi_parameters = await get_parameters_from_openapi(uri + "/openapi.json")
    except Exception as e:
        logger.traceback.print_exc()
        for _ in testset_data:
            list_of_app_outputs.append(
                InvokationResult(
                    result=Result(
                        type="error",
                        error=Error(
                            message="An error occurred while invoking the LLM App",
                            stacktrace=str(e),
                        ),
                    )
                )
            )

    async def run_batch(start_idx: int):
        print(f"Preparing {start_idx} batch...")
        end_idx = min(start_idx + batch_size, len(testset_data))
        for index in range(start_idx, end_idx):
            try:
                batch_output: InvokationResult = await run_with_retry(
                    uri,
                    testset_data[index],
                    parameters,
                    max_retries,
                    retry_delay,
                    openapi_parameters,
                )
                list_of_app_outputs.append(batch_output)
                print(f"Adding outputs to batch {start_idx}")
            except Exception as exc:
                traceback.print_exc()
                logger.info(
                    f"Error processing batch[{start_idx}]:[{end_idx}] ==> {str(exc)}"
                )

        # Schedule the next batch with a delay
        next_batch_start_idx = end_idx
        if next_batch_start_idx < len(testset_data):
            await asyncio.sleep(delay_between_batches)
            await run_batch(next_batch_start_idx)

    # Start the first batch
    await run_batch(0)
    return list_of_app_outputs


async def get_parameters_from_openapi(uri: str) -> List[Dict]:
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

    schema = await _get_openai_json_from_uri(uri)

    try:
        body_schema_name = (
            schema["paths"]["/generate"]["post"]["requestBody"]["content"][
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


async def _get_openai_json_from_uri(uri):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(uri)
            timeout = httpx.Timeout(timeout=5, read=None, write=5)
            resp = await client.get(uri, timeout=timeout)
            json_data = json.loads(resp.text)
            return json_data
    except Exception as e:
        print(f"Error retrieving JSON from URI: {uri}")
        print(f"Exception: {e}")
        raise e
