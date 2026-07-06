"""Shared SSRF guard for outbound URLs configured by tenants (custom-provider endpoints, etc).

Mirrors api/oss/src/core/webhooks/utils.py and engines/running/handlers.py's
_validate_webhook_url; unify these three if a clean shared package ever spans API + SDK.
"""

import ipaddress
import os
import socket
from urllib.parse import urlparse

# AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE / AGENTA_WEBHOOKS_ALLOW_INSECURE / AGENTA_WEBHOOK_ALLOW_INSECURE are deprecated aliases; prefer AGENTA_INSECURE_EGRESS_ALLOWED.
_ALLOW_INSECURE = (
    os.getenv("AGENTA_INSECURE_EGRESS_ALLOWED")
    or os.getenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE")
    or os.getenv("AGENTA_WEBHOOKS_ALLOW_INSECURE")
    or os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE")
    or "false"
).lower() in {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    if _ALLOW_INSECURE:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_endpoint_url(url: str) -> str:
    """Validate `url` and resolve it to a blocked-range-checked literal IP.

    Used for tenant-configured endpoints (e.g. custom_provider.url) that this process itself
    connects to; raises ValueError on anything private/loopback/reserved by default.
    """
    if not url:
        raise ValueError("URL is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("URL must use http or https.")
    if scheme == "http" and not _ALLOW_INSECURE:
        raise ValueError("URL must use https.")
    if not parsed.netloc:
        raise ValueError("URL must include a host.")
    if parsed.username or parsed.password:
        raise ValueError("URL must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("URL must include a valid hostname.")
    if hostname in {"localhost", "localhost.localdomain"} and not _ALLOW_INSECURE:
        raise ValueError("URL hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip):
            raise ValueError("URL resolves to a blocked IP range.")
        return str(ip)

    try:
        addresses = [
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        ]
    except socket.gaierror as exc:
        raise ValueError("URL hostname could not be resolved.") from exc

    if not addresses or any(_is_blocked_ip(addr) for addr in addresses):
        raise ValueError("URL resolves to a blocked IP range.")

    return str(addresses[0])
