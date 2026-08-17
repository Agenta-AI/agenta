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


# A single unambiguous machine-readable marker, embedded in every TYPED refusal's `message`
# on both planes (WP25, OD18) so `code`/`cause` survives even when a harness's SDK discards
# everything else the body carries — codex-rs's `extract_error_message` keeps only
# `error.message` before reformatting, so a marker inside that one surviving field is the only
# channel left. U+27E6/U+27E7 (MATHEMATICAL LEFT/RIGHT WHITE SQUARE BRACKET) never occur in
# ordinary error prose, a model's own output, JSON delimiters (`{}`/`[]`), or markdown, so
# nothing else can produce or be mistaken for this marker, and it cannot collide with
# `gateway-error.ts`'s separate `{...}` body scan. Never applied to `upstream_error` on either
# plane: D16 forwards the upstream's own detail untouched, and neither proxy may inject text
# into a body it promised not to touch.
CODE_MARKER_OPEN = "⟦agenta_code:"
CODE_MARKER_CLOSE = "⟧"


def with_code_marker(message: str, code: str) -> str:
    return f"{message} {CODE_MARKER_OPEN}{code}{CODE_MARKER_CLOSE}"
