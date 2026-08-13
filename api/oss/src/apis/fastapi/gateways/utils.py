"""Helpers shared by both gateway proxies (entities.md §9)."""

from typing import Dict

# Framing/transport headers ASGI (Starlette/uvicorn) computes for our own response;
# forwarding the upstream's copies verbatim would conflict with what it writes, or, for
# content-encoding, describe bytes httpx already decoded on our behalf. Starlette keeps a
# content-length it is handed, so a relayed one also outlives any body we rewrite.
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
