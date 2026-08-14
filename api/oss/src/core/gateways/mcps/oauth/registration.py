"""Client registration strategy (specs-wp20.md).

Two mechanisms can produce the `OAuthClientInformationFull` `begin()`/`complete()` need:
the storage-backed outbound RFC 7591 path (WP17, unchanged, always safe) and the client
identity document below — a public client whose `client_id` is an HTTPS URL the
authorization server fetches (D26). Choosing between them never observes anything from
the authorization server; it runs entirely on facts about our own deployment, before the
browser is ever redirected — see specs-wp20.md "Why the choice cannot be attempt-and-
fall-back" for why that observation is structurally unavailable.
"""

import ipaddress
import socket
from typing import Callable, List
from urllib.parse import urlparse

from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata

_METADATA_PATH = "/gateways/mcps/oauth/client-metadata.json"

Resolver = Callable[[str], List[str]]


def _default_resolve(hostname: str) -> List[str]:
    return [info[4][0] for info in socket.getaddrinfo(hostname, None)]


def client_metadata_url(*, api_url: str) -> str:
    """The client_id: the identity document's own URL, fetched by the authorization
    server (never by us)."""
    return f"{api_url.rstrip('/')}{_METADATA_PATH}"


def client_metadata_document(*, api_url: str, redirect_uri: str) -> OAuthClientMetadata:
    """The static, deployment-wide JSON body served at `client_metadata_url()`. One
    document for every project on this deployment — the client identity is the Agenta
    application, not a tenant; per-project scoping stays on the `oauth_grant` secret,
    unaffected by which client mechanism produced it."""
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
    """The internal client-info shape for the document strategy — deterministic, so
    `complete()` can rebuild it without having stored anything (nothing was ever
    registered; there is nothing to persist)."""
    document = client_metadata_document(api_url=api_url, redirect_uri=redirect_uri)
    return OAuthClientInformationFull(
        client_id=client_metadata_url(api_url=api_url),
        **document.model_dump(),
    )


def _is_public_ip(ip: ipaddress._BaseAddress) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def is_publicly_resolvable(
    api_url: str, *, resolve: Resolver = _default_resolve
) -> bool:
    """The detector (specs-wp20.md "The detector"). Conservative by construction:
    every resolved address must classify public, and any ambiguity — no https scheme,
    no hostname, a lookup error, an empty answer, one private address among several —
    answers False. False only ever steers to the always-safe outbound path (WP17); a
    wrong False costs one unnecessary RFC 7591 registration. A wrong True is the
    direction that fails silently on the authorization server's side (specs-wp20.md
    "Wrong in each direction"), so nothing here is allowed to guess in that direction.
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
