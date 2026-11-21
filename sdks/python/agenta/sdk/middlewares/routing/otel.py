from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.engines.tracing.propagation import extract


log = get_module_logger(__name__)


def baggage_value(raw: Optional[str], key: str) -> Optional[str]:
    """Pull one key's value out of a raw W3C `baggage` header string."""
    if not raw:
        return None
    for pair in raw.split(","):
        k, _, v = pair.strip().partition("=")
        if k.strip() == key:
            return v.strip() or None
    return None


def header_session_id(request: Request) -> Optional[str]:
    """The session a turn names outside its body: the `x-ag-session-id` header, else
    the `ag.session.id` baggage. The invoke prelude and the credential exchange both
    read it here, so the credential names the session the turn runs in."""
    otel = getattr(request.state, "otel", None) or {}
    return (
        request.headers.get("x-ag-session-id")
        or (otel.get("baggage") or {}).get("ag.session.id")
        or baggage_value(request.headers.get("baggage"), "ag.session.id")
    )


class OTelMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        request.state.otel = {"baggage": {}, "traceparent": None}

        headers: dict = dict(request.headers)

        with suppress():
            _, traceparent, baggage = extract(headers)

            # x-ag-trace-id + x-ag-span-id are an optional alternative to the W3C
            # `traceparent` header: synthesize the parent context from them when no
            # traceparent arrived (symmetry with the x-ag-* response headers).
            if traceparent is None:
                tid = headers.get("x-ag-trace-id")
                sid = headers.get("x-ag-span-id")
                if tid and sid:
                    _, traceparent, _ = extract({"traceparent": f"00-{tid}-{sid}-01"})

            request.state.otel = {"baggage": baggage, "traceparent": traceparent}

        return await call_next(request)
