"""
Polling utilities for waiting on asynchronous operations in tests.
"""

import time
from typing import Callable, Optional, Any, Dict


def wait_for_condition(
    check_fn: Callable[[], tuple[bool, Any]],
    *,
    max_retries: int = 15,
    initial_delay: float = 0.5,
    max_delay: float = 8.0,
    timeout_message: str = "Condition not met within timeout",
) -> Any:
    """
    Poll until a condition is met using exponential backoff.

    Args:
        check_fn: Function that returns (condition_met: bool, result: Any)
        max_retries: Maximum number of polling attempts
        initial_delay: Initial delay between attempts in seconds
        max_delay: Maximum delay between attempts in seconds
        timeout_message: Error message if condition is not met

    Returns:
        The result from check_fn when condition is met

    Raises:
        TimeoutError: If condition is not met within max_retries

    Example:
        def check():
            resp = api_call()
            return (resp.status_code == 200, resp)

        result = wait_for_condition(check, max_retries=10)
    """
    delay = initial_delay

    for attempt in range(max_retries):
        condition_met, result = check_fn()

        if condition_met:
            return result

        if attempt < max_retries - 1:  # Don't sleep after last attempt
            time.sleep(delay)
            delay = min(delay * 2, max_delay)

    raise TimeoutError(f"{timeout_message} after {max_retries} attempts")


def wait_for_response(
    authed_api,
    method: str,
    endpoint: str,
    *,
    json: Optional[Dict] = None,
    expected_status: int = 200,
    condition_fn: Optional[Callable[[Any], bool]] = None,
    max_retries: int = 15,
    initial_delay: float = 0.5,
    max_delay: float = 8.0,
):
    """
    Fetch from API with exponential backoff until conditions are met.

    This is a generalized polling function that can be used for any API endpoint
    that requires waiting for asynchronous operations to complete.

    Uses exponential backoff to reduce API calls while providing sufficient wait time:
    - With max_retries=15, initial_delay=0.5s, max_delay=8s:
      - Delays: 0.5s, 1s, 2s, 4s, 8s, 8s, 8s, 8s, 8s...
      - Total API calls: 15
      - Total wait time: ~88 seconds
      - Average rate: ~10 req/min

    Args:
        authed_api: Authenticated API client fixture
        method: HTTP method (GET, POST, PUT, DELETE, etc.)
        endpoint: API endpoint path (e.g., "/preview/tracing/spans/query")
        json: Optional JSON payload for the request
        expected_status: Expected HTTP status code (default: 200)
        condition_fn: Optional function to validate response beyond status code.
                     Receives response object, returns True if condition met.
                     Example: lambda r: r.json().get("count") > 0
        max_retries: Maximum number of polling attempts (default: 15)
        initial_delay: Initial delay between attempts in seconds (default: 0.5)
        max_delay: Maximum delay between attempts in seconds (default: 8.0)

    Returns:
        Response object when all conditions are met

    Examples:
        # Wait for spans with specific trace_id
        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/tracing/spans/query",
            json={"filter": {"conditions": [{"field": "trace_id", "value": "123"}]}},
            condition_fn=lambda r: r.json().get("count", 0) >= 2
        )

        # Wait for trace to exist
        response = wait_for_response(
            authed_api,
            "GET",
            "/preview/tracing/traces/abc123",
            condition_fn=lambda r: r.json()["count"] == 1,
            max_retries=10
        )
    """
    delay = initial_delay

    for attempt in range(max_retries):
        # Make API request
        if json is not None:
            resp = authed_api(method, endpoint, json=json)
        else:
            resp = authed_api(method, endpoint)

        # Check status code
        status_match = resp.status_code == expected_status

        # Check custom condition if provided
        condition_match = True
        if condition_fn is not None:
            try:
                condition_match = condition_fn(resp)
            except Exception:
                # If condition function fails (e.g., KeyError), condition not met
                condition_match = False

        # Return if all conditions met
        if status_match and condition_match:
            return resp

        # Exponential backoff (don't sleep after last attempt)
        if attempt < max_retries - 1:
            time.sleep(delay)
            delay = min(delay * 2, max_delay)

    # Return last response for assertion/debugging
    return resp
