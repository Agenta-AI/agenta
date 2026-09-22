"""Choose between OAuth client-identity documents and dynamic registration."""

import ipaddress
import socket
from functools import partial
from typing import Callable, List
from urllib.parse import urlparse

from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata

from oss.src.core.gateways.egress import resolve_offloaded

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_METADATA_PATH = "/gateways/mcps/oauth/client-metadata.json"

# Long enough for a resolver that is merely slow, short enough that one that is gone does
# not hold a consent step open.
_RESOLVE_TIMEOUT_SECONDS = 5.0

Resolver = Callable[[str], List[str]]


def _default_resolve(hostname: str) -> List[str]:
    return [info[4][0] for info in socket.getaddrinfo(hostname, None)]


def client_metadata_url(*, api_url: str) -> str:
    """Return the client identity document URL."""
    return f"{api_url.rstrip('/')}{_METADATA_PATH}"


def client_metadata_document(*, api_url: str, redirect_uri: str) -> OAuthClientMetadata:
    """Build the deployment-wide OAuth client identity document."""
    return OAuthClientMetadata(
        redirect_uris=[redirect_uri],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
        client_name="Agenta",
    )


def identity_document_client_info(
    *, api_url: str, redirect_uri: str
) -> OAuthClientInformationFull:
    """Build deterministic client information for the identity-document strategy."""
    document = client_metadata_document(api_url=api_url, redirect_uri=redirect_uri)
    return OAuthClientInformationFull(
        client_id=client_metadata_url(api_url=api_url),
        **document.model_dump(),
    )


def provided_client_info(
    *,
    client_id: str,
    client_secret: str | None,
    redirect_uri: str,
    scopes: list[str],
    issuer: str,
    token_endpoint_auth_methods_supported: list[str],
) -> OAuthClientInformationFull:
    """Build client information for an OAuth application registered by the user."""
    token_endpoint_auth_method = "none"
    if client_secret:
        token_endpoint_auth_method = (
            "client_secret_basic"
            if "client_secret_basic" in token_endpoint_auth_methods_supported
            and "client_secret_post" not in token_endpoint_auth_methods_supported
            else "client_secret_post"
        )

    return OAuthClientInformationFull(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uris=[redirect_uri],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        scope=" ".join(scopes) if scopes else None,
        token_endpoint_auth_method=token_endpoint_auth_method,
        issuer=issuer,
        client_name="Agenta",
    )


def registration_covers(
    client_info: OAuthClientInformationFull, *, redirect_uri: str
) -> bool:
    """Whether a stored registration still names the callback we would send.

    A registration under RFC 7591 is bound to the redirect URIs it was created with, so
    one that does not list the current callback is not a registration this deployment
    can use: the authorization server refuses the `client_id` outright, and its refusal
    says nothing about redirect URIs (OR78).

    Compared as exact strings after dropping a trailing slash, which is the one
    difference an OAuth client library can introduce without changing where the browser
    lands. Nothing else is normalized on purpose: the redirect URI is matched exactly by
    the authorization server, so a comparison looser than the server's would reuse a
    registration the server will refuse, which is the defect this exists to prevent.
    """
    wanted = redirect_uri.rstrip("/")
    return any(
        str(stored).rstrip("/") == wanted for stored in client_info.redirect_uris
    )


# RFC 6598 shared address space, the one range this guard blocks that Python does not.
#
# `ipaddress` answers False to every predicate below for an address in this range and does
# not carry it in its private-networks table, so a target resolving into it read as public
# and was dialled with the caller's credential attached. The range is in everyday use for
# cloud pod and service networks and for some mesh VPNs, and a gateway endpoint URL is
# supplied by the tenant, so reaching one of those is the feature rather than an
# administrator's misconfiguration (P10).
#
# The same range is added to every other copy of this predicate and to the generated table
# the runner loads. They are held together by the vector fixture in
# `sdks/python/oss/tests/pytest/unit/golden/ssrf_guard_vectors.json`, which every one of
# them is asserted against, so a copy that misses it fails rather than diverges quietly.
_SHARED_ADDRESS_SPACE = ipaddress.ip_network("100.64.0.0/10")


def _in_shared_address_space(ip: ipaddress._BaseAddress) -> bool:
    """Whether an address is RFC 6598 space, IPv4-mapped IPv6 included.

    Unwrapped the way `ipaddress` unwraps for its own predicates, so `::ffff:100.64.0.1` is
    judged as the IPv4 address it carries.
    """
    embedded = getattr(ip, "ipv4_mapped", None)
    candidate = embedded if embedded is not None else ip
    return candidate.version == 4 and candidate in _SHARED_ADDRESS_SPACE


def _is_public_ip(ip: ipaddress._BaseAddress) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or _in_shared_address_space(ip)
    )


async def is_publicly_resolvable_async(
    api_url: str,
    *,
    resolve: Resolver = _default_resolve,
    timeout: float = _RESOLVE_TIMEOUT_SECONDS,
) -> bool:
    """The same answer, without holding the event loop while the resolver thinks.

    `socket.getaddrinfo` is a blocking call with no timeout of its own, and both callers
    are coroutines, so a slow or unreachable resolver stalled every request the worker
    was serving rather than the one that asked (M18). The lookup goes to the gateway's
    own resolver pool, and the wait is bounded.

    Bounding the wait releases the coroutine, not the thread: the resolution keeps
    running until the operating system gives up on it. That is why the pool is the
    gateway's own rather than the loop's shared default one, where those threads would
    have been taken from everything else in the process.

    A timeout answers `False`, which is what an unresolvable address already answers.
    Both callers read `False` as "this deployment cannot name itself to an authorization
    server", and fall back to dynamic registration or report the connection as
    unusable — the same conservative reading a genuine resolution failure gets.
    """
    try:
        return await resolve_offloaded(
            partial(is_publicly_resolvable, api_url, resolve=resolve),
            timeout=timeout,
        )
    except TimeoutError:
        log.warning(
            "[gateways] resolving this deployment's own address timed out",
            timeout=timeout,
        )
        return False


def is_publicly_resolvable(
    api_url: str, *, resolve: Resolver = _default_resolve
) -> bool:
    """Whether an HTTPS API URL resolves exclusively to public addresses.

    Synchronous, and the judgement the async wrapper above delegates to. Call that one
    from a coroutine; this one is the logic, and what the cases that inject a resolver
    exercise directly.
    """
    parsed = urlparse(api_url)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    try:
        addresses = resolve(parsed.hostname)
    except Exception:
        return False
    if not addresses:
        return False
    try:
        parsed_ips = [ipaddress.ip_address(a) for a in addresses]
    except ValueError:
        return False
    return all(_is_public_ip(ip) for ip in parsed_ips)
