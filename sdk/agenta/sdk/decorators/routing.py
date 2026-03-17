# /agenta/sdk/decorators/routing.py

import warnings
from typing import Any, Callable, Optional, AsyncGenerator, Union
from json import dumps
from uuid import UUID
from traceback import format_exception

from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.openapi.utils import get_openapi
from starlette.routing import Mount

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceStatus,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
    WorkflowServiceBaseResponse,
    WorkflowServiceResponseData,
)
from agenta.sdk.middlewares.routing.cors import CORSMiddleware
from agenta.sdk.middlewares.routing.auth import AuthMiddleware
from agenta.sdk.middlewares.routing.otel import OTelMiddleware
from agenta.sdk.middlewares.running.vault import invalidate_secrets_cache
from agenta.sdk.contexts.tracing import TracingContext
from agenta.sdk.decorators.running import auto_workflow, Workflow
from agenta.sdk.engines.running.errors import ErrorStatus


# ---------------------------------------------------------------------------
# Reserved path segments — may not appear anywhere in a route path.
# These names are used by the per-route namespace triple itself.
# ---------------------------------------------------------------------------

_RESERVED_PATHS = {"invoke", "inspect", "openapi.json"}


def _validate_path(path: str) -> None:
    """Raise ValueError if *path* contains a reserved segment."""
    segments = [s for s in path.strip("/").split("/") if s]
    for segment in segments:
        if segment in _RESERVED_PATHS:
            raise ValueError(
                f"Route path {path!r} contains reserved segment {segment!r}. "
                f"The following path names are reserved and may not be used "
                f"as route paths: {sorted(_RESERVED_PATHS)}"
            )


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app(**kwargs: Any) -> FastAPI:
    app = FastAPI(**kwargs)

    app.add_middleware(CORSMiddleware)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(OTelMiddleware)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


default_app: FastAPI = create_app()


# ---------------------------------------------------------------------------
# Mount-ordering helper
# ---------------------------------------------------------------------------


def _ensure_root_is_last(app: FastAPI) -> None:
    """Re-sort mounted sub-apps so the '/' catch-all is always last.

    Starlette matches routes in order: a Mount("/") will absorb every request
    that reaches it, so it must come after all more-specific mounts.
    """
    routes = app.router.routes
    # Starlette normalises mount("/") to path="" internally; accept both forms.
    root_mounts = [r for r in routes if isinstance(r, Mount) and r.path in ("", "/")]
    others = [r for r in routes if r not in root_mounts]
    app.router.routes[:] = others + root_mounts


# ---------------------------------------------------------------------------
# OpenAPI schema enrichment
# ---------------------------------------------------------------------------


def _attach_openapi_schema(
    sub_app: FastAPI,
    workflow_name: str,
    schemas: Any,  # Optional[JsonSchemas]
) -> None:
    """Override sub_app.openapi() to include workflow-specific input/output schemas.

    The enrichment strategy:
    1. Add ``info["x-agenta-schemas"]`` containing whichever of inputs/outputs/
       parameters are defined — always readable regardless of FastAPI version.
    2. Patch the corresponding field inside the relevant OpenAPI component so
       swagger-ui and code-gen tools show the actual shapes:
       - ``WorkflowServiceRequestData.inputs``  ← schemas.inputs
       - ``WorkflowServiceResponseData.outputs`` ← schemas.outputs
       - ``WorkflowServiceConfiguration.parameters`` ← schemas.parameters
    """

    def custom_openapi() -> dict:
        if sub_app.openapi_schema:
            return sub_app.openapi_schema

        schema = get_openapi(
            title=workflow_name,
            version="0.1.0",
            routes=sub_app.routes,
        )

        if schemas is not None:
            agenta_schemas: dict = {}

            if schemas.inputs is not None:
                agenta_schemas["inputs"] = schemas.inputs
                _patch_component_field(
                    schema,
                    component="WorkflowServiceRequestData",
                    field="inputs",
                    new_schema=schemas.inputs,
                )

            if schemas.outputs is not None:
                agenta_schemas["outputs"] = schemas.outputs
                _patch_component_field(
                    schema,
                    component="WorkflowServiceResponseData",
                    field="outputs",
                    new_schema=schemas.outputs,
                )

            if schemas.parameters is not None:
                agenta_schemas["parameters"] = schemas.parameters
                _patch_component_field(
                    schema,
                    component="WorkflowServiceConfiguration",
                    field="parameters",
                    new_schema=schemas.parameters,
                )

            if agenta_schemas:
                schema.setdefault("info", {})["x-agenta-schemas"] = agenta_schemas

        sub_app.openapi_schema = schema
        return schema

    sub_app.openapi = custom_openapi  # type: ignore[method-assign]


def _patch_component_field(
    openapi_schema: dict,
    *,
    component: str,
    field: str,
    new_schema: dict,
) -> None:
    """Replace a field inside an OpenAPI component's properties with *new_schema*."""
    try:
        props = (
            openapi_schema.get("components", {})
            .get("schemas", {})
            .get(component, {})
            .get("properties", {})
        )
        if field in props:
            props[field] = new_schema
    except (TypeError, KeyError):
        pass


