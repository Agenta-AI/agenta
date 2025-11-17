# /agenta/sdk/middlewares/running/normalizer.py
import inspect
from typing import Any, Dict, Callable, Union
from inspect import isawaitable, isasyncgen, isgenerator
from traceback import format_exception
from uuid import UUID


from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.models.workflows import (
    WorkflowServiceStatus,
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)
from agenta.sdk.workflows.errors import ErrorStatus
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.contexts.tracing import TracingContext


class NormalizerMiddleware:
    """Middleware that normalizes workflow service requests and responses.

    This middleware performs two key normalization operations:

    1. **Request Normalization**: Transforms a WorkflowServiceRequest into the appropriate
       keyword arguments for the workflow handler function by:
       - Mapping request data fields to handler function parameters
       - Extracting inputs from request.data.inputs and mapping them to function parameters
       - Handling special parameters like 'request' and WorkflowServiceRequestData fields
       - Supporting **kwargs expansion for additional fields

    2. **Response Normalization**: Transforms handler function results into standardized
       WorkflowServiceBatchResponse or WorkflowServiceStreamResponse objects by:
       - Handling various return types (plain values, awaitables, generators, async generators)
       - Aggregating streaming results into batches when aggregate flag is set
       - Extracting trace_id and span_id from TracingContext for observability
       - Wrapping raw outputs in proper response structures

    The middleware ensures consistent interfaces between the workflow service layer and
    the actual handler functions, allowing handlers to use simple function signatures
    while maintaining structured request/response formats at the service boundary.
    """

    DATA_FIELDS = set(("request",)) | set(
        WorkflowServiceRequestData.model_fields.keys()
    )

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
        3. If parameter is **kwargs: includes all unconsumed DATA_FIELDS
        4. Otherwise: looks up the parameter name in request.data.inputs dict

        Args:
            request: The workflow service request containing inputs and data
            handler: The callable workflow handler whose signature to inspect

        Returns:
            Dictionary mapping parameter names to values for calling the handler
        """
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

    async def _normalize_response(
        self,
        result: Any,
    ) -> Union[
        WorkflowServiceBatchResponse,
        WorkflowServiceStreamResponse,
    ]:
        if isawaitable(result):
            result = await result

        if isinstance(
            result, (WorkflowServiceBatchResponse, WorkflowServiceStreamResponse)
        ):
            trace_id = None
            span_id = None

            with suppress():
                link = (TracingContext.get().link) or {}

                _trace_id = link.get("trace_id") if link else None  # in int format
                _span_id = link.get("span_id") if link else None  # in int format

                trace_id = UUID(int=_trace_id).hex if _trace_id else None
                span_id = UUID(int=_span_id).hex[16:] if _span_id else None

            result.trace_id = trace_id
            result.span_id = span_id

            return result

        if isasyncgen(result):
            if RunningContext.get().aggregate:
                collected = [item async for item in result]

                trace_id = None
                span_id = None

                with suppress():
                    link = (TracingContext.get().link) or {}

                    _trace_id = link.get("trace_id") if link else None  # in int format
                    _span_id = link.get("span_id") if link else None  # in int format

                    trace_id = UUID(int=_trace_id).hex if _trace_id else None
                    span_id = UUID(int=_span_id).hex[16:] if _span_id else None

                return WorkflowServiceBatchResponse(
                    data=WorkflowServiceResponseData(outputs=collected),
                    trace_id=trace_id,
                    span_id=span_id,
                )

            async def iterator():
                async for item in result:
                    yield item

            trace_id = None
            span_id = None

            with suppress():
                link = (TracingContext.get().link) or {}

                _trace_id = link.get("trace_id") if link else None  # in int format
                _span_id = link.get("span_id") if link else None  # in int format

                trace_id = UUID(int=_trace_id).hex if _trace_id else None
                span_id = UUID(int=_span_id).hex[16:] if _span_id else None

            return WorkflowServiceStreamResponse(
                generator=iterator,
                trace_id=trace_id,
                span_id=span_id,
            )

        if isgenerator(result):
            if RunningContext.get().aggregate:
                collected = list(result)

                trace_id = None
                span_id = None

                with suppress():
                    link = (TracingContext.get().link) or {}

                    _trace_id = link.get("trace_id") if link else None  # in int format
                    _span_id = link.get("span_id") if link else None  # in int format

                    trace_id = UUID(int=_trace_id).hex if _trace_id else None
                    span_id = UUID(int=_span_id).hex[16:] if _span_id else None

                return WorkflowServiceBatchResponse(
                    data=WorkflowServiceResponseData(outputs=collected),
                    trace_id=trace_id,
                    span_id=span_id,
                )

            async def iterator():
                for item in result:
                    yield item

            trace_id = None
            span_id = None

            with suppress():
                link = (TracingContext.get().link) or {}

                _trace_id = link.get("trace_id") if link else None  # in int format
                _span_id = link.get("span_id") if link else None  # in int format

                trace_id = UUID(int=_trace_id).hex if _trace_id else None
                span_id = UUID(int=_span_id).hex[16:] if _span_id else None

            return WorkflowServiceStreamResponse(
                generator=iterator,
                trace_id=trace_id,
                span_id=span_id,
            )

        trace_id = None
        span_id = None

        with suppress():
            link = (TracingContext.get().link) or {}

            _trace_id = link.get("trace_id") if link else None  # in int format
            _span_id = link.get("span_id") if link else None  # in int format

            trace_id = UUID(int=_trace_id).hex if _trace_id else None
            span_id = UUID(int=_span_id).hex[16:] if _span_id else None

        return WorkflowServiceBatchResponse(
            data=WorkflowServiceResponseData(outputs=result),
            trace_id=trace_id,
            span_id=span_id,
        )

    async def _normalize_exception(
        self,
        exc: Exception,
    ) -> WorkflowServiceBatchResponse:
        error_status = None

        if isinstance(exc, ErrorStatus):
            error_status = WorkflowServiceStatus(
                type=exc.type,
                code=exc.code,
                message=exc.message,
                stacktrace=exc.stacktrace,
            )
        else:
            type = "https://agenta.ai/docs/errors#v1:sdk:unknown-workflow-invoke-error"

            code = getattr(exc, "status_code") if hasattr(exc, "status_code") else 500

            if code in [401, 403]:
                code = 424

            message = str(exc) or "Internal Server Error"

            stacktrace = format_exception(
                exc,  # type: ignore
                value=exc,
                tb=exc.__traceback__,
            )

            error_status = WorkflowServiceStatus(
                type=type,
                code=code,
                message=message,
                stacktrace=stacktrace,
            )

        trace_id = None
        span_id = None

        with suppress():
            link = (TracingContext.get().link) or {}

            _trace_id = link.get("trace_id") if link else None  # in int format
            _span_id = link.get("span_id") if link else None  # in int format

            trace_id = UUID(int=_trace_id).hex if _trace_id else None
            span_id = UUID(int=_span_id).hex[16:] if _span_id else None

        error_response = WorkflowServiceBatchResponse(
            status=error_status,
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

        kwargs = await self._normalize_request(request, handler)

        try:
            response = handler(**kwargs)

            normalized = await self._normalize_response(response)

        except Exception as exception:
            normalized = await self._normalize_exception(exception)

            return normalized

        return normalized
