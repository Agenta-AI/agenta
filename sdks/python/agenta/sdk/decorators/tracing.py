# /agenta/sdk/decorators/tracing.py

import warnings
from functools import wraps
from inspect import (
    getfullargspec,
    isasyncgen,
    isasyncgenfunction,
    iscoroutinefunction,
    isgenerator,
    isgeneratorfunction,
)
from itertools import chain
from typing import Any, Callable, Dict, List, Optional, Union

import agenta as ag
from agenta.sdk.contexts.tracing import (
    TracingContext,
    tracing_context_manager,
)
from agenta.sdk.engines.tracing.conventions import parse_span_kind
from agenta.sdk.engines.tracing.spans import CustomSpan
from agenta.sdk.redaction.context import get_active_redactor
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.logging import get_module_logger
from opentelemetry import context as otel_context
from opentelemetry.baggage import get_all, set_baggage
from opentelemetry.context import attach, detach, get_current
from opentelemetry.trace import use_span
from pydantic import BaseModel

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
        ignore_inputs: Optional[Union[bool, List[str]]] = None,
        ignore_outputs: Optional[Union[bool, List[str]]] = None,
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

    @staticmethod
    def _warn_if_not_initialized(handler_name: str) -> None:
        if ag.tracing is None:
            warnings.warn(
                f"ag.instrument() used on '{handler_name}' before ag.init() was called. "
                "Tracing will be disabled. Call ag.init() before using @ag.instrument().",
                RuntimeWarning,
                stacklevel=3,
            )

    def __call__(self, handler: Callable[..., Any]):
        is_coroutine_function = iscoroutinefunction(handler)
        is_sync_generator = isgeneratorfunction(handler)
        is_async_generator = isasyncgenfunction(handler)

        # ---- ASYNC GENERATOR ----
        if is_async_generator:

            @wraps(handler)
            def astream_wrapper(*args, **kwargs):
                self._warn_if_not_initialized(handler.__name__)
                with tracing_context_manager(context=TracingContext.get()):
                    self._parse_type_and_kind()

                    baggage_token = self._attach_baggage()

                    # Capture AFTER baggage attach so we do not wipe it later.
                    captured_ctx = otel_context.get_current()

                    ctx = self._get_traceparent()

                    # Create the span and set the link EAGERLY — before returning the
                    # generator — so ctx.link carries the trace/span ids by the time the
                    # running normalizer stamps the streaming response (it reads the link
                    # at handler-return, before the generator is ever iterated). Deferring
                    # this into the generator body left streams without x-ag-trace-id.
                    # start_span (not start_as_current_span): activation happens in the
                    # consuming task via use_span inside the wrapper.
                    span = ag.tracer.start_span(
                        name=handler.__name__, kind=self.kind, context=ctx
                    )
                    self._set_link(span)
                    with use_span(span, end_on_exit=False):
                        self._pre_instrument(span, handler, *args, **kwargs)

                    agen = handler(*args, **kwargs)

                    # Detach the baggage token HERE, in the frame that attached it — the
                    # generator below re-attaches captured_ctx (snapshotted after the
                    # attach, so it carries the baggage) with its own in-frame token.
                    # Detaching endpoint-frame tokens inside the generator finalizer runs
                    # in the ASGI streaming task -> otel "created in a different Context".
                    self._detach_baggage(baggage_token)

                    async def wrapped_generator():
                        otel_token = otel_context.attach(captured_ctx)
                        try:
                            with use_span(
                                span,
                                end_on_exit=True,
                                record_exception=True,
                                set_status_on_exception=True,
                            ):
                                _result = []
                                try:
                                    async for chunk in agen:
                                        _result.append(chunk)
                                        yield chunk
                                finally:
                                    self._post_instrument(
                                        span, self._join_stream(_result)
                                    )
                        finally:
                            with suppress():
                                otel_context.detach(otel_token)

                    return wrapped_generator()

            setattr(astream_wrapper, "__has_instrument__", True)
            setattr(astream_wrapper, "__original_handler__", handler)
            return astream_wrapper

        # ---- SYNC GENERATOR ----
        if is_sync_generator:

            @wraps(handler)
            def stream_wrapper(*args, **kwargs):
                self._warn_if_not_initialized(handler.__name__)
                with tracing_context_manager(context=TracingContext.get()):
                    self._parse_type_and_kind()

                    token = self._attach_baggage()

                    captured_ctx = otel_context.get_current()

                    ctx = self._get_traceparent()

                    # Eager span + link so the streaming response carries the trace/span
                    # ids (see the async-generator wrapper above for the full rationale).
                    # A sync-generator handler stays SYNC here (a direct programmatic
                    # caller iterates it with a for-loop), so it gets its own sync drain
                    # rather than the async _wrap_returned_gen.
                    span = ag.tracer.start_span(
                        name=handler.__name__, kind=self.kind, context=ctx
                    )
                    self._set_link(span)
                    with use_span(span, end_on_exit=False):
                        self._pre_instrument(span, handler, *args, **kwargs)

                    gen = handler(*args, **kwargs)

                    # In-frame baggage detach (see astream_wrapper): captured_ctx carries
                    # the baggage into the generator's own paired attach.
                    self._detach_baggage(token)

                    def wrapped_generator():
                        otel_token = otel_context.attach(captured_ctx)
                        try:
                            with use_span(
                                span,
                                end_on_exit=True,
                                record_exception=True,
                                set_status_on_exception=True,
                            ):
                                acc = []
                                gen_return = None
                                try:
                                    while True:
                                        try:
                                            chunk = next(gen)
                                        except StopIteration as e:
                                            gen_return = e.value
                                            break
                                        acc.append(chunk)
                                        yield chunk
                                finally:
                                    self._post_instrument(span, self._join_stream(acc))
                                return gen_return
                        finally:
                            with suppress():
                                otel_context.detach(otel_token)

                    return wrapped_generator()

            setattr(stream_wrapper, "__has_instrument__", True)
            setattr(stream_wrapper, "__original_handler__", handler)
            return stream_wrapper

        # ---- ASYNC FUNCTION ----
        if is_coroutine_function:

            @wraps(handler)
            async def awrapper(*args, **kwargs):
                self._warn_if_not_initialized(handler.__name__)
                with tracing_context_manager(context=TracingContext.get()):
                    # debug_otel_context("[ASYNC] [BEFORE BATCH] [BEFORE SETUP]")

                    self._parse_type_and_kind()

                    token = self._attach_baggage()

                    # Captured AFTER baggage attach so a returned-generator hand-off can
                    # re-attach the SAME otel context when the wrapper is iterated in a
                    # different task (context vars are per-task; this is what keeps the
                    # span current — and correctly parented — during consumption).
                    captured_ctx = otel_context.get_current()

                    ctx = self._get_traceparent()

                    # start_span (NOT start_as_current_span): create the span WITHOUT
                    # activating it in this task's context, so nothing leaks if we hand it
                    # off. `use_span` activates it exactly where it should be current.
                    span = ag.tracer.start_span(
                        name=handler.__name__, kind=self.kind, context=ctx
                    )
                    handed_off = False
                    try:
                        with use_span(
                            span,
                            end_on_exit=False,
                            record_exception=True,
                            set_status_on_exception=True,
                        ):
                            self._set_link(span)
                            self._pre_instrument(span, handler, *args, **kwargs)
                            result = await handler(*args, **kwargs)

                            # A coroutine that RETURNS a generator is a stream, not a
                            # batch. Hand the (created, not-yet-ended) span to a wrapper
                            # that keeps it current across consumption and records the
                            # DRAINED content — not the generator object's repr.
                            if isasyncgen(result) or isgenerator(result):
                                handed_off = True
                                return self._wrap_returned_gen(
                                    result, span, captured_ctx
                                )

                            self._post_instrument(span, result)
                            return result
                    finally:
                        if not handed_off:
                            span.end()
                        # Baggage detaches in THIS frame even on hand-off (the wrapper
                        # re-attaches captured_ctx, which carries it, in the consuming
                        # task); detaching there hits a different Context and otel logs.
                        self._detach_baggage(token)

            setattr(awrapper, "__has_instrument__", True)
            setattr(awrapper, "__original_handler__", handler)
            return awrapper

        # ---- SYNC FUNCTION ----
        @wraps(handler)
        def wrapper(*args, **kwargs):
            self._warn_if_not_initialized(handler.__name__)
            with tracing_context_manager(context=TracingContext.get()):
                # debug_otel_context("[.SYNC] [BEFORE BATCH] [BEFORE SETUP]")

                self._parse_type_and_kind()

                token = self._attach_baggage()

                captured_ctx = otel_context.get_current()

                ctx = self._get_traceparent()

                span = ag.tracer.start_span(
                    name=handler.__name__, kind=self.kind, context=ctx
                )
                handed_off = False
                try:
                    with use_span(
                        span,
                        end_on_exit=False,
                        record_exception=True,
                        set_status_on_exception=True,
                    ):
                        self._set_link(span)
                        self._pre_instrument(span, handler, *args, **kwargs)
                        result = handler(*args, **kwargs)

                        # A sync def that RETURNS a generator is a stream, not a batch.
                        # Hand the span to a wrapper that drains it and records content.
                        # A sync generator stays SYNC (so `for x in fn()` still works); an
                        # async generator uses the async wrapper.
                        if isgenerator(result):
                            handed_off = True
                            return self._wrap_returned_sync_gen(
                                result, span, captured_ctx
                            )
                        if isasyncgen(result):
                            handed_off = True
                            return self._wrap_returned_gen(result, span, captured_ctx)

                        self._post_instrument(span, result)
                        return result
                finally:
                    if not handed_off:
                        span.end()
                    # In-frame baggage detach even on hand-off (see awrapper).
                    self._detach_baggage(token)

        setattr(wrapper, "__has_instrument__", True)
        setattr(wrapper, "__original_handler__", handler)
        return wrapper

    def _parse_type_and_kind(self):
        if not ag.tracing.get_current_span().is_recording():
            self.type = "workflow"

        self.kind = parse_span_kind(self.type)

    @staticmethod
    def _join_stream(chunks: list):
        """Collapse accumulated stream chunks the way the generator wrappers do:
        all-str -> joined string, all-bytes -> joined bytes, else the list."""
        if all(isinstance(r, str) for r in chunks):
            return "".join(chunks)
        if all(isinstance(r, bytes) for r in chunks):
            return b"".join(chunks)
        return chunks

    def _wrap_returned_gen(self, gen, span, captured_ctx):
        """Keep a batch-path span open across a RETURNED generator's consumption.

        A `def`/`async def` that RETURNS a generator (rather than `yield`ing) is not a
        generator function, so it lands in the batch wrapper — but its value is a stream.
        Recording that value would stamp the generator OBJECT's repr as outputs and end the
        span before the first item is consumed. Instead we take the (created, not-ended)
        span and, inside this async generator, re-attach the captured otel context (which
        carries the baggage — no endpoint-frame token crosses tasks) and `use_span` it so
        the span is CURRENT during iteration — so nested spans created mid-stream parent
        correctly, and it never leaks onto a sibling created after invoke() returned. The
        span is ended (end_on_exit) in the finally, after the drained content is recorded.
        Mirrors the yield-based astream_wrapper contract; span currency lives in the
        consuming task, not the (already-returned) batch wrapper's task.
        """

        async def wrapped():
            otel_token = otel_context.attach(captured_ctx)
            try:
                with use_span(
                    span,
                    end_on_exit=True,
                    record_exception=True,
                    set_status_on_exception=True,
                ):
                    acc = []
                    try:
                        if isasyncgen(gen):
                            async for chunk in gen:
                                acc.append(chunk)
                                yield chunk
                        else:
                            for chunk in gen:
                                acc.append(chunk)
                                yield chunk
                    finally:
                        self._post_instrument(span, self._join_stream(acc))
            finally:
                # Detach can run in a DIFFERENT context frame than the attach when the
                # stream is closed abnormally — mid-stream raise, or the ASGI server
                # calling aclose() from another task (StreamingResponse). OTel raises
                # "Token created in a different Context" there. Guard it: the leaked
                # activation dies with the task anyway, and crashing the teardown would
                # mask the real error. (Thread/task-safety: span currency is per-task
                # contextvar; this only cleans up THIS task's activation.)
                with suppress():
                    otel_context.detach(otel_token)

        return wrapped()

    def _wrap_returned_sync_gen(self, gen, span, captured_ctx):
        """Sync counterpart of `_wrap_returned_gen`: keep a batch-path span open across a
        RETURNED sync generator's consumption WITHOUT turning it into an async generator.

        A `def` that RETURNS a sync generator lands in the sync batch wrapper. Handing it to
        the async `_wrap_returned_gen` would change a sync caller's return type to an async
        generator (breaking `for x in fn(): ...`). This keeps it sync.
        """

        def wrapped():
            otel_token = otel_context.attach(captured_ctx)
            try:
                with use_span(
                    span,
                    end_on_exit=True,
                    record_exception=True,
                    set_status_on_exception=True,
                ):
                    acc = []
                    try:
                        for chunk in gen:
                            acc.append(chunk)
                            yield chunk
                    finally:
                        self._post_instrument(span, self._join_stream(acc))
            finally:
                with suppress():
                    otel_context.detach(otel_token)

        return wrapped()

    def _get_traceparent(self):
        context = TracingContext.get()

        traceparent = context.traceparent

        if not context.link:
            for key, value in get_all(get_current()).items():
                traceparent = set_baggage(name=key, value=value, context=traceparent)

            return traceparent

    def _set_link(self, span):
        if not isinstance(span, CustomSpan):
            span = CustomSpan(span)

        context = TracingContext.get()

        if not context.link:
            context.link = {
                "trace_id": span.get_span_context().trace_id,
                "span_id": span.get_span_context().span_id,
            }

            TracingContext.set(context)

    def _attach_baggage(self):
        context = TracingContext.get()
        otel_ctx = get_current()

        # 1. Propagate any incoming `ag.*` baggage as-is (for example
        # `ag.meta.session_id`) so all nested spans inherit it.
        if context.baggage:
            for k, v in context.baggage.items():
                if not isinstance(k, str) or not k.startswith("ag."):
                    continue
                if v is None:
                    continue
                otel_ctx = set_baggage(name=k, value=str(v), context=otel_ctx)

        # 2. Propagate Agenta references in baggage (used for linking traces to
        # application/variant/environment).
        if context.references:
            for k, v in context.references.items():
                if v is None:
                    continue
                if isinstance(v, BaseModel):
                    try:
                        v = v.model_dump(mode="json", exclude_none=True)
                    except Exception:  # pylint: disable=bare-except
                        pass
                if isinstance(v, dict):
                    for field, value in v.items():
                        otel_ctx = set_baggage(
                            name=f"ag.refs.{k}.{field}",
                            value=str(value),
                            context=otel_ctx,
                        )
                    continue
                otel_ctx = set_baggage(
                    name=f"ag.refs.{k}", value=str(v), context=otel_ctx
                )

        # Propagate the selector key alongside the references so downstream
        # spans record which environment slot selected the resolved revision.
        if context.selector and context.selector.get("key") is not None:
            otel_ctx = set_baggage(
                name="ag.selector.key",
                value=str(context.selector["key"]),
                context=otel_ctx,
            )

        # Attach once so we can reliably detach later.
        return attach(otel_ctx)

    def _detach_baggage(
        self,
        token,
    ):
        # detach can run in a different context frame than attach when a stream is
        # closed abnormally (mid-stream raise, or ASGI aclose() from another task).
        # OTel raises "Token created in a different Context" there; guard it so the
        # teardown never masks the real error. The activation dies with the task.
        if token:
            with suppress():
                detach(token)

    def _pre_instrument(
        self,
        span,
        handler,
        *args,
        **kwargs,
    ):
        if not isinstance(span, CustomSpan):
            span = CustomSpan(span)

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
        span,
        result,
    ):
        if not isinstance(span, CustomSpan):
            span = CustomSpan(span)

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
            except Exception:  # pylint: disable=bare-except
                if self.redact_on_error:
                    io = {}

        if ag.tracing.redact is not None:
            try:
                io = ag.tracing.redact(name, field, io)
            except Exception:  # pylint: disable=bare-except
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

        # Known-value credential/secret scrub, always on, after any user-defined redaction —
        # capture stays on, but a live secret can't survive to the span.
        io = get_active_redactor().redact_json(io, sink="span")

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