# ---------------------------------------------------------------------------
# Content negotiation
# ---------------------------------------------------------------------------

BATCH_MEDIA_TYPES = frozenset({"application/json"})
STREAM_MEDIA_TYPES = frozenset(
    {"text/event-stream", "application/x-ndjson", "application/jsonl"}
)
SUPPORTED_MEDIA_TYPES = BATCH_MEDIA_TYPES | STREAM_MEDIA_TYPES


def _parse_accept(request: Request) -> Optional[str]:
    """Return the first matching supported media type, or None for */* / absent.

    None means the server picks the best format for what the handler returned.
    """
    accept = request.headers.get("accept", "")
    # Sort longest-first so "application/jsonl" is checked before "application/json"
    # (the shorter string is a substring of the longer one).
    for media_type in sorted(SUPPORTED_MEDIA_TYPES, key=len, reverse=True):
        if media_type in accept:
            return media_type
    return None  # */* or absent — server picks


def _stream_wire_format(media_type: str) -> str:
    """Map a streaming Accept media type to its wire format name."""
    if media_type == "text/event-stream":
        return "sse"
    return "ndjson"  # application/x-ndjson, application/jsonl


# ---------------------------------------------------------------------------
# HTTP response helpers
# ---------------------------------------------------------------------------


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
    response: WorkflowServiceStreamResponse,
    wire_format: str,
) -> StreamingResponse:
    aiter = response.iterator()

    if wire_format == "sse":
        media_type = "text/event-stream"
        res = StreamingResponse(_sse_stream(aiter), media_type=media_type)
    elif wire_format == "ndjson":
        media_type = "application/x-ndjson"
        res = StreamingResponse(_ndjson_stream(aiter), media_type=media_type)
    else:
        media_type = "application/x-ndjson"
        res = StreamingResponse(_ndjson_stream(aiter), media_type=media_type)

    return _set_common_headers(res, response)  # type: ignore


def _make_not_acceptable_response(
    requested: str,
    response: WorkflowServiceBaseResponse,
) -> JSONResponse:
    """Return 406 when the handler's output cannot satisfy the requested Accept type."""
    is_batch = isinstance(response, WorkflowServiceBatchResponse)
    supported = sorted(BATCH_MEDIA_TYPES) if is_batch else sorted(STREAM_MEDIA_TYPES)

    body: dict = {
        "detail": (
            f"Runnable produced a {'batch' if is_batch else 'stream'} response "
            f"but Accept requested {requested!r}."
        ),
        "requested": requested,
        "supported": supported,
    }

    if response.trace_id:
        body["trace_id"] = response.trace_id
    if response.span_id:
        body["span_id"] = response.span_id

    return JSONResponse(status_code=406, content=body)


async def handle_invoke_success(
    req: Request,
    response: Any,
) -> Response:
    # Normalise raw values that escaped the middleware chain
    if not isinstance(
        response, (WorkflowServiceBatchResponse, WorkflowServiceStreamResponse)
    ):
        response = WorkflowServiceBatchResponse(
            data=WorkflowServiceResponseData(outputs=response)
        )

    is_batch = isinstance(response, WorkflowServiceBatchResponse)
    is_stream = isinstance(response, WorkflowServiceStreamResponse)

    requested = _parse_accept(req)

    # No preference — server picks the natural format for what the handler returned
    if requested is None:
        if is_batch:
            return _make_json_response(response)
        return _make_stream_response(response, "ndjson")

    # Caller wants JSON — only satisfiable by a batch response
    if requested in BATCH_MEDIA_TYPES:
        if is_batch:
            return _make_json_response(response)
        return _make_not_acceptable_response(requested, response)

    # Caller wants a stream format — only satisfiable by a stream response
    if requested in STREAM_MEDIA_TYPES:
        if is_stream:
            return _make_stream_response(response, _stream_wire_format(requested))
        return _make_not_acceptable_response(requested, response)

    # Unreachable: _parse_accept only returns types in SUPPORTED_MEDIA_TYPES or None
    return (
        _make_json_response(response)
        if is_batch
        else _make_stream_response(response, "ndjson")
    )


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

        if code in [401, 403, 429]:  # Downstream API errors
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

    if code in [401, 403, 429]:  # Downstream API errors
        code = 424

    message = str(exception) or "Internal Server Error"

    return JSONResponse({"details": message}, status_code=code)


# ---------------------------------------------------------------------------
# route decorator
# ---------------------------------------------------------------------------


