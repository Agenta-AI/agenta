# /agenta/sdk/decorators/routing.py

import warnings
from typing import Any, Callable, Optional, AsyncGenerator, Union
from json import dumps
from uuid import UUID
from traceback import format_exception

from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response
from starlette.routing import Mount

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.models.workflows import (
    WorkflowInvokeRequest,
    WorkflowInspectRequest,
    WorkflowInspectResponse,
    WorkflowServiceStatus,
    WorkflowBatchResponse,
    WorkflowStreamingResponse,
    WorkflowBaseResponse,
    WorkflowServiceResponseData,
)
from agenta.sdk.agents.adapters.vercel.routing import (
    set_vercel_message_protocol_headers,
)
from agenta.sdk.agents.adapters.vercel.messages import (
    vercel_messages_to_agenta_messages,
    agenta_messages_to_vercel_messages,
)
from agenta.sdk.agents.adapters.vercel.stream import (
    agent_stream_to_vercel_stream,
)
from agenta.sdk.middlewares.routing.otel import baggage_value
from agenta.sdk.agents.adapters.vercel.sse import (
    VERCEL_UI_MESSAGE_STREAM_HEADERS as _VERCEL_UI_MESSAGE_STREAM_HEADERS,
    vercel_sse_stream as _vercel_sse_stream,
)
from agenta.sdk.middlewares.routing.cors import CORSMiddleware
from agenta.sdk.middlewares.routing.auth import AuthMiddleware
from agenta.sdk.middlewares.routing.otel import OTelMiddleware
from agenta.sdk.middlewares.running.vault import invalidate_secrets_cache
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.decorators.running import auto_workflow, inspect_workflow, Workflow
from agenta.sdk.engines.running.errors import ErrorStatus


# ---------------------------------------------------------------------------
# Reserved path segments — may not appear anywhere in a route path.
# These names are used by the per-route namespace triple itself.
# ---------------------------------------------------------------------------

_RESERVED_PATHS = {"invoke", "inspect", "messages"}


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
    kwargs.setdefault("openapi_url", None)
    kwargs.setdefault("docs_url", None)
    kwargs.setdefault("redoc_url", None)

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


def _wants_vercel_format(request: Request) -> bool:
    """Negotiation 2: the `x-ag-messages-format` header selects the message wire
    representation, separately from `Accept` (a Vercel UI message stream and a
    plain SSE stream share `text/event-stream`). Default/absent/agenta = canonical.
    """
    return request.headers.get("x-ag-messages-format", "").lower() == "vercel"


def _parse_history_header(request: Request) -> Optional[bool]:
    """Negotiation 3: the `x-ag-messages-history` header is HTTP sugar over the
    canonical `flags.history` command. ``full`` -> True (whole message list),
    ``last`` -> False (last message only). Absent/unrecognized -> None (unset, so
    the body flag or the running-layer default decides). Mirrors `Accept`->`stream`.
    """
    value = request.headers.get("x-ag-messages-history", "").strip().lower()
    if value == "full":
        return True
    if value == "last":
        return False
    return None


def _stream_wire_format(media_type: str) -> str:
    """Map a streaming Accept media type to its wire format name."""
    if media_type == "text/event-stream":
        return "sse"
    return "ndjson"  # application/x-ndjson, application/jsonl


def _get_request_tracing_context(req: Request) -> TracingContext:
    context = TracingContext.get().model_copy(deep=True)
    otel = getattr(req.state, "otel", None) or {}

    if otel.get("traceparent") is not None:
        context.traceparent = otel["traceparent"]

    if otel.get("baggage"):
        context.baggage = otel["baggage"]

    return context


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
    response: WorkflowBaseResponse,
) -> Response:
    res.headers.setdefault("x-ag-version", response.version or "unknown")

    if response.trace_id:
        res.headers.setdefault("x-ag-trace-id", response.trace_id)

    if response.span_id:
        res.headers.setdefault("x-ag-span-id", response.span_id)

    if response.session_id:
        res.headers.setdefault("x-ag-session-id", response.session_id)
        # session_id also rides W3C baggage as `ag.session.id` — mirroring the
        # `session.id` span attribute (namespace `session`), with the `ag.` prefix.
        _existing_bag = res.headers.get("baggage")
        _sid_bag = f"ag.session.id={response.session_id}"
        res.headers["baggage"] = (
            f"{_existing_bag},{_sid_bag}" if _existing_bag else _sid_bag
        )

    if response.trace_id and response.span_id:
        traceparent = f"00-{response.trace_id}-{response.span_id}-01"
        res.headers.setdefault("traceparent", traceparent)

    return res


def _make_json_response(
    response: WorkflowBatchResponse,
) -> JSONResponse:
    res = JSONResponse(
        status_code=((response.status.code or 200) if response.status else 200),
        content=response.model_dump(mode="json", exclude_none=True),
    )

    return _set_common_headers(res, response)  # type: ignore


