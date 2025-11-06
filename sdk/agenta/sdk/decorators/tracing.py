# /agenta/sdk/decorators/tracing.py

from typing import Callable, Optional, Any, Dict, List, Union

from opentelemetry import context as otel_context
from opentelemetry.context import attach, detach


from functools import wraps
from itertools import chain
from inspect import (
    getfullargspec,
    iscoroutinefunction,
    isgeneratorfunction,
    isasyncgenfunction,
)

from pydantic import BaseModel

from opentelemetry import baggage
from opentelemetry.context import attach, detach, get_current
from opentelemetry.baggage import set_baggage, get_all

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.contexts.tracing import (
    TracingContext,
    tracing_context_manager,
)
from agenta.sdk.tracing.conventions import parse_span_kind

import agenta as ag


log = get_module_logger(__name__)


def _has_instrument(handler: Callable[..., Any]) -> bool:
    return bool(getattr(handler, "__has_instrument__", False))


def auto_instrument(handler: Callable[..., Any]) -> Callable[..., Any]:
    if _has_instrument(handler):
        return handler

    return instrument()(handler)


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
        aggregate: Optional[Union[bool, Callable]] = None,  # stream to batch
        annotate: Optional[bool] = None,  # annotation vs invocation
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
        self.aggregate = aggregate
        self.annotate = annotate

    def __call__(self, handler: Callable[..., Any]):
        is_coroutine_function = iscoroutinefunction(handler)
        is_sync_generator = isgeneratorfunction(handler)
        is_async_generator = isasyncgenfunction(handler)

        # ---- ASYNC GENERATOR ----
        if is_async_generator:

            @wraps(handler)
            def astream_wrapper(*args, **kwargs):
                with tracing_context_manager(context=TracingContext.get()):
                    # debug_otel_context("[BEFORE STREAM] [BEFORE SETUP]")

                    captured_ctx = otel_context.get_current()

                    self._parse_type_and_kind()

                    self._attach_baggage()

                    ctx = self._get_traceparent()

                    # debug_otel_context("[BEFORE STREAM] [AFTER SETUP]")

                    async def wrapped_generator():
                        # debug_otel_context("[WITHIN STREAM] [BEFORE ATTACH]")

                        otel_token = otel_context.attach(captured_ctx)

                        # debug_otel_context("[WITHIN STREAM] [AFTER ATTACH]")

                        try:
                            with ag.tracer.start_as_current_span(
                                name=handler.__name__,
                                kind=self.kind,
                                context=ctx,
                            ):
                                self._set_link()
                                self._pre_instrument(handler, *args, **kwargs)

                                _result = []

                                agen = handler(*args, **kwargs)

                                try:
                                    async for chunk in agen:
                                        _result.append(chunk)
                                        yield chunk

                                finally:
                                    if self.aggregate and callable(self.aggregate):
                                        result = self.aggregate(_result)
                                    elif all(isinstance(r, str) for r in _result):
                                        result = "".join(_result)
                                    elif all(isinstance(r, bytes) for r in _result):
                                        result = b"".join(_result)
                                    else:
                                        result = _result

                                    self._post_instrument(result)

                        finally:
                            # debug_otel_context("[WITHIN STREAM] [BEFORE DETACH]")

                            otel_context.detach(otel_token)

                            # debug_otel_context("[WITHIN STREAM] [AFTER DETACH]")

                return wrapped_generator()

            setattr(astream_wrapper, "__has_instrument__", True)
            setattr(astream_wrapper, "__original_handler__", handler)
            return astream_wrapper

        # ---- SYNC GENERATOR ----
        if is_sync_generator:

            @wraps(handler)
            def stream_wrapper(*args, **kwargs):
                with tracing_context_manager(context=TracingContext.get()):
                    self._parse_type_and_kind()

                    token = self._attach_baggage()

                    ctx = self._get_traceparent()

                    def wrapped_generator():
                        try:
                            with ag.tracer.start_as_current_span(
                                name=handler.__name__,
                                kind=self.kind,
                                context=ctx,
                            ):
                                self._set_link()

                                self._pre_instrument(handler, *args, **kwargs)

                                _result = []

                                gen = handler(*args, **kwargs)

                                gen_return = None

                                try:
                                    while True:
                                        try:
                                            chunk = next(gen)
                                        except StopIteration as e:
                                            gen_return = e.value
                                            break

                                        _result.append(chunk)
                                        yield chunk

                                finally:
                                    if self.aggregate and callable(self.aggregate):
                                        result = self.aggregate(_result)
                                    elif all(isinstance(r, str) for r in _result):
                                        result = "".join(_result)
                                    elif all(isinstance(r, bytes) for r in _result):
                                        result = b"".join(_result)
                                    else:
                                        result = _result

                                    self._post_instrument(result)

                                return gen_return

                        finally:
                            self._detach_baggage(token)

                return wrapped_generator()

            setattr(stream_wrapper, "__has_instrument__", True)
            setattr(stream_wrapper, "__original_handler__", handler)
            return stream_wrapper

        # ---- ASYNC FUNCTION ----
        if is_coroutine_function:

            @wraps(handler)
            async def awrapper(*args, **kwargs):
                with tracing_context_manager(context=TracingContext.get()):
                    self._parse_type_and_kind()

                    token = self._attach_baggage()

                    ctx = self._get_traceparent()

                    try:
                        with ag.tracer.start_as_current_span(
                            name=handler.__name__,
                            kind=self.kind,
                            context=ctx,
                        ):
                            self._set_link()

                            self._pre_instrument(handler, *args, **kwargs)

                            result = await handler(*args, **kwargs)

                            self._post_instrument(result)

                    finally:
                        self._detach_baggage(token)

                    return result

            setattr(awrapper, "__has_instrument__", True)
            setattr(awrapper, "__original_handler__", handler)
            return awrapper

        # ---- SYNC FUNCTION ----
        @wraps(handler)
        def wrapper(*args, **kwargs):
            with tracing_context_manager(context=TracingContext.get()):
                self._parse_type_and_kind()

                token = self._attach_baggage()

                ctx = self._get_traceparent()

                try:
                    with ag.tracer.start_as_current_span(
                        name=handler.__name__,
                        kind=self.kind,
                        context=ctx,
                    ):
                        self._set_link()

                        self._pre_instrument(handler, *args, **kwargs)

                        result = handler(*args, **kwargs)

                        self._post_instrument(result)

                finally:
                    self._detach_baggage(token)

                return result

        setattr(wrapper, "__has_instrument__", True)
        setattr(wrapper, "__original_handler__", handler)
        return wrapper

    def _parse_type_and_kind(self):
        if not ag.tracing.get_current_span().is_recording():
            self.type = "workflow"

        self.kind = parse_span_kind(self.type)

    def _get_traceparent(self):
        context = TracingContext.get()

        traceparent = context.traceparent

        if not context.link:
            for key, value in get_all(get_current()).items():
                traceparent = set_baggage(name=key, value=value, context=traceparent)

            return traceparent

    def _set_link(self):
        span = ag.tracing.get_current_span()

        context = TracingContext.get()

        if not context.link:
            context.link = {
                "trace_id": span.get_span_context().trace_id,
                "span_id": span.get_span_context().span_id,
            }

            TracingContext.set(context)

    def _attach_baggage(self):
        context = TracingContext.get()

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
        handler,
        *args,
        **kwargs,
    ):
        span = ag.tracing.get_current_span()

        context = TracingContext.get()

        with suppress():
            trace_id = span.context.trace_id

            ag.tracing.credentials.put(trace_id, context.credentials)

            span_type = self.type or "task"

            span.set_attributes(
                attributes={
                    "node": span_type,
                },
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
                io=self._parse(handler, *args, **kwargs),
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
        handler,
        *args,
        **kwargs,
    ) -> Dict[str, Any]:
        inputs = {
            key: value
            for key, value in chain(
                zip(getfullargspec(handler).args, args),
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

        if "request" in io:
            with suppress():
                if isinstance(io["request"], BaseModel):
                    io["request"] = io["request"].model_dump(
                        mode="json",
                        exclude_none=True,
                    )

        if "response" in io:
            with suppress():
                if isinstance(io["response"], BaseModel):
                    io["response"] = io["response"].model_dump(
                        mode="json",
                        exclude_none=True,
                    )

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