class route:
    def __init__(
        self,
        path: str = "/",
        app: Optional[FastAPI] = None,
        router: Optional[APIRouter] = None,
        flags: Optional[dict] = None,
    ):
        path = path.rstrip("/")
        path = path if path else "/"
        path = path if path.startswith("/") else "/" + path
        _validate_path(path)
        self.path = path
        self.mount_root = app or default_app
        # router= is kept for backward compat but does not provide isolation.
        self.router_fallback = router
        self.flags = flags

    def __call__(self, foo: Optional[Union[Callable[..., Any], Workflow]] = None):
        if foo is None:
            return self

        if self.router_fallback is not None:
            warnings.warn(
                "Passing router= to route() is deprecated and will be removed in a "
                "future version. Use app= or omit to use the default app. "
                "The router= parameter does not support per-route namespace isolation "
                "and will not produce a per-route openapi.json.",
                DeprecationWarning,
                stacklevel=2,
            )

        wf = auto_workflow(foo, flags=self.flags)

        # ------------------------------------------------------------------
        # Resolve the workflow name, schemas, and interface from the
        # underlying workflow decorator instance.
        # running._extend_handler() sets wrapper.__agenta_workflow__ = self
        # so we can reach interface.schemas synchronously at decoration time.
        # ------------------------------------------------------------------
        _workflow_name = getattr(foo, "__name__", "workflow")
        _schemas = None
        try:
            _wf_instance = getattr(
                getattr(wf, "_fn", None), "__agenta_workflow__", None
            )
            if _wf_instance is not None:
                _iface = getattr(_wf_instance, "interface", None)
                _schemas = getattr(_iface, "schemas", None) if _iface else None
        except Exception:
            pass

        # ------------------------------------------------------------------
        # Build the two endpoint closures (same logic as before).
        # ------------------------------------------------------------------

        async def invoke_endpoint(req: Request, request: WorkflowServiceRequest):
            credentials = req.state.auth.get("credentials")

            try:
                response = await wf.invoke(
                    request=request,
                    secrets=None,
                    credentials=credentials,
                )

                status = getattr(response, "status", None)
                status_type = getattr(status, "type", None)

                if isinstance(status_type, str) and status_type.endswith(
                    "#v0:schemas:invalid-secrets"
                ):
                    invalidate_secrets_cache(credentials)

                return await handle_invoke_success(req, response)

            except Exception as exception:
                return await handle_invoke_failure(exception)

        async def inspect_endpoint(req: Request):
            credentials = req.state.auth.get("credentials")

            try:
                request = await wf.inspect(
                    credentials=credentials,
                )

                return await handle_inspect_success(request)

            except Exception as exception:
                return await handle_inspect_failure(exception)

        invoke_responses: dict = {
            200: {
                "description": "Negotiated response — format determined by Accept header",
                "content": {
                    "application/json": {
                        "schema": WorkflowServiceBatchResponse.model_json_schema()
                    },
                    "application/x-ndjson": {
                        "schema": {"type": "string", "description": "NDJSON stream"}
                    },
                    "application/jsonl": {
                        "schema": {"type": "string", "description": "JSONL stream"}
                    },
                    "text/event-stream": {
                        "schema": {"type": "string", "description": "SSE stream"}
                    },
                },
            },
            406: {
                "description": "Accept header requests a format the runnable cannot produce",
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "detail": {"type": "string"},
                                "requested": {"type": "string"},
                                "supported": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                        }
                    }
                },
            },
        }

        # ------------------------------------------------------------------
        # Legacy path: router= was provided.
        # Registers prefixed routes on the APIRouter without isolation.
        # ------------------------------------------------------------------
        if self.router_fallback is not None:
            self.router_fallback.add_api_route(
                self.path + "/invoke",
                invoke_endpoint,
                methods=["POST"],
                responses=invoke_responses,
            )
            self.router_fallback.add_api_route(
                self.path + "/inspect",
                inspect_endpoint,
                methods=["GET"],
                response_model=WorkflowServiceRequest,
            )
            return foo

        # ------------------------------------------------------------------
        # Isolated path: create a sub-app per route and mount it.
        # Each sub-app gets its own middleware stack, /invoke, /inspect, and
        # an auto-generated /openapi.json enriched with workflow schemas.
        #
        # Special case: when path="/", FastAPI's built-in /openapi.json route
        # on mount_root would intercept before the Mount reaches the sub-app,
        # producing paths:{}.  Register routes directly on mount_root instead.
        # ------------------------------------------------------------------
        if self.path == "/":
            self.mount_root.add_api_route(
                "/invoke",
                invoke_endpoint,
                methods=["POST"],
                responses=invoke_responses,
            )
            self.mount_root.add_api_route(
                "/inspect",
                inspect_endpoint,
                methods=["GET"],
                response_model=WorkflowServiceRequest,
            )

            _attach_openapi_schema(self.mount_root, _workflow_name, _schemas)

            return foo

        sub_app = create_app()

        sub_app.add_api_route(
            "/invoke",
            invoke_endpoint,
            methods=["POST"],
            responses=invoke_responses,
        )
        sub_app.add_api_route(
            "/inspect",
            inspect_endpoint,
            methods=["GET"],
            response_model=WorkflowServiceRequest,
        )

        _attach_openapi_schema(sub_app, _workflow_name, _schemas)

        self.mount_root.mount(self.path, sub_app)

        # Ensure "/" catch-all is always last so it doesn't absorb named routes.
        _ensure_root_is_last(self.mount_root)

        return foo
