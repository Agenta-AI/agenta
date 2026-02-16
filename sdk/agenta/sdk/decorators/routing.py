# /agenta/sdk/decorators/routing.py

from typing import Any, Callable, Optional, AsyncGenerator, Union
from json import dumps
from uuid import UUID
from traceback import format_exception

from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceStatus,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceBaseResponse,
)
from agenta.sdk.middlewares.routing.cors import CORSMiddleware
from agenta.sdk.middlewares.routing.auth import AuthMiddleware
from agenta.sdk.middlewares.routing.otel import OTelMiddleware
from agenta.sdk.contexts.running import running_context_manager, RunningContext
from agenta.sdk.contexts.tracing import tracing_context_manager, TracingContext
from agenta.sdk.decorators.running import auto_workflow, Workflow
from agenta.sdk.workflows.errors import ErrorStatus


def create_app(**kwargs: Any) -> FastAPI:
    app = FastAPI(**kwargs)

    app.add_middleware(CORSMiddleware)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(OTelMiddleware)

    return app


default_app: FastAPI = create_app()


def _pick_stream_format(request: Request) -> str:
    if "text/event-stream" in request.headers.get("accept", ""):
        return "sse"
    return "ndjson"


def _ndjson_stream(aiter: AsyncGenerator[Any, None]):
    async def gen():
        async for chunk in aiter:
            yield dumps(chunk, ensure_ascii=False) + "\n"

    return gen()


def _sse_stream(aiter: AsyncGenerator[Any, None]):
    async def gen():
        async for chunk in aiter:
            yield "data: " + dumps(chunk, ensure_ascii=False) + "\n\n"

    return gen()


def _set_common_headers(
    res: Response,
    response: WorkflowServiceBaseResponse,
) -> Response:
    res.headers.setdefault("x-ag-version", response.version or "unknown")

    if response.trace_id:
        res.headers.setdefault("x-ag-trace-id", response.trace_id)

    if response.span_id:
        res.headers.setdefault("x-ag-span-id", response.span_id)

    return res


def _make_json_response(
    response: WorkflowServiceBatchResponse,
) -> JSONResponse:
    res = JSONResponse(
        status_code=((response.status.code or 200) if response.status else 200),
        content=response.model_dump(mode="json", exclude_none=True),
    )

    return _set_common_headers(res, response)  # type: ignore


def _make_stream_response(
    req: Request,
    response: WorkflowServiceStreamResponse,
) -> StreamingResponse:
    aiter = response.iterator()

    if _pick_stream_format(req) == "sse":
        res = StreamingResponse(
            _sse_stream(aiter),
            media_type="text/event-stream",
        )
    else:
        res = StreamingResponse(
            _ndjson_stream(aiter),
            media_type="application/x-ndjson",
        )

    return _set_common_headers(res, response)  # type: ignore


async def handle_invoke_success(
    req: Request,
    response: Any,
) -> Response:
    if isinstance(response, WorkflowServiceBatchResponse):
        return _make_json_response(response)

    if isinstance(response, WorkflowServiceStreamResponse):
        return _make_stream_response(req, response)

    batch = WorkflowServiceBatchResponse(data=response)

    return _make_json_response(batch)


async def handle_invoke_failure(exception: Exception) -> Response:
    status = None

    if isinstance(exception, ErrorStatus):
        status = WorkflowServiceStatus(
            type=exception.type,
            code=exception.code,
            message=exception.message,
            stacktrace=exception.stacktrace,
        )

    else:
        type = "https://agenta.ai/docs/errors#v1:sdk:unknown-workflow-invoke-error"

        code = (
            getattr(exception, "status_code")
            if hasattr(exception, "status_code")
            else 500
        )

        if code in [401, 403]:
            code = 424

        message = str(exception) or "Internal Server Error"

        stacktrace = format_exception(
            exception,  # type: ignore
            value=exception,
            tb=exception.__traceback__,
        )

        status = WorkflowServiceStatus(
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

    error = WorkflowServiceBatchResponse(
        status=status,
        trace_id=trace_id,
        span_id=span_id,
    )

    return _make_json_response(error)


async def handle_inspect_success(
    request: Optional[WorkflowServiceRequest],
):
    if request:
        return JSONResponse(request.model_dump(mode="json", exclude_none=True))

    return JSONResponse({"details": {"message": "Workflow not found"}}, status_code=404)


async def handle_inspect_failure(exception: Exception) -> Response:
    code = (
        getattr(exception, "status_code") if hasattr(exception, "status_code") else 500
    )

    if code in [401, 403]:
        code = 424

    message = str(exception) or "Internal Server Error"

    return JSONResponse({"details": message}, status_code=code)


class route:
    def __init__(
        self,
        path: str = "/",
        app: Optional[FastAPI] = None,
        router: Optional[APIRouter] = None,
    ):
        path = path.rstrip("/")
        path = path if path else "/"
        path = path if path.startswith("/") else "/" + path
        self.path = path
        self.root = app or router or default_app

    def __call__(self, foo: Optional[Union[Callable[..., Any], Workflow]] = None):
        if foo is None:
            return self

        workflow = auto_workflow(foo)

        async def invoke_endpoint(req: Request, request: WorkflowServiceRequest):
            credentials = req.state.auth.get("credentials")
            secrets = req.state.auth.get("secrets")

            try:
                response = await workflow.invoke(
                    request=request,
                    secrets=secrets,
                    credentials=credentials,
                )

                return await handle_invoke_success(req, response)

            except Exception as exception:
                return await handle_invoke_failure(exception)

        async def inspect_endpoint(req: Request):
            credentials = req.state.auth.get("credentials")

            try:
                request = await workflow.inspect(
                    credentials=credentials,
                )

                return await handle_inspect_success(request)

            except Exception as exception:
                return await handle_inspect_failure(exception)

        invoke_responses: dict = {
            200: {
                "description": "Response batch JSON or stream NDJSON/SSE",
                "content": {
                    "application/json": {
                        "schema": WorkflowServiceBatchResponse.model_json_schema()
                    },
                    "application/x-ndjson": {
                        "schema": {"type": "string", "description": "NDJSON stream"}
                    },
                    "text/event-stream": {
                        "schema": {"type": "string", "description": "SSE stream"}
                    },
                },
            }
        }

        self.root.add_api_route(
            self.path + "/invoke",
            invoke_endpoint,
            methods=["POST"],
            responses=invoke_responses,
        )

        self.root.add_api_route(
            self.path + "/inspect",
            inspect_endpoint,
            methods=["GET"],
            response_model=WorkflowServiceRequest,
        )

        return foo
