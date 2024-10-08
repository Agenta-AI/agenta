import inspect
from functools import wraps
from itertools import chain
from typing import Callable, Optional, Any, Dict, List

import agenta as ag


from agenta.sdk.utils.exceptions import suppress

from agenta.sdk.context.tracing import tracing_context
from agenta.sdk.tracing.conventions import parse_span_kind


class instrument:
    DEFAULT_KEY = "__default__"

    def __init__(
        self,
        kind: str = "task",
        config: Optional[Dict[str, Any]] = None,
        ignore_inputs: Optional[bool] = None,
        ignore_outputs: Optional[bool] = None,
        max_depth: Optional[int] = 2,
        # DEPRECATED
        spankind: Optional[str] = "TASK",
    ) -> None:
        self.kind = spankind if spankind is not None else kind
        self.config = config
        self.ignore_inputs = ignore_inputs
        self.ignore_outputs = ignore_outputs
        self.max_depth = max_depth

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
                if not ag.tracing.get_current_span().is_recording():
                    self.kind = "workflow"

                kind = parse_span_kind(self.kind)

                with ag.tracer.start_as_current_span(func.__name__, kind=kind):
                    span = ag.tracing.get_current_span()

                    with suppress():
                        span.set_attributes(
                            attributes={"node": self.kind},
                            namespace="type",
                        )

                        if span.parent is None:
                            rctx = tracing_context.get()

                            span.set_attributes(
                                attributes={"configuration": rctx.get("config", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"environment": rctx.get("environment", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"version": rctx.get("version", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"variant": rctx.get("variant", {})},
                                namespace="meta",
                            )

                        _inputs = redact(parse(*args, **kwargs), self.ignore_inputs)
                        span.set_attributes(
                            attributes={"inputs": _inputs},
                            namespace="data",
                            max_depth=self.max_depth,
                        )

                    try:
                        result = await func(*args, **kwargs)
                    except Exception as e:
                        span.record_exception(e)

                        span.set_status("ERROR")

                        raise e

                    with suppress():
                        cost = None
                        usage = {}
                        if isinstance(result, dict):
                            cost = result.get("cost", None)
                            usage = result.get("usage", {})

                        span.set_attributes(
                            attributes={"total": cost},
                            namespace="metrics.unit.costs",
                        )
                        span.set_attributes(
                            attributes=(
                                {
                                    "prompt": usage.get("prompt_tokens", None),
                                    "completion": usage.get("completion_tokens", None),
                                    "total": usage.get("total_tokens", None),
                                }
                            ),
                            namespace="metrics.unit.tokens",
                        )

                        _outputs = redact(patch(result), self.ignore_outputs)
                        span.set_attributes(
                            attributes={"outputs": _outputs},
                            namespace="data",
                            max_depth=self.max_depth,
                        )

                        span.set_status("OK")

                    with suppress():
                        if hasattr(span, "parent") and span.parent is None:
                            tracing_context.set(
                                tracing_context.get()
                                | {
                                    "root": {
                                        "trace_id": span.get_span_context().trace_id,
                                        "span_id": span.get_span_context().span_id,
                                    }
                                }
                            )

                    return result

            return await wrapped_func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            def wrapped_func(*args, **kwargs):
                if not ag.tracing.get_current_span().is_recording():
                    self.kind = "workflow"

                kind = parse_span_kind(self.kind)

                with ag.tracer.start_as_current_span(func.__name__, kind=kind):
                    span = ag.tracing.get_current_span()

                    with suppress():
                        span.set_attributes(
                            attributes={"node": self.kind},
                            namespace="type",
                        )

                        if span.parent is None:
                            rctx = tracing_context.get()

                            span.set_attributes(
                                attributes={"configuration": rctx.get("config", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"environment": rctx.get("environment", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"version": rctx.get("version", {})},
                                namespace="meta",
                            )
                            span.set_attributes(
                                attributes={"variant": rctx.get("variant", {})},
                                namespace="meta",
                            )

                        _inputs = redact(parse(*args, **kwargs), self.ignore_inputs)
                        span.set_attributes(
                            attributes={"inputs": _inputs},
                            namespace="data",
                            max_depth=self.max_depth,
                        )

                    try:
                        result = func(*args, **kwargs)
                    except Exception as e:
                        span.record_exception(e)

                        span.set_status("ERROR")

                        raise e

                    with suppress():
                        cost = None
                        usage = {}
                        if isinstance(result, dict):
                            cost = result.get("cost", None)
                            usage = result.get("usage", {})

                        span.set_attributes(
                            attributes={"total": cost},
                            namespace="metrics.unit.costs",
                        )
                        span.set_attributes(
                            attributes=(
                                {
                                    "prompt": usage.get("prompt_tokens", None),
                                    "completion": usage.get("completion_tokens", None),
                                    "total": usage.get("total_tokens", None),
                                }
                            ),
                            namespace="metrics.unit.tokens",
                        )

                        _outputs = redact(patch(result), self.ignore_outputs)
                        span.set_attributes(
                            attributes={"outputs": _outputs},
                            namespace="data",
                            max_depth=self.max_depth,
                        )

                        span.set_status("OK")

                    with suppress():
                        if hasattr(span, "parent") and span.parent is None:
                            tracing_context.set(
                                tracing_context.get()
                                | {
                                    "root": {
                                        "trace_id": span.get_span_context().trace_id,
                                        "span_id": span.get_span_context().span_id,
                                    }
                                }
                            )

                    return result

            return wrapped_func(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper
