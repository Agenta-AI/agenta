"""Helpers shared by gateway proxies."""

from typing import Dict

# These response headers are owned by the ASGI server or no longer describe relayed bytes.
# `set-cookie` is here for a different reason: a relayed response is returned on Agenta's
# own origin, so an upstream that sets a cookie would be setting it on us, for every later
# request the browser makes to the API. An upstream's session state is the gateway's to
# hold, never the caller's.
_STRIPPED_RESPONSE_HEADERS = {
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "set-cookie",
}


def response_headers(headers: Dict[str, str]) -> Dict[str, str]:
    return {
        k: v for k, v in headers.items() if k.lower() not in _STRIPPED_RESPONSE_HEADERS
    }


# Typed gateway refusals carry this marker in their message for harness recovery.
CODE_MARKER_OPEN = "⟦agenta_code:"
CODE_MARKER_CLOSE = "⟧"


def with_code_marker(message: str, code: str) -> str:
    return f"{message} {CODE_MARKER_OPEN}{code}{CODE_MARKER_CLOSE}"
