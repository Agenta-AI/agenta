"""Vercel AI SDK adapters for the agent runtime.

The neutral agent runtime speaks ``Message``, ``Event``, and ``AgentStream``. This package
is the browser protocol adapter: Vercel ``UIMessage`` request bodies, UI Message Stream parts,
SSE framing, and the Vercel protocol headers ``/invoke`` stamps on a vercel-format response.
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
    "VERCEL_MESSAGE_PROTOCOL",
    "VERCEL_MESSAGE_PROTOCOL_VERSION",
    "VERCEL_MESSAGE_PROTOCOL_HEADERS",
    "set_vercel_message_protocol_headers",
    # Former flat-module names.
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
]
