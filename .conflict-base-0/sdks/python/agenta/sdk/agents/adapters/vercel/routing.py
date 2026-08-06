"""Vercel UI Message Stream protocol identity for agent responses.

The agent ``/messages`` route was removed; ``/invoke`` now serves the Vercel UI
Message Stream when asked (``Accept: text/event-stream`` + ``x-ag-messages-format:
vercel``). These headers stamp that protocol identity on the response.
"""

from __future__ import annotations

from fastapi.responses import Response

VERCEL_MESSAGE_PROTOCOL = "vercel"
VERCEL_MESSAGE_PROTOCOL_VERSION = "v1"
VERCEL_MESSAGE_PROTOCOL_HEADERS = {
    "x-ag-messages-format": VERCEL_MESSAGE_PROTOCOL,
    "x-ag-messages-version": VERCEL_MESSAGE_PROTOCOL_VERSION,
}


def set_vercel_message_protocol_headers(response: Response) -> Response:
    """Stamp the Vercel UI Message Stream protocol identity on an HTTP response."""
    for key, value in VERCEL_MESSAGE_PROTOCOL_HEADERS.items():
        response.headers.setdefault(key, value)
    return response
