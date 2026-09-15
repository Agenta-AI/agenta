"""Choose between OAuth client-identity documents and dynamic registration."""

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
    """Return whether an HTTPS API URL resolves exclusively to public addresses."""
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
