"""Helpers shared by gateway proxies."""

from typing import Dict

# These response headers are owned by the ASGI server or no longer describe relayed bytes.
_STRIPPED_RESPONSE_HEADERS = {
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
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
