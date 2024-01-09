import asyncio
import logging
from typing import Any, List

from agenta_backend.models.api.evaluation_model import AppOutput

import httpx


# Set logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def get_llm_app_output(uri: str, datapoint: Any, parameters: dict) -> AppOutput:
    prompt_user = replace_placeholders(parameters["prompt_user"], datapoint)
    prompt_system = replace_placeholders(parameters["prompt_system"], datapoint)

    url = f"{uri}/generate"

    payload = {
        "temperature": parameters["temperature"],
        "model": parameters["model"],
        "max_tokens": parameters["max_tokens"],
        "prompt_system": prompt_system,
        "prompt_user": prompt_user,
        "top_p": parameters["top_p"],
        "frequence_penalty": parameters["frequence_penalty"],
        "presence_penalty": parameters["presence_penalty"],
        "inputs": {
            input_item["name"]: datapoint.get(input_item["name"], "")
            for input_item in parameters["inputs"]
        },
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url, json=payload, timeout=httpx.Timeout(timeout=5, read=None, write=5)
        )
        response.raise_for_status()
        response_data = response.json()
        if isinstance(response_data, dict):
            llm_output = response_data["message"]
        else:
            llm_output = response_data
        return AppOutput(output=llm_output, status="success")


async def run_with_retry(
    uri: str, input_data: Any, parameters: dict, max_retry_count: int, retry_delay: int
) -> AppOutput:
    retries = 0
    last_exception = None
    while retries < max_retry_count:
        try:
            result = await get_llm_app_output(uri, input_data, parameters)
            return result
        except (httpx.TimeoutException, httpx.ConnectTimeout, httpx.ConnectError) as e:
            last_exception = e
            print(f"Error in evaluation. Retrying in {retry_delay} seconds:", e)
            await asyncio.sleep(retry_delay)
            retries += 1

    # If max retries reached, return the last exception
    return AppOutput(output=None, status=str(last_exception))


async def batch_invoke(
    uri: str, testset_data: List[dict], parameters: dict, rate_limit_config: dict
) -> List[AppOutput]:
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

    list_of_app_outputs: List[AppOutput] = []  # Outputs after running all batches

    async def run_batch(start_idx: int):
        print(f"Preparing {start_idx} batch...")
        end_idx = min(start_idx + batch_size, len(testset_data))
        for index in range(start_idx, end_idx):
            try:
                batch_output: AppOutput = await run_with_retry(
                    uri, testset_data[index], parameters, max_retries, retry_delay
                )
                list_of_app_outputs.append(batch_output)
                print(f"Adding outputs to batch {start_idx}")
            except Exception as exc:
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


def replace_placeholders(text, data):
    for key, value in data.items():
        text = text.replace(f"{{{key}}}", value)
    return text