def _make_vercel_json_response(
    response: WorkflowBatchResponse,
) -> JSONResponse:
    """Batch counterpart of the stream vercel projection (negotiation 2, batch direction).

    The handler's agenta batch output is the ``{"messages": [...]}`` envelope. When the caller
    asked for vercel (``x-ag-messages-format: vercel``), project that message list into Vercel
    ``UIMessage`` objects here in routing — the handler never emits vercel. A non-envelope batch
    output (chat/completion/evaluators) is passed through unprojected.
    """
    from agenta.sdk.agents.dtos import Message

    outputs = response.data.outputs if response.data else None
    if isinstance(outputs, dict) and isinstance(outputs.get("messages"), list):
        coerced = [Message.from_raw(m) for m in outputs["messages"]]
        ui_messages = agenta_messages_to_vercel_messages(
            [m for m in coerced if m is not None]
        )
        projected = response.model_copy(deep=True)
        projected.data = WorkflowServiceResponseData(
            outputs={**outputs, "messages": ui_messages}
        )
        res = _make_json_response(projected)
    else:
        res = _make_json_response(response)
    return set_vercel_message_protocol_headers(res)  # type: ignore


def _make_stream_response(
    response: WorkflowStreamingResponse,
    wire_format: str,
) -> StreamingResponse:
    aiter = response.iterator()

    if wire_format == "vercel":
        # The Vercel UI Message Stream: SSE framing terminated by `data: [DONE]`, plus the
        # headers the AI SDK client and proxies require. Selected by the
        # `x-ag-messages-format: vercel` header, not derived from Accept — a Vercel UI message
        # stream and a plain SSE stream share the `text/event-stream` media type, so the
        # choice cannot come from the Accept header alone.
        #
        # The handler yields AGENTA events; the agenta->vercel projection happens HERE, in the
        # routing layer (never in the handler). `trace_id` is sourced from the response (there is
        # no run to read it off), so the vercel `finish` frame still carries it.
        parts = agent_stream_to_vercel_stream(
            aiter,
            session_id=response.session_id,
            trace_id=response.trace_id,
        )
        res = StreamingResponse(
            _vercel_sse_stream(parts), media_type="text/event-stream"
        )
        for key, value in _VERCEL_UI_MESSAGE_STREAM_HEADERS.items():
            res.headers.setdefault(key, value)
    elif wire_format == "sse":
        res = StreamingResponse(_sse_stream(aiter), media_type="text/event-stream")
    elif wire_format == "ndjson":
        res = StreamingResponse(
            _ndjson_stream(aiter), media_type="application/x-ndjson"
        )
    else:
        res = StreamingResponse(
            _ndjson_stream(aiter), media_type="application/x-ndjson"
        )

    return _set_common_headers(res, response)  # type: ignore


def _make_not_acceptable_response(
    requested: str,
    response: WorkflowBaseResponse,
) -> JSONResponse:
    """Return 406 when the handler's output cannot satisfy the requested Accept type."""
    is_batch = isinstance(response, WorkflowBatchResponse)
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
    if not isinstance(response, (WorkflowBatchResponse, WorkflowStreamingResponse)):
        response = WorkflowBatchResponse(
            data=WorkflowServiceResponseData(outputs=response)
        )

    is_batch = isinstance(response, WorkflowBatchResponse)
    is_stream = isinstance(response, WorkflowStreamingResponse)

    requested = _parse_accept(req)

    # An errored handler always yields a batch error response, even when the caller
    # asked for a stream. Surface it as JSON (the real status) instead of 406ing on
    # the format mismatch — a 406 would mask the actual error from the client.
    if (
        is_batch
        and response.status
        and response.status.code is not None
        and response.status.code >= 400
    ):
        res = _make_json_response(response)
        if requested == "text/event-stream" and _wants_vercel_format(req):
            res = set_vercel_message_protocol_headers(res)
        return res

    # No preference — server picks the natural format for what the handler returned
    if requested is None:
        if is_batch:
            if _wants_vercel_format(req):
                return _make_vercel_json_response(response)
            return _make_json_response(response)
        return _make_stream_response(response, "ndjson")

    # Caller wants JSON — only satisfiable by a batch response
    if requested in BATCH_MEDIA_TYPES:
        if is_batch:
            if _wants_vercel_format(req):
                return _make_vercel_json_response(response)
            return _make_json_response(response)
        return _make_not_acceptable_response(requested, response)

    # Caller wants a stream format — only satisfiable by a stream response
    if requested in STREAM_MEDIA_TYPES:
        if is_stream:
            # Negotiation 2: `x-ag-messages-format: vercel` selects the Vercel UI
            # message stream projection (SSE-framed), independently of `Accept`.
            if requested == "text/event-stream" and _wants_vercel_format(req):
                res = _make_stream_response(response, "vercel")
                return set_vercel_message_protocol_headers(res)
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

    error = WorkflowBatchResponse(
        status=status,
        trace_id=trace_id,
        span_id=span_id,
    )

    return _make_json_response(error)


