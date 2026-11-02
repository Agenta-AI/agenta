"""Egress guard for caller-supplied provider endpoints (OpenAI-compatible, Azure).

Reuses the repo's shared SSRF policy in `oss.src.core.webhooks.utils`, driven by the
shared `env` object (`env.agenta.webhooks.allow_insecure`, set by
AGENTA_INSECURE_EGRESS_ALLOWED). The request is pinned to the IP validated here rather
than to the hostname, so a DNS rebind between the check and the send cannot reach an
internal host.
"""

from typing import Any, Dict, NamedTuple
from urllib.parse import urlparse, urlunparse

from oss.src.core.providers.exceptions import (
    ProviderEndpointNotAllowed,
    ProviderEndpointRequired,
)
from oss.src.core.webhooks.utils import (
    resolve_validated_webhook_ip,
    validate_url_format_and_literal_ip,
)


class GuardedEndpoint(NamedTuple):
    url: str
    headers: Dict[str, str]
    extensions: Dict[str, Any]


def endpoint_host(url: str) -> str:
    """The host the user typed. The only part of a caller URL a message may repeat."""

    return (urlparse(url or "").hostname or "").lower() or "the endpoint"


def guard_endpoint(base_url: str, *, path: str = "") -> GuardedEndpoint:
    """Validate `base_url`, then return a request target pinned to its resolved IP."""

    if not (base_url or "").strip():
        raise ProviderEndpointRequired("This provider needs a base URL to test.")

    url = base_url.strip().rstrip("/")
    if path:
        url = f"{url}/{path.lstrip('/')}"

    try:
        validate_url_format_and_literal_ip(url)
    except ValueError as exc:
        raise ProviderEndpointNotAllowed(str(exc)) from exc

    try:
        resolved_ip = resolve_validated_webhook_ip(url)
    except ValueError as exc:
        raise ProviderEndpointNotAllowed(
            f"{endpoint_host(url)} could not be resolved, or resolves to a blocked address range."
        ) from exc

    parsed = urlparse(url)
    host_literal = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
    pinned_netloc = f"{host_literal}:{parsed.port}" if parsed.port else host_literal

    hostname = parsed.hostname or ""
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port:
        host_header = f"{host_header}:{parsed.port}"

    return GuardedEndpoint(
        url=urlunparse(parsed._replace(netloc=pinned_netloc)),
        headers={"Host": host_header},
        extensions={"sni_hostname": parsed.hostname},
    )
