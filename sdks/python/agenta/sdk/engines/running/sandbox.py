import asyncio
import contextvars
import functools
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Union, Text, Dict, Any, Optional

from agenta.sdk.engines.running.runners import get_runner
from agenta.sdk.engines.running.runners.base import get_code_sandbox_timeout

# Cache for the runner instance
_runner = None
_runner_lock = threading.Lock()

# Custom code runs use a thread pool of their own, not the event loop's default
# one. The default pool is small on a small pod (min(32, cpus + 4)) and LiteLLM
# completions share it, so slow sandbox runs would starve unrelated LLM calls.
#
# The pool has one thread per slot, so a run that gets a slot starts at once
# and its timeout counts from the start, not from a queue. When every slot is
# busy, a new run fails at once with a clear error. A slot frees when its thread
# ends, not when the caller stops waiting, because the thread keeps running
# after a timeout.
_SANDBOX_THREADS = 16
_sandbox_slots = threading.BoundedSemaphore(_SANDBOX_THREADS)
_sandbox_executor = ThreadPoolExecutor(
    max_workers=_SANDBOX_THREADS, thread_name_prefix="code-sandbox"
)


class SandboxBusyError(RuntimeError):
    """Every custom code slot in this worker is busy."""


def execute_code_safely(
    app_params: Dict[str, Any],
    inputs: Dict[str, Any],
    output: Union[dict, str],
    correct_answer: Any,  # for backward compatibility reasons
    code: Text,
    runtime: Optional[str] = None,
    templates: Optional[Dict[str, str]] = None,
    *,
    version: str = "1",
    trace: Optional[Dict[str, Any]] = None,
) -> Union[float, None]:
    """
    Execute the provided code safely.

    Uses the configured runner (local or remote Daytona)
    based on the AGENTA_SERVICES_CODE_SANDBOX_RUNNER environment variable
    (legacy AGENTA_SERVICES_SANDBOX_RUNNER still accepted as fallback).

    Args:
        - app_params (Dict[str, Any]): The parameters of the app variant. (v1 only)
        - inputs (Dict[str, Any]): Inputs to be used during code execution.
        - output (Union[dict, str]): The output of the app variant after being called.
        - correct_answer (Any): The correct answer (or target) of the app variant. (v1 only)
        - code (Text): The code to be executed.
        - runtime (Optional[str]): Runtime environment (python, javascript, typescript). None = python.
        - templates (Optional[Dict[str, str]]): Wrapper templates keyed by runtime.
        - version (str): Evaluator interface version ("1" = legacy, "2" = new).
        - trace (Optional[Dict[str, Any]]): Full trace data (v2 only).

    Returns:
        - (float): Result of the execution if successful. Should be between 0 and 1.
        - None if execution fails or result is not a float between 0 and 1.
    """
    global _runner

    if _runner is None:
        # Runs now start from many threads at once. Build the runner once.
        with _runner_lock:
            if _runner is None:
                _runner = get_runner()

    return _runner.run(
        code,
        app_params,
        inputs,
        output,
        correct_answer,
        runtime,
        templates,
        version=version,
        trace=trace,
    )


async def run_code_safely(
    app_params: Dict[str, Any],
    inputs: Dict[str, Any],
    output: Union[dict, str],
    correct_answer: Any,
    code: Text,
    runtime: Optional[str] = None,
    templates: Optional[Dict[str, str]] = None,
    *,
    version: str = "1",
    trace: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Run `execute_code_safely` in a worker thread, with a hard timeout.

    The runners are synchronous. The Daytona runner makes blocking HTTP calls
    for tens of seconds, so calling it on the event loop freezes the whole
    services worker: health checks and other requests stop until it returns.

    Raises:
        SandboxBusyError: Every slot is busy with another run.
        TimeoutError: The run took longer than `get_code_sandbox_timeout()`.
    """
    timeout = get_code_sandbox_timeout()

    if not _sandbox_slots.acquire(blocking=False):
        raise SandboxBusyError(
            f"Custom code runs are at capacity ({_SANDBOX_THREADS} in progress). "
            "Try again later."
        )

    try:
        context = contextvars.copy_context()
        future = _sandbox_executor.submit(
            context.run,
            functools.partial(
                execute_code_safely,
                app_params,
                inputs,
                output,
                correct_answer,
                code,
                runtime,
                templates,
                version=version,
                trace=trace,
            ),
        )
    except BaseException:
        _sandbox_slots.release()
        raise

    future.add_done_callback(lambda _: _sandbox_slots.release())

    try:
        return await asyncio.wait_for(asyncio.wrap_future(future), timeout=timeout)
    except TimeoutError as e:
        raise TimeoutError(f"Custom code run timed out after {timeout:g}s.") from e
