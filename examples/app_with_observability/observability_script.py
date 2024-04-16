import httpx
import random
import asyncio
from datetime import datetime
from bson.objectid import ObjectId
from typing import Optional, Dict, Any, List


ATTRIBUTES: Dict[str, Any] = {}
BASE_API_URL: str = "http://localhost/api/observability"


def generate_oid() -> str:
    return str(ObjectId())


async def create_trace(
    trace_id: str,
    trace_name: str,
    inputs: Dict[str, Any],
    config: Dict[str, Any],
    **kwargs: Dict[str, Any],
):
    payload = {
        "id": trace_id,
        "app_id": generate_oid(),
        "variant_id": generate_oid(),
        "trace_name": trace_name,
        "start_time": datetime.now().isoformat(),
        "inputs": inputs,
        "config": config,
        "environment": kwargs.get("environment", "python-script"),
        "tags": kwargs.get("tags", []),
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{BASE_API_URL}/traces", json=payload)
        if response.status_code == 200:
            print("Trace created successfully")
        else:
            print("Unable to start trace")


async def end_trace(
    trace_id: str,
    outputs: List[str],
    cost: Optional[float] = None,
    total_tokens: Optional[float] = None,
):
    payload = {
        "trace_id": trace_id,
        "status": "COMPLETED",
        "end_time": str(datetime.now()),
        "outputs": outputs,
        "cost": cost,
        "total_tokens": total_tokens,
    }
    async with httpx.AsyncClient() as client:
        response = await client.put(f"{BASE_API_URL}/traces/{trace_id}", json=payload)
        if response.status_code == 200:
            print("Tracing completed successfully")
        else:
            print("Unable to complete tracing")


def set_span_attributes(
    parent_key: Optional[str] = None, attributes: Dict[str, Any] = {}
) -> Dict[str, Any]:
    for key, value in attributes.items():
        if parent_key is not None:
            parent_config = ATTRIBUTES.get(parent_key, None)
            if not parent_config:
                ATTRIBUTES[parent_key] = {}
            ATTRIBUTES[parent_key][key] = value
        else:
            ATTRIBUTES[key] = value
    return ATTRIBUTES


async def create_span(trace_id: str, input: str, output: str, tokens: Dict[str, Any]):
    span_id = generate_oid()
    start_time = datetime.now().isoformat()
    set_span_attributes("model_config", {"model": "gpt-3.5-turbo", "temperature": 0.65})
    payload = {
        "trace_id": trace_id,
        "span_id": span_id,
        "event_name": "api_call",
        "event_type": "llm_request",
        "parent_span_id": None,
        "start_time": start_time,
        "end_time": datetime.now().isoformat(),
        "input": input,
        "output": output,
        "status": {"value": "COMPLETED", "error": None},
        "tokens": tokens,
        "meta": ATTRIBUTES,
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{BASE_API_URL}/spans", json=payload)
        if response.status_code == 200:
            print(f"Created trace span {span_id} successfully")
        else:
            print(f"Error creating trace span {span_id}")
            print("Response data: ", response.json())


def mock_llm_call(country: str) -> Dict[str, Any]:
    # do something with input

    randomized_completion = int(random.uniform(10.0, 40.0))
    randomized_prompt = int(random.uniform(10.0, 40.0))
    total_tokens = randomized_completion + randomized_prompt
    return {
        "message": "The capital name for Germany is Berlin.",
        "cost": random.uniform(0.0005, 1.0),
        "usage": {
            "completion_tokens": randomized_completion,
            "prompt_tokens": randomized_prompt,
            "total_tokens": total_tokens,
        },
    }


async def start_tracing():
    trace_id = generate_oid()
    llm_input = {"country": "Germany"}
    outputs = mock_llm_call(llm_input["country"])
    await create_trace(trace_id, "mock_llm_call", llm_input, {}, **{})
    await create_span(trace_id, llm_input, outputs["message"], outputs["usage"])
    await end_trace(
        trace_id,
        [outputs["message"]],
        outputs["cost"],
        outputs["usage"]["total_tokens"],
    )


if __name__ == "__main__":
    asyncio.run(start_tracing())
