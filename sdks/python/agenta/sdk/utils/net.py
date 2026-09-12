"""Shared SSRF guard for outbound URLs configured by tenants (custom-provider endpoints, etc).

Mirrors api/oss/src/core/webhooks/utils.py's range logic; the SDK ships to users so it
cannot import the API package, hence this separate copy. engines/running/handlers.py
delegates its webhook guard here rather than duplicating the checks.
"""

import ipaddress
import os
import socket
from typing import Optional, Tuple
from urllib.parse import urlparse, urlunparse

from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

# AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE / AGENTA_WEBHOOKS_ALLOW_INSECURE / AGENTA_WEBHOOK_ALLOW_INSECURE are deprecated aliases; prefer AGENTA_INSECURE_EGRESS_ALLOWED.
_ALLOW_INSECURE = (
    os.getenv("AGENTA_INSECURE_EGRESS_ALLOWED")
    or os.getenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE")
    or os.getenv("AGENTA_WEBHOOKS_ALLOW_INSECURE")
    or os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE")
    or "false"
).lower() in TRUTHY

if not _ALLOW_INSECURE:
    log.info(
        "Outbound egress is in restricted mode: http and private/loopback/link-local/"
        "cloud-metadata targets are blocked. Set AGENTA_INSECURE_EGRESS_ALLOWED=true to "
        "permit them (trusted/single-tenant deployments only)."
    )


def _is_blocked_ip(
    ip: ipaddress._BaseAddress, *, allow_insecure: Optional[bool] = None
) -> bool:
    if _ALLOW_INSECURE if allow_insecure is None else allow_insecure:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_endpoint_url_allowed(url: str) -> None:
    """Validate `url` as a config-time gate, discarding the resolved IP.

    For endpoints this process does NOT connect to directly — it hands the URL to an external
    connector (e.g. litellm's `api_base`) that re-resolves the hostname itself. Pinning an IP
    here would be useless (the connector needs the hostname for TLS/SNI and routing), so the
    resolved IP is intentionally dropped; the value is the private/loopback/reserved block at
    config time. Raises ValueError on a blocked target. In-process connect paths must instead
    call `validate_endpoint_url` and connect to the IP it returns.
    """
    validate_endpoint_url(url)


def validate_endpoint_url(url: str, *, allow_insecure: Optional[bool] = None) -> str:
    """Validate `url` and resolve it to a blocked-range-checked literal IP.

    For tenant-configured endpoints this process connects to directly: the caller MUST connect
    to the returned literal IP (not re-resolve the hostname) so a DNS rebind between validation
    and send cannot reach an internal host. Raises ValueError on anything private/loopback/
    reserved by default. For a validate-only config gate (no in-process connect), use
    `assert_endpoint_url_allowed` instead.

    `allow_insecure` defaults to this module's own env-resolved flag; pass it explicitly to
    reuse this guard under a caller's own policy (e.g. a different env-var precedence).
    """
    insecure = _ALLOW_INSECURE if allow_insecure is None else allow_insecure

    if not url:
        raise ValueError("URL is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("URL must use http or https.")
    if scheme == "http" and not insecure:
        raise ValueError("URL must use https.")
    if not parsed.netloc:
        raise ValueError("URL must include a host.")
    if parsed.username or parsed.password:
        raise ValueError("URL must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("URL must include a valid hostname.")
    if hostname in {"localhost", "localhost.localdomain"} and not insecure:
        raise ValueError("URL hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip, allow_insecure=insecure):
            raise ValueError("URL resolves to a blocked IP range.")
        return str(ip)

    try:
        addresses = [
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        ]
    except socket.gaierror as exc:
        raise ValueError("URL hostname could not be resolved.") from exc

    if not addresses or any(
        _is_blocked_ip(addr, allow_insecure=insecure) for addr in addresses
    ):
        raise ValueError("URL resolves to a blocked IP range.")

    return str(addresses[0])


def pin_url_to_ip(url: str, resolved_ip: str) -> Tuple[str, str]:
    """Swap the URL's host for the literal validated IP; keep hostname for Host/SNI."""
    parsed = urlparse(url)
    host_literal = f"[{resolved_ip}]" if ":" in resolved_ip else resolved_ip
    pinned_netloc = f"{host_literal}:{parsed.port}" if parsed.port else host_literal
    return urlunparse(parsed._replace(netloc=pinned_netloc)), parsed.hostname or ""
