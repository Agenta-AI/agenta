from typing import Any

import httpx
import backoff


@backoff.on_exception(
    backoff.expo,
    (httpx.TimeoutException, httpx.ConnectTimeout, httpx.ConnectError),
    max_tries=2,
)
def get_llm_app_output(uri: str, input: Any) -> Any:
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

    with httpx.Client() as client:
        response = client.post(
            url, json=payload, timeout=httpx.Timeout(timeout=5, read=None, write=5)
        )
        response.raise_for_status()
        return response.json()
