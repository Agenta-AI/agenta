from typing import Callable, Optional, Any, Dict, List, Union

from functools import wraps
from itertools import chain
from inspect import iscoroutinefunction, getfullargspec

from opentelemetry import baggage
from opentelemetry.trace import NonRecordingSpan
from opentelemetry.context import attach, detach, get_current
from opentelemetry.baggage import set_baggage, get_all

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.context.tracing import tracing_context
from agenta.sdk.tracing.conventions import parse_span_kind


from agenta.sdk.utils.logging import get_module_logger

import agenta as ag

log = get_module_logger(__name__)


class instrument:  # pylint: disable=invalid-name
    DEFAULT_KEY = "__default__"

    def __init__(
        self,
        type: str = "task",  # pylint: disable=redefined-builtin
        config: Optional[Dict[str, Any]] = None,
        ignore_inputs: Optional[bool] = None,
        ignore_outputs: Optional[bool] = None,
        redact: Optional[Callable[..., Any]] = None,
        redact_on_error: Optional[bool] = True,
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
        self.redact = redact
        self.redact_on_error = redact_on_error
        self.max_depth = max_depth

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = iscoroutinefunction(func)

        @wraps(func)
        async def awrapper(*args, **kwargs):
            async def aauto_instrumented(*args, **kwargs):
                self._parse_type_and_kind()

                token = self._attach_baggage()

                ctx = self._get_traceparent()

                with ag.tracer.start_as_current_span(
                    name=func.__name__,
                    kind=self.kind,
                    context=ctx,
                ) as span:
                    self._set_link()

                    self._pre_instrument(func, *args, **kwargs)

                    result = await func(*args, **kwargs)

                    self._post_instrument(result)

                    return result

                self._detach_baggage(token)

            return await aauto_instrumented(*args, **kwargs)

        @wraps(func)
        def wrapper(*args, **kwargs):
            def auto_instrumented(*args, **kwargs):
                self._parse_type_and_kind()

                token = self._attach_baggage()

                ctx = self._get_traceparent()

                with ag.tracer.start_as_current_span(
                    name=func.__name__,
                    kind=self.kind,
                    context=ctx,
                ) as span:
                    self._set_link()

                    self._pre_instrument(func, *args, **kwargs)

                    result = func(*args, **kwargs)

                    self._post_instrument(result)

                    return result

                self._detach_baggage(token)

            return auto_instrumented(*args, **kwargs)

        return awrapper if is_coroutine_function else wrapper

    def _parse_type_and_kind(self):
        if not ag.tracing.get_current_span().is_recording():
            self.type = "workflow"

        self.kind = parse_span_kind(self.type)

    def _get_traceparent(self):
        context = tracing_context.get()

        traceparent = context.traceparent

        if not context.link:
            for key, value in get_all(get_current()).items():
                traceparent = set_baggage(name=key, value=value, context=traceparent)

            return traceparent

    def _set_link(self):
        span = ag.tracing.get_current_span()

        context = tracing_context.get()

        if not context.link:
            context.link = {
                "trace_id": span.get_span_context().trace_id,
                "span_id": span.get_span_context().span_id,
            }

            tracing_context.set(context)

    def _attach_baggage(self):
        context = tracing_context.get()

        references = context.references

        token = None
        if references:
            for k, v in references.items():
                token = attach(baggage.set_baggage(f"ag.refs.{k}", v))

        return token

    def _detach_baggage(
        self,
        token,
    ):
        if token:
            detach(token)

    def _pre_instrument(
        self,
        func,
        *args,
        **kwargs,
    ):
        span = ag.tracing.get_current_span()

        context = tracing_context.get()

        with suppress():
            trace_id = span.context.trace_id

            ag.tracing.credentials.put(trace_id, context.credentials)

            span.set_attributes(
                attributes={"node": self.type},
                namespace="type",
            )

            if span.parent is None:
                span.set_attributes(
                    attributes={"configuration": context.parameters or {}},
                    namespace="meta",
                )

            _inputs = self._redact(
                name=span.name,
                field="inputs",
                io=self._parse(func, *args, **kwargs),
                ignore=self.ignore_inputs,
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
                attributes={"total": float(cost) if cost else None},
                namespace="metrics.unit.costs",
            )
            span.set_attributes(
                attributes=(
                    {
                        "prompt": (
                            float(usage.get("prompt_tokens"))
                            if usage.get("prompt_tokens", None)
                            else None
                        ),
                        "completion": (
                            float(usage.get("completion_tokens"))
                            if usage.get("completion_tokens", None)
                            else None
                        ),
                        "total": (
                            float(usage.get("total_tokens", None))
                            if usage.get("total_tokens", None)
                            else None
                        ),
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            _outputs = self._redact(
                name=span.name,
                field="outputs",
                io=self._patch(result),
                ignore=self.ignore_outputs,
            )

            span.set_attributes(
                attributes={"outputs": _outputs},
                namespace="data",
                max_depth=self.max_depth,
            )

            span.set_status("OK")

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
        *,
        name: str,
        field: str,
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

        if self.redact is not None:
            try:
                io = self.redact(name, field, io)
            except:  # pylint: disable=bare-except
                if self.redact_on_error:
                    io = {}

        if ag.tracing.redact is not None:
            try:
                io = ag.tracing.redact(name, field, io)
            except:  # pylint: disable=bare-except
                if ag.tracing.redact_on_error:
                    io = {}

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
