from typing import Callable, Optional, Any, Dict, List, Union
from functools import wraps
from itertools import chain
from inspect import iscoroutinefunction, getfullargspec

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.context.tracing import tracing_context
from agenta.sdk.tracing.conventions import parse_span_kind

import agenta as ag


class instrument:  # pylint: disable=invalid-name
    DEFAULT_KEY = "__default__"

    def __init__(
        self,
        type: str = "task",  # pylint: disable=redefined-builtin
        config: Optional[Dict[str, Any]] = None,
        ignore_inputs: Optional[bool] = None,
        ignore_outputs: Optional[bool] = None,
        max_depth: Optional[int] = 2,
        # DEPRECATING
        kind: str = "task",
        spankind: Optional[str] = "TASK",
    ) -> None:
        self.type = spankind or kind or type
        self.kind = None
        self.config = config
        self.ignore_inputs = ignore_inputs
        self.ignore_outputs = ignore_outputs
        self.max_depth = max_depth

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = iscoroutinefunction(func)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            async def _async_auto_instrumented(*args, **kwargs):
                self._parse_type_and_kind()

                with ag.tracer.start_as_current_span(func.__name__, kind=self.kind):
                    self._pre_instrument(func, *args, **kwargs)

                    result = await func(*args, **kwargs)

                    self._post_instrument(result)

                    return result

            return await _async_auto_instrumented(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            def _sync_auto_instrumented(*args, **kwargs):
                self._parse_type_and_kind()

                with ag.tracer.start_as_current_span(func.__name__, kind=self.kind):
                    self._pre_instrument(func, *args, **kwargs)

                    result = func(*args, **kwargs)

                    self._post_instrument(result)

                    return result

            return _sync_auto_instrumented(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper

    def _parse_type_and_kind(self):
        if not ag.tracing.get_current_span().is_recording():
            self.type = "workflow"

        self.kind = parse_span_kind(self.type)

    def _pre_instrument(
        self,
        func,
        *args,
        **kwargs,
    ):
        span = ag.tracing.get_current_span()

        with suppress():
            span.set_attributes(
                attributes={"node": self.type},
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

            _inputs = self._redact(
                self._parse(
                    func,
                    *args,
                    **kwargs,
                ),
                self.ignore_inputs,
            )
            span.set_attributes(
                attributes={"inputs": _inputs},
                namespace="data",
                max_depth=self.max_depth,
            )

    def _post_instrument(
        self,
        result,
    ):
        span = ag.tracing.get_current_span()
        with suppress():
            cost = None
            usage = {}

            if isinstance(result, dict):
                cost = result.get("cost", None)
                usage = result.get("usage", {})

            if isinstance(usage, (int, float)):
                usage = {"total_tokens": usage}

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

            _outputs = self._redact(self._patch(result), self.ignore_outputs)
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

    def _parse(
        self,
        func,
        *args,
        **kwargs,
    ) -> Dict[str, Any]:
        inputs = {
            key: value
            for key, value in chain(
                zip(getfullargspec(func).args, args),
                kwargs.items(),
            )
        }

        return inputs

    def _redact(
        self,
        io: Dict[str, Any],
        ignore: Union[List[str], bool] = False,
    ) -> Dict[str, Any]:
        """
        Redact user-defined sensitive information
        from inputs and outputs as defined by the ignore list or boolean flag.

        Example:
        - ignore = ["password"] -> {"username": "admin", "password": "********"}
            -> {"username": "admin"}
        - ignore = True -> {"username": "admin", "password": "********"}
            -> {}
        - ignore = False -> {"username": "admin", "password": "********"}
            -> {"username": "admin", "password": "********"}
        """
        io = {
            key: value
            for key, value in io.items()
            if key
            not in (
                ignore
                if isinstance(ignore, list)
                else io.keys()
                if ignore is True
                else []
            )
        }

        return io

    def _patch(
        self,
        result: Any,
    ) -> Dict[str, Any]:
        """
        Patch the result to ensure that it is a dictionary, with a default key when necessary.

        Example:
        - result = "Hello, World!"
            -> {"__default__": "Hello, World!"}
        - result = {"message": "Hello, World!", "cost": 0.0, "usage": {}}
            -> {"__default__": "Hello, World!"}
        - result = {"message": "Hello, World!"}
            -> {"message": "Hello, World!"}
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
