import inspect
from functools import wraps
from itertools import chain
from contextvars import ContextVar
from typing import Callable, Optional, Union, Any, Dict, List

import agenta as ag

from agenta.sdk.context.tracing import tracing_context


class instrument:
    DEFAULT_KEY = "__default__"

    def __init__(
        self,
        kind: str = "UNKNOWN",
        config: Optional[Dict[str, Any]] = None,
        ignore_inputs: Optional[bool] = None,
        ignore_outputs: Optional[bool] = None,
        # DEPRECATED
        spankind: Optional[str] = "UNKNOWN",
    ) -> None:
        self.kind = spankind if spankind is not None else kind
        self.config = config
        self.ignore_inputs = ignore_inputs
        self.ignore_outputs = ignore_outputs

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        def parse(*args, **kwargs) -> Dict[str, Any]:
            inputs = {
                key: value
                for key, value in chain(
                    zip(inspect.getfullargspec(func).args, args),
                    kwargs.items(),
                )
            }

            return inputs

        def redact(
            io: Dict[str, Any], ignore: List[str] | bool = False
        ) -> Dict[str, Any]:
            """
            Redact user-defined sensitive information from inputs and outputs as defined by the ignore list or boolean flag.

            Example:
            - ignore = ["password"] -> {"username": "admin", "password": "********"} -> {"username": "admin"}
            - ignore = True -> {"username": "admin", "password": "********"} -> {}
            - ignore = False -> {"username": "admin", "password": "********"} -> {"username": "admin", "password": "********"}
            """
            io = {
                key: value
                for key, value in io.items()
                if key
                not in (
                    ignore
                    if isinstance(ignore, list)
                    else io.keys() if ignore is True else []
                )
            }

            return io

        def patch(result: Any) -> Dict[str, Any]:
            """
            Patch the result to ensure that it is a dictionary, with a default key when necessary.

            Example:
            - result = "Hello, World!" -> {"__default__": "Hello, World!"}
            - result = {"message": "Hello, World!", "cost": 0.0, "usage": {}} -> {"__default__": "Hello, World!"}
            - result = {"message": "Hello, World!"} -> {"message": "Hello, World!"}
            """
            outputs = (
                {instrument.DEFAULT_KEY: result}
                if not isinstance(result, dict)
                else (
                    {instrument.DEFAULT_KEY: result["message"]}
                    if all(key in result for key in ["message", "cost", "usage"])
                    else result
                )
            )

            return outputs

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            async def wrapped_func(*args, **kwargs):
                with ag.tracing.start_as_current_span(func.__name__, self.kind):
                    try:
                        rctx = tracing_context.get()
                        ag.tracing.set_attributes(
                            "metadata", {"config": rctx.get("config", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"environment": rctx.get("environment", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"version": rctx.get("version", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"variant": rctx.get("variant", {})}
                        )

                        ag.tracing.set_attributes(
                            "data.inputs",
                            redact(parse(*args, **kwargs), self.ignore_inputs),
                        )

                        result = await func(*args, **kwargs)

                        cost = 0.0
                        usage = {}
                        if isinstance(result, dict):
                            cost = result.get("cost", 0.0)
                            usage = result.get("usage", {})

                        ag.tracing.set_attributes(
                            namespace="metrics.marginal.costs",
                            attributes={"total": cost},
                        )
                        ag.tracing.set_attributes(
                            namespace="metrics.marginal.tokens",
                            attributes=(
                                {
                                    "prompt": usage.get("prompt_tokens", 0),
                                    "completion": usage.get("completion_tokens", 0),
                                    "total": usage.get("total_tokens", 0),
                                }
                            ),
                        )

                        ag.tracing.set_attributes(
                            "data.outputs",
                            redact(patch(result), self.ignore_outputs),
                        )

                        ag.tracing.set_status("OK")

                        return result

                    except Exception as e:
                        ag.tracing.record_exception(e)

                        ag.tracing.set_status("ERROR")

                        raise e

            return await wrapped_func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            def wrapped_func(*args, **kwargs):
                with ag.tracing.start_as_current_span(func.__name__, self.kind):
                    try:
                        rctx = tracing_context.get()
                        ag.tracing.set_attributes(
                            "metadata", {"config": rctx.get("config", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"environment": rctx.get("environment", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"version": rctx.get("version", {})}
                        )
                        ag.tracing.set_attributes(
                            "metadata", {"variant": rctx.get("variant", {})}
                        )

                        ag.tracing.set_attributes(
                            "data.inputs",
                            redact(parse(*args, **kwargs), self.ignore_inputs),
                        )

                        result = func(*args, **kwargs)

                        cost = 0.0
                        usage = {}
                        if isinstance(result, dict):
                            cost = result.get("cost", 0.0)
                            usage = result.get("usage", {})

                        ag.tracing.set_attributes(
                            namespace="metrics.marginal.costs",
                            attributes={"total": cost},
                        )
                        ag.tracing.set_attributes(
                            namespace="metrics.marginal.tokens",
                            attributes=(
                                {
                                    "prompt": usage.get("prompt_tokens", 0),
                                    "completion": usage.get("completion_tokens", 0),
                                    "total": usage.get("total_tokens", 0),
                                }
                            ),
                        )
                        ag.tracing.set_attributes(
                            "data.outputs",
                            redact(patch(result), self.ignore_outputs),
                        )
                        ag.tracing.set_status("OK")

                        return result

                    except Exception as e:
                        ag.tracing.record_exception(e)

                        ag.tracing.set_status("ERROR")

                        raise e

            return wrapped_func(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper
