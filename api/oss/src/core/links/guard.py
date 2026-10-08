"""Which link targets the preview fetcher may dial; every resolved address must pass."""

import asyncio
import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urlparse

from oss.src.core.links.types import (
    LinkHost,
    LinkPreviewRefused,
    LinkPreviewUnreachable,
    LinkTarget,
)
from oss.src.utils.network import is_blocked_ip

_DEFAULT_PORTS = {"http": 80, "https": 443}
_RESOLVE_TIMEOUT_SECONDS = 1.5
# How long a lookup may wait for a free thread before the preview is refused as busy.
_RESOLVE_QUEUE_TIMEOUT_SECONDS = 0.5
# Own pool: a chat-controlled host whose DNS hangs must not hold the gateway's resolver threads.
_RESOLVER_THREADS = 2

_resolver_pool: Optional[ThreadPoolExecutor] = None


def _resolver() -> ThreadPoolExecutor:
    global _resolver_pool
    if _resolver_pool is None:
        _resolver_pool = ThreadPoolExecutor(
            max_workers=_RESOLVER_THREADS, thread_name_prefix="link-resolver"
        )
    return _resolver_pool


async def _resolve(*, hostname: str, port: int) -> list:
    """`getaddrinfo` on the link pool; a started lookup cannot be cancelled, so the queue wait is bounded."""
    loop = asyncio.get_running_loop()
    began: asyncio.Future = loop.create_future()

    def _run() -> list:
        loop.call_soon_threadsafe(lambda: began.done() or began.set_result(None))
        return socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)

    lookup = loop.run_in_executor(_resolver(), _run)
    try:
        await asyncio.wait_for(asyncio.shield(began), _RESOLVE_QUEUE_TIMEOUT_SECONDS)
    except TimeoutError:
        lookup.cancel()
        raise
    return await asyncio.wait_for(lookup, _RESOLVE_TIMEOUT_SECONDS)


def is_blocked_address(ip: ipaddress._BaseAddress) -> bool:
    # Judged as the IPv4 address it carries, whatever this Python's predicates do with it.
    embedded = getattr(ip, "ipv4_mapped", None)
    return is_blocked_ip(ip) or (embedded is not None and is_blocked_ip(embedded))


def check_link_url(*, url: str) -> LinkHost:
    """Refuse anything but a credential-free http(s) URL on its default port."""
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise LinkPreviewRefused(
            "Only http and https links can be previewed.", reason="unsupported_scheme"
        )
    if parsed.username or parsed.password:
        raise LinkPreviewRefused(
            "Links with credentials cannot be previewed.", reason="credentials"
        )
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise LinkPreviewRefused("The link has no host.", reason="missing_host")
    try:
        port = parsed.port or _DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise LinkPreviewRefused(
            "The link has an invalid port.", reason="invalid_port"
        ) from exc
    if port not in _DEFAULT_PORTS.values():
        raise LinkPreviewRefused(
            "Only ports 80 and 443 can be previewed.", reason="unsupported_port"
        )
    return LinkHost(hostname=hostname, port=port)


async def resolve_link_target(*, url: str) -> LinkTarget:
    """Check `url`, resolve its host, and return one address that every answer cleared."""
    host = check_link_url(url=url)
    hostname = host.hostname

    try:
        literal = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        literal = None

    if literal is not None:
        addresses = [literal]
    else:
        try:
            infos = await _resolve(hostname=hostname, port=host.port)
        except (OSError, TimeoutError) as exc:
            raise LinkPreviewUnreachable(
                "The link's host could not be resolved."
            ) from exc
        # A scoped IPv6 answer carries `%iface`, which `ip_address` refuses.
        addresses = [ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos]

    if not addresses:
        raise LinkPreviewUnreachable("The link's host could not be resolved.")
    if any(is_blocked_address(address) for address in addresses):
        raise LinkPreviewRefused(
            "The link points to a non-public address.", reason="non_public_address"
        )

    return LinkTarget(url=url, hostname=hostname, address=str(addresses[0]))
