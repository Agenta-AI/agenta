import asyncio
import logging
from typing import Any, List

from agenta_backend.models.api.evaluation_model import AppOutput

import httpx


# Set logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def get_llm_app_output(uri: str, input: Any) -> AppOutput:
    url = f"{uri}/generate"

    # TODO: adjust these hardcoded values in this payload
    payload = {
        "temperature": 1,
        "model": "gpt-3.5-turbo",
        "max_tokens": -1,
        "prompt_system": "You are an expert in geography.",
        "prompt_user": f"What is the capital of {input}?",
        "top_p": 1,
        "inputs": {"country": input},
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url, json=payload, timeout=httpx.Timeout(timeout=5, read=None, write=5)
        )
        response.raise_for_status()
        return AppOutput(output=response.json(), status="success")


async def run_with_retry(
    uri: str, input_data: Any, max_retry_count: int, retry_delay: int
) -> AppOutput:
    retries = 0
    while retries < max_retry_count:
        try:
            result = await get_llm_app_output(uri, input_data)
            return result
        except (httpx.TimeoutException, httpx.ConnectTimeout, httpx.ConnectError) as e:
            print(f"Error in evaluation. Retrying in {retry_delay} seconds:", e)
            await asyncio.sleep(retry_delay)
            retries += 1

    # If max retries reached, raise the last exception
    raise e


async def batch_invoke(uri: str, testset_data: List[dict]) -> List[AppOutput]:
    batch_size = 10  # Number of evaluations to make in each batch
    max_retries = 3  # Maximum number of times to retry a failed evaluation
    retry_delay = 3  # Delay before retrying a failed evaluation (in seconds)
    delay_between_batches = 5  # Delay between batches (in seconds)
    list_of_app_outputs: List[AppOutput] = [] # Outputs after running all batches

    async def run_batch(start_idx: int):
        print(f"Preparing {start_idx} batch...")
        end_idx = min(start_idx + batch_size, len(testset_data))
        for index in range(start_idx, end_idx):
            print(f"Running datapoint(s) in {start_idx} batch...")
            try:
                batch_output: AppOutput = await run_with_retry(uri, testset_data[index], max_retries, retry_delay)
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
