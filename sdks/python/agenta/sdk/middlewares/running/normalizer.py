# /agenta/sdk/middlewares/running/normalizer.py
import inspect
from typing import Any, Dict, Callable, Optional, Union
from inspect import isawaitable, isasyncgen, isgenerator
from traceback import format_exception
from uuid import UUID


from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.models.workflows import (
    WorkflowServiceStatus,
    WorkflowRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowInvokeRequestFlags,
)
from agenta.sdk.models.shared import resolve_session_id
from agenta.sdk.engines.running.errors import ErrorStatus
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.contexts.tracing import TracingContext
from agenta.sdk.utils.logging import get_module_logger


log = get_module_logger(__name__)


class NormalizerMiddleware:
    """Middleware that normalizes workflow service requests and responses.

    This middleware performs two key normalization operations:

    1. **Request Normalization**: Transforms a WorkflowServiceRequest into the appropriate
       keyword arguments for the workflow handler function by:
       - Mapping request data fields to handler function parameters
       - Extracting inputs from request.data.inputs and mapping them to function parameters
       - Handling special parameters like 'request' and WorkflowRequestData fields
       - Supporting **kwargs expansion for additional fields

    2. **Response Normalization**: Transforms handler function results into standardized
       WorkflowServiceBatchResponse or WorkflowServiceStreamResponse objects by:
       - Handling various return types (plain values, awaitables, generators, async generators)
       - Always passing generators through as WorkflowServiceStreamResponse (batch/stream
         decision is made at the routing boundary via Accept header negotiation)
       - Extracting trace_id and span_id from TracingContext for observability
       - Wrapping raw outputs in proper response structures

    The middleware ensures consistent interfaces between the workflow service layer and
    the actual handler functions, allowing handlers to use simple function signatures
    while maintaining structured request/response formats at the service boundary.
    """

    DATA_FIELDS = set(("request",)) | set(WorkflowRequestData.model_fields.keys())

    async def _normalize_request(
        self,
        request: WorkflowServiceRequest,
        handler: Callable,
    ) -> Dict[str, Any]:
        """Transform a WorkflowServiceRequest into kwargs for the handler function.

        Inspects the handler's function signature and maps the request data to the
        appropriate parameter names and values. The mapping follows this priority order:

        1. If parameter name is 'request': passes the entire WorkflowServiceRequest
        2. If parameter name matches DATA_FIELDS (like 'inputs', 'outputs', 'parameters'):
           extracts that field from request.data
        3. If parameter name is a supported top-level request field like 'session_id':
           extracts that field from the request envelope
        4. If parameter is **kwargs: includes all unconsumed DATA_FIELDS
        5. Otherwise: looks up the parameter name in request.data.inputs dict

        Args:
            request: The workflow service request containing inputs and data
            handler: The callable workflow handler whose signature to inspect

        Returns:
            Dictionary mapping parameter names to values for calling the handler
        """
        if request.data and request.data.parameters is None:
            request.data.parameters = {}

        sig = inspect.signature(handler)
        params = sig.parameters
        normalized: Dict[str, Any] = {}
        consumed = set()

        for name, param in params.items():
            if name == "request":
                normalized[name] = request
                consumed.add(name)

            elif name in self.DATA_FIELDS:
                normalized[name] = (
                    getattr(request.data, name, None) if request.data else None
                )
                consumed.add(name)

            elif name == "session_id":
                normalized[name] = request.session_id
                consumed.add(name)

            elif param.kind == inspect.Parameter.VAR_KEYWORD:
                if request.data:
                    for f in self.DATA_FIELDS - consumed:
                        normalized[f] = getattr(request.data, f, None)
                consumed |= self.DATA_FIELDS

            else:
                if request.data and isinstance(request.data.inputs, dict):
                    if name in request.data.inputs:
                        normalized[name] = request.data.inputs[name]
                        consumed.add(name)
                        continue
                normalized[name] = None

        return normalized

    @staticmethod
    def _correlation_ids():
        """trace_id / span_id (from the span link) + session_id — all off the
        TracingContext, the single source for response correlation ids."""
        trace_id = None
        span_id = None
        session_id = None
        ctx = TracingContext.get()
        # session_id is read independently of the trace/span link so a malformed
        # link can never drop it from the response.
        session_id = ctx.session_id
        with suppress():
            link = ctx.link or {}
            _trace_id = link.get("trace_id") if link else None  # in int format
            _span_id = link.get("span_id") if link else None  # in int format
            if isinstance(_trace_id, int):
                trace_id = UUID(int=_trace_id).hex
            if isinstance(_span_id, int):
                span_id = UUID(int=_span_id).hex[16:]
        return trace_id, span_id, session_id

    async def _normalize_response(
        self,
        result: Any,
        flags: Optional[WorkflowInvokeRequestFlags] = None,
    ) -> Union[
        WorkflowServiceBatchResponse,
        WorkflowServiceStreamResponse,
    ]:
        flags = flags or WorkflowInvokeRequestFlags()

        if isawaitable(result):
            result = await result

        trace_id, span_id, session_id = self._correlation_ids()

        # Already a typed response — pass through, stamp the correlation ids.
        if isinstance(
            result, (WorkflowServiceBatchResponse, WorkflowServiceStreamResponse)
        ):
            result.trace_id = trace_id
            result.span_id = span_id
            result.session_id = session_id
            return result

        # Generators always pass through as a stream response; batch/stream is handler-owned.
        if isasyncgen(result) or isgenerator(result):
            iterator = self._async_iterator(result)
            return WorkflowServiceStreamResponse(
                generator=iterator,
                trace_id=trace_id,
                span_id=span_id,
                session_id=session_id,
            )

        # Direct return passes through unmodified; the handler owns its output shape.
        return WorkflowServiceBatchResponse(
            data=WorkflowServiceResponseData(outputs=result),
            trace_id=trace_id,
            span_id=span_id,
            session_id=session_id,
        )

    @staticmethod
    def _async_iterator(result):
        """Wrap a sync or async generator as a no-arg async-generator factory."""
        if isasyncgen(result):

            async def iterator():
                async for item in result:
                    yield item

        else:

            async def iterator():
                for item in result:
                    yield item

        return iterator

    async def _normalize_exception(
        self,
        exc: Exception,
    ) -> WorkflowServiceBatchResponse:
        error_status = None
        # Traceback is logged server-side only, never returned to the client.
        stacktrace = None

        if isinstance(exc, ErrorStatus):
            stacktrace = exc.stacktrace
            error_status = WorkflowServiceStatus(
                type=exc.type,
                code=exc.code,
                message=exc.message,
            )
        else:
            type = "https://agenta.ai/docs/errors#v1:sdk:unknown-workflow-invoke-error"

            code = getattr(exc, "status_code") if hasattr(exc, "status_code") else 500

            if code in [401, 403, 429]:  # Downstream API errors
                code = 424

            message = str(exc) or "Internal Server Error"

            stacktrace = "".join(
                format_exception(
                    exc,  # type: ignore
                    value=exc,
                    tb=exc.__traceback__,
                )
            )

            error_status = WorkflowServiceStatus(
                type=type,
                code=code,
                message=message,
            )

        trace_id, span_id, session_id = self._correlation_ids()

        error_response = WorkflowServiceBatchResponse(
            status=error_status,
            trace_id=trace_id,
            span_id=span_id,
            session_id=session_id,
        )

        log.warning(
            "Workflow handler invocation failed",
            status_code=error_status.code if error_status else None,
            status_type=error_status.type if error_status else None,
            message=error_status.message if error_status else None,
            stacktrace=stacktrace,
            trace_id=trace_id,
            span_id=span_id,
        )

        return error_response

    async def __call__(
        self,
        request: WorkflowServiceRequest,
        call_next: Callable[[WorkflowServiceRequest], Any],
    ):
        ctx = RunningContext.get()
        handler = ctx.handler

        if not handler:
            raise RuntimeError("NormalizerMiddleware: no handler set in context")

        # Resolve session_id ONCE, before the handler runs (mint when absent). Put
        # it on the TracingContext via a SCOPED set (copy + token reset) — never
        # mutate the shared context instance in place, or it leaks across invokes.
        # It is the single source the response constructors read correlation ids
        # from; the handler also sees it on the request, and it lands on the span.
        session_id = resolve_session_id(request.session_id)
        request.session_id = session_id

        scoped = TracingContext.get().model_copy(deep=True)
        scoped.session_id = session_id
        token = TracingContext.set(scoped)
        try:
            if session_id:
                import agenta as ag

                if ag.tracing is not None:
                    ag.tracing.store_session(session_id=session_id)

            kwargs = await self._normalize_request(request, handler)

            flags = WorkflowInvokeRequestFlags(**(request.flags or {}))

            try:
                response = handler(**kwargs)

                normalized = await self._normalize_response(response, flags=flags)

            except Exception as exception:
                normalized = await self._normalize_exception(exception)

            return normalized
        finally:
            TracingContext.reset(token)
