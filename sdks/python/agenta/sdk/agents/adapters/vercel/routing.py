"""FastAPI route wiring for the agent ``/messages`` Vercel adapter."""

from __future__ import annotations

import re
from typing import Any, Callable, Collection, Optional
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from agenta.sdk.contexts.tracing import tracing_context_manager
from agenta.sdk.models.workflows import (
    LoadSessionRequest,
    LoadSessionResponse,
    WorkflowBatchResponse,
    WorkflowInvokeRequest,
    WorkflowRequestData,
    WorkflowStreamingResponse,
)

from ...interfaces import NoopSessionStore, SessionStore
from .messages import message_to_vercel_ui_message, vercel_ui_messages_to_messages

# An opaque, project-scoped session id (RFC §4.1): bounded length, restricted charset.
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

VERCEL_MESSAGE_PROTOCOL = "vercel"
VERCEL_MESSAGE_PROTOCOL_VERSION = "v1"
VERCEL_MESSAGE_PROTOCOL_HEADERS = {
    "x-ag-messages-format": VERCEL_MESSAGE_PROTOCOL,
    "x-ag-messages-version": VERCEL_MESSAGE_PROTOCOL_VERSION,
}


def set_vercel_message_protocol_headers(response: Response) -> Response:
    """Stamp the default agent ``/messages`` protocol identity on an HTTP response."""
    for key, value in VERCEL_MESSAGE_PROTOCOL_HEADERS.items():
        response.headers.setdefault(key, value)
    return response


def resolve_session_id(session_id: Optional[str]) -> Optional[str]:
    """Mint a new id when absent, echo a valid one, or return ``None`` when invalid."""
    if session_id is None:
        return "sess_" + uuid4().hex
    return session_id if _SESSION_ID_RE.match(session_id) else None


def inject_stream_session_id(
    response: WorkflowStreamingResponse,
    session_id: str,
) -> None:
    """Stamp ``messageMetadata.sessionId`` onto the first Vercel ``start`` part."""
    original = response.generator

    async def generator():
        stamped = False
        async for part in original():
            if not stamped and isinstance(part, dict) and part.get("type") == "start":
                part.setdefault("messageMetadata", {})["sessionId"] = session_id
                stamped = True
            yield part

    response.generator = generator


def make_messages_endpoint(
    *,
    wf: Any,
    get_request_tracing_context: Callable[[Request], Any],
    parse_accept: Callable[[Request], Optional[str]],
    stream_media_types: Collection[str],
    make_json_response: Callable[[WorkflowBatchResponse], Response],
    make_not_acceptable_response: Callable[[str, Any], Response],
    make_stream_response: Callable[[WorkflowStreamingResponse, str], Response],
    handle_failure: Callable[[Exception], Any],
):
    """Build the ``POST /messages`` endpoint for one routed agent workflow."""

    async def messages_endpoint(req: Request, request: WorkflowInvokeRequest):
        credentials = req.state.auth.get("credentials")

        session_id = resolve_session_id(request.session_id)
        if session_id is None:
            return set_vercel_message_protocol_headers(
                JSONResponse(
                    status_code=400,
                    content={
                        "detail": "session_id violates the allowed charset/length"
                    },
                )
            )

        try:
            request.session_id = session_id
            if request.data is None:
                request.data = WorkflowRequestData()

            request.data.messages = [
                message.to_wire()
                for message in vercel_ui_messages_to_messages(request.data.messages)
            ]

            requested = parse_accept(req)
            want_stream = requested in stream_media_types
            request.data.stream = want_stream

            with tracing_context_manager(get_request_tracing_context(req)):
                response = await wf.invoke(
                    request=request,
                    secrets=None,
                    credentials=credentials,
                )

            if isinstance(response, (WorkflowBatchResponse, WorkflowStreamingResponse)):
                response.session_id = session_id

            if (
                isinstance(response, WorkflowBatchResponse)
                and response.status
                and response.status.code is not None
                and response.status.code >= 400
            ):
                return set_vercel_message_protocol_headers(make_json_response(response))

            if want_stream:
                if not isinstance(response, WorkflowStreamingResponse):
                    return set_vercel_message_protocol_headers(
                        make_not_acceptable_response(str(requested), response)
                    )
                inject_stream_session_id(response, session_id)
                return set_vercel_message_protocol_headers(
                    make_stream_response(response, "vercel")
                )

            if not isinstance(response, WorkflowBatchResponse):
                return set_vercel_message_protocol_headers(
                    make_not_acceptable_response(
                        requested or "application/json", response
                    )
                )
            return set_vercel_message_protocol_headers(make_json_response(response))

        except Exception as exception:
            return set_vercel_message_protocol_headers(await handle_failure(exception))

    return messages_endpoint


def make_load_session_endpoint(
    *,
    session_store: Optional[SessionStore] = None,
):
    """Build the v1 ``POST /load-session`` endpoint over the session-store port."""
    store = session_store or NoopSessionStore()

    async def load_session_endpoint(req: Request, request: LoadSessionRequest):
        messages = await store.load(request.session_id)
        response = LoadSessionResponse(
            session_id=request.session_id,
            messages=[
                message_to_vercel_ui_message(message, message_id=f"msg-{idx}")
                for idx, message in enumerate(messages, start=1)
            ],
        )
        return set_vercel_message_protocol_headers(
            JSONResponse(content=response.model_dump(mode="json"))
        )

    return load_session_endpoint


def register_agent_message_routes(
    target: Any,
    prefix: str,
    *,
    wf: Any,
    invoke_responses: dict,
    get_request_tracing_context: Callable[[Request], Any],
    parse_accept: Callable[[Request], Optional[str]],
    stream_media_types: Collection[str],
    make_json_response: Callable[[WorkflowBatchResponse], Response],
    make_not_acceptable_response: Callable[[str, Any], Response],
    make_stream_response: Callable[[WorkflowStreamingResponse, str], Response],
    handle_failure: Callable[[Exception], Any],
    session_store: Optional[SessionStore] = None,
) -> None:
    """Register ``/messages`` and ``/load-session`` on a FastAPI app/router target."""
    target.add_api_route(
        prefix + "/messages",
        make_messages_endpoint(
            wf=wf,
            get_request_tracing_context=get_request_tracing_context,
            parse_accept=parse_accept,
            stream_media_types=stream_media_types,
            make_json_response=make_json_response,
            make_not_acceptable_response=make_not_acceptable_response,
            make_stream_response=make_stream_response,
            handle_failure=handle_failure,
        ),
        methods=["POST"],
        responses=invoke_responses,
    )
    target.add_api_route(
        prefix + "/load-session",
        make_load_session_endpoint(session_store=session_store),
        methods=["POST"],
    )
