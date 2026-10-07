"""Which link targets the preview fetcher may dial.

The address predicate is the API's one copy, `core/webhooks/utils.py::_is_blocked_ip`,
asked with the insecure flag forced off: link targets come from chat text, which anyone in the
conversation, including the agent, controls. Every resolved address must pass, and the caller
connects to the address returned here, so a name that re-resolves cannot move the request.
"""

import asyncio
import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from typing import Optional
from urllib.parse import urlparse

from oss.src.core.links.types import LinkPreviewRefused, LinkPreviewUnreachable
from oss.src.core.webhooks.utils import _is_blocked_ip

_DEFAULT_PORTS = {"http": 80, "https": 443}
_RESOLVE_TIMEOUT_SECONDS = 1.5
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


async def _resolve(hostname: str, port: int) -> list:
    """`getaddrinfo` on the link pool; a timed-out lookup still queued is cancelled, not kept."""
    loop = asyncio.get_running_loop()
    lookup = loop.run_in_executor(
        _resolver(),
        partial(socket.getaddrinfo, hostname, port, type=socket.SOCK_STREAM),
    )
    return await asyncio.wait_for(lookup, _RESOLVE_TIMEOUT_SECONDS)


@dataclass(frozen=True)
class LinkTarget:
    url: str
    hostname: str
    address: str


def is_blocked_address(ip: ipaddress._BaseAddress) -> bool:
    # Judged as the IPv4 address it carries, whatever this Python's predicates do with it.
    embedded = getattr(ip, "ipv4_mapped", None)
    return _is_blocked_ip(ip, allow_insecure=False) or (
        embedded is not None and _is_blocked_ip(embedded, allow_insecure=False)
    )


def check_link_url(url: str) -> tuple[str, int]:
    """Refuse anything but a credential-free http(s) URL on its default port.

    Returns the hostname and port to resolve.
    """
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise LinkPreviewRefused("Only http and https links can be previewed.")
    if parsed.username or parsed.password:
        raise LinkPreviewRefused("Links with credentials cannot be previewed.")
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise LinkPreviewRefused("The link has no host.")
    try:
        port = parsed.port or _DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise LinkPreviewRefused("The link has an invalid port.") from exc
    if port not in _DEFAULT_PORTS.values():
        raise LinkPreviewRefused("Only ports 80 and 443 can be previewed.")
    return hostname, port


async def resolve_link_target(url: str) -> LinkTarget:
    """Check `url`, resolve its host, and return one address that every answer cleared."""
    hostname, port = check_link_url(url)

    try:
        literal = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        literal = None

    if literal is not None:
        addresses = [literal]
    else:
        try:
            infos = await _resolve(hostname, port)
        except (OSError, TimeoutError) as exc:
            raise LinkPreviewUnreachable(
                "The link's host could not be resolved."
            ) from exc
        # A scoped IPv6 answer carries `%iface`, which `ip_address` refuses.
        addresses = [ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos]

    if not addresses:
        raise LinkPreviewUnreachable("The link's host could not be resolved.")
    if any(is_blocked_address(address) for address in addresses):
        raise LinkPreviewRefused("The link points to a non-public address.")

    return LinkTarget(url=url, hostname=hostname, address=str(addresses[0]))
