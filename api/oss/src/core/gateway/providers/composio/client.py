from typing import Dict, Optional

import httpx
from httpx._utils import get_environment_proxies

COMPOSIO_CONNECT_TIMEOUT_SECONDS = 5.0
# httpx retries only a failed connect (DNS lookup, refused, connect timeout). Nothing
# was sent, so a retry cannot repeat a write. Without it, one resolver blip fails the
# whole user flow with "No address associated with hostname".
COMPOSIO_CONNECT_RETRIES = 2


def composio_timeout(seconds: float = 30.0) -> httpx.Timeout:
    """A per-request timeout that keeps the short connect bound.

    A scalar ``timeout=`` on a request replaces the client's whole timeout, connect
    included, and with retries a long connect bound multiplies the wait on an outage.
    """
    return httpx.Timeout(seconds, connect=COMPOSIO_CONNECT_TIMEOUT_SECONDS)


def _retrying_transport(proxy: Optional[str] = None) -> httpx.AsyncHTTPTransport:
    return httpx.AsyncHTTPTransport(retries=COMPOSIO_CONNECT_RETRIES, proxy=proxy)


def _environment_proxy_mounts() -> Dict[str, Optional[httpx.AsyncBaseTransport]]:
    # Passing ``transport=`` turns off httpx's own HTTP(S)_PROXY / NO_PROXY handling,
    # so rebuild the same mounts here. A None mount falls back to the default transport.
    return {
        pattern: _retrying_transport(proxy) if proxy else None
        for pattern, proxy in get_environment_proxies().items()
    }


def composio_http_client() -> httpx.AsyncClient:
    """The pooled client every Composio adapter holds for its lifetime."""
    return httpx.AsyncClient(
        timeout=composio_timeout(),
        transport=_retrying_transport(),
        mounts=_environment_proxy_mounts(),
    )