def _to_inspect_response(
    request: WorkflowInvokeRequest,
) -> WorkflowInspectResponse:
    """Normalize the internally-built ``WorkflowInvokeRequest`` into the canonical response.

    ``workflow.inspect()`` builds its result as a ``WorkflowInvokeRequest`` (a REQUEST model), so
    the resolved interface lands nested at ``data.revision.data``. The public ``/inspect``
    contract is :class:`WorkflowInspectResponse` instead, which lifts that
    :class:`WorkflowRevisionData` up to a flat top-level ``revision`` — so a client reads schemas
    at ``response.revision.schemas`` rather than guessing the request envelope.
    """
    nested = (request.data.revision or {}) if request.data else {}
    revision_data = nested.get("data") if isinstance(nested, dict) else None
    # Carry the resolved config so the public boundary doesn't drop it: the FE reads
    # ``configuration.parameters`` as a fallback when ``revision.parameters`` is absent.
    parameters = (
        revision_data.get("parameters") if isinstance(revision_data, dict) else None
    )
    configuration = {"parameters": parameters} if parameters is not None else None
    return WorkflowInspectResponse(
        version=request.version,
        revision=revision_data,
        configuration=configuration,
        meta=request.meta,
    )


async def handle_inspect_success(
    request: Optional[WorkflowInvokeRequest],
):
    if request:
        response = _to_inspect_response(request)
        return JSONResponse(response.model_dump(mode="json", exclude_none=True))

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
                "and will not produce isolated per-route invoke/inspect surfaces.",
                DeprecationWarning,
                stacklevel=2,
            )

        wf = auto_workflow(foo, flags=self.flags)

        # ------------------------------------------------------------------
        # Build the two endpoint closures (same logic as before).
        # ------------------------------------------------------------------

        async def invoke_endpoint(req: Request, request: WorkflowInvokeRequest):
            credentials = req.state.auth.get("credentials")

            # HTTP headers are sugar over the canonical per-call `flags`. An explicit
            # body flag always wins; the header only fills an unset flag.
            #   - `Accept` -> `flags.stream` (negotiation 1): a batch (json / no stream
            #     type) Accept means stream=False, so the normalizer aggregates a
            #     streaming handler into a batch instead of the route 406ing it.
            #   - `x-ag-messages-history` -> `flags.history` (negotiation 3): full vs last.
            _accept = _parse_accept(req)
            _flags = dict(request.flags or {})
            if "stream" not in _flags:
                _flags["stream"] = _accept in STREAM_MEDIA_TYPES
            if "history" not in _flags:
                _history = _parse_history_header(req)
                if _history is not None:
                    _flags["history"] = _history
            request.flags = _flags

            # session_id: accept the body field OR the `x-ag-session-id` header OR
            # baggage `ag.session.id` (there is no W3C standard like traceparent for
            # it). Normalize all to request.session_id; precedence:
            # body > x-ag header > baggage.
            if request.session_id is None:
                _otel = getattr(req.state, "otel", None) or {}
                _bag = _otel.get("baggage") or {}
                _bag_sid = _bag.get("ag.session.id") or baggage_value(
                    req.headers.get("baggage"), "ag.session.id"
                )
                request.session_id = req.headers.get("x-ag-session-id") or _bag_sid

            # Negotiation 2 (input): when the caller speaks vercel, convert the
            # inbound UIMessage[] in data.inputs.messages to canonical agenta
            # messages before the handler runs. In code, messages are always agenta.
            if _wants_vercel_format(req) and request.data and request.data.inputs:
                _msgs = request.data.inputs.get("messages")
                if _msgs:
                    request.data.inputs = {
                        **request.data.inputs,
                        "messages": [
                            m.to_wire()
                            for m in vercel_messages_to_agenta_messages(_msgs)
                        ],
                    }

            try:
                with tracing_context_manager(_get_request_tracing_context(req)):
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

        async def inspect_endpoint(req: Request, request: WorkflowInspectRequest):
            credentials = req.state.auth.get("credentials")

            try:
                with tracing_context_manager(_get_request_tracing_context(req)):
                    if any(
                        (
                            request.revision,
                            request.references,
                            request.selector,
                            request.flags,
                            request.tags,
                            request.meta,
                        )
                    ):
                        result = await inspect_workflow(
                            request=request,
                            credentials=credentials,
                        )
                    else:
                        result = await wf.inspect(
                            credentials=credentials,
                        )

                return await handle_inspect_success(result)

            except Exception as exception:
                return await handle_inspect_failure(exception)

        invoke_responses: dict = {
            200: {
                "description": "Negotiated response — format determined by Accept header",
                "content": {
                    "application/json": {
                        "schema": WorkflowBatchResponse.model_json_schema()
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
                methods=["POST"],
                response_model=WorkflowInspectResponse,
            )
            return foo

        # ------------------------------------------------------------------
        # Isolated path: create a sub-app per route and mount it.
        # Each sub-app gets its own middleware stack, /invoke, and /inspect.
        #
        # Special case: when path="/", register routes directly on mount_root
        # instead of a mounted sub-app.
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
                methods=["POST"],
                response_model=WorkflowInspectResponse,
            )

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
            methods=["POST"],
            response_model=WorkflowInspectResponse,
        )

        self.mount_root.mount(self.path, sub_app)

        # Ensure "/" catch-all is always last so it doesn't absorb named routes.
        _ensure_root_is_last(self.mount_root)

        return foo
