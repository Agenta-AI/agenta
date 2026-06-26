"""Vercel AI SDK adapters for the agent runtime.

The neutral agent runtime speaks ``Message``, ``AgentEvent``, and ``AgentRun``. This package
is the browser protocol adapter: Vercel ``UIMessage`` request bodies, UI Message Stream parts,
SSE framing, and the ``/messages`` route helpers.
"""

from .messages import (
    agenta_messages_to_vercel_messages,
    from_ui_messages,
    message_to_vercel_ui_message,
    to_ui_message,
    vercel_messages_to_agenta_messages,
    vercel_ui_messages_to_messages,
)
from .routing import (
    VERCEL_MESSAGE_PROTOCOL,
    VERCEL_MESSAGE_PROTOCOL_HEADERS,
    VERCEL_MESSAGE_PROTOCOL_VERSION,
    inject_stream_session_id,
    register_agent_message_routes,
    resolve_session_id,
    set_vercel_message_protocol_headers,
)
from .sse import VERCEL_UI_MESSAGE_STREAM_HEADERS, vercel_sse_stream
from .stream import agent_run_to_vercel_parts, ui_message_stream

__all__ = [
    "vercel_messages_to_agenta_messages",
    "agenta_messages_to_vercel_messages",
    "vercel_ui_messages_to_messages",
    "message_to_vercel_ui_message",
    "agent_run_to_vercel_parts",
    "VERCEL_UI_MESSAGE_STREAM_HEADERS",
    "vercel_sse_stream",
    "resolve_session_id",
    "inject_stream_session_id",
    "VERCEL_MESSAGE_PROTOCOL",
    "VERCEL_MESSAGE_PROTOCOL_VERSION",
    "VERCEL_MESSAGE_PROTOCOL_HEADERS",
    "set_vercel_message_protocol_headers",
    "register_agent_message_routes",
    # Former flat-module names.
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
]
