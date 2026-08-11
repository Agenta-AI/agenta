"""Webhook utility functions."""

import ipaddress
import socket
from urllib.parse import urlparse

from oss.src.utils.env import env

_WEBHOOK_ALLOW_INSECURE = env.agenta.webhooks.allow_insecure


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    if _WEBHOOK_ALLOW_INSECURE:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def resolve_validated_webhook_ip(url: str) -> str:
    """Validate `url` and resolve it to a single blocked-range-checked literal IP.

    Resolves once here; callers must connect to the returned literal IP (not
    re-resolve the hostname) so a DNS-rebind between validation and send cannot
    reach an internal host.
    """
    if not url:
        raise ValueError("Webhook URL is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("Webhook URL must use http or https.")
    if scheme == "http" and not _WEBHOOK_ALLOW_INSECURE:
        raise ValueError("Webhook URL must use https.")
    if not parsed.netloc:
        raise ValueError("Webhook URL must include a host.")
    if parsed.username or parsed.password:
        raise ValueError("Webhook URL must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("Webhook URL must include a valid hostname.")
    if (
        hostname in {"localhost", "localhost.localdomain"}
        and not _WEBHOOK_ALLOW_INSECURE
    ):
        raise ValueError("Webhook URL hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip):
            raise ValueError("Webhook URL resolves to a blocked IP range.")
        return str(ip)

    try:
        addresses = [
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        ]
    except socket.gaierror as exc:
        raise ValueError("Webhook URL hostname could not be resolved.") from exc

    if not addresses or any(_is_blocked_ip(addr) for addr in addresses):
        raise ValueError("Webhook URL resolves to a blocked IP range.")

    return str(addresses[0])


def validate_webhook_url(url: str) -> None:
    resolve_validated_webhook_ip(url)


def validate_url_format_and_literal_ip(url: str) -> None:
    """Scheme/host/credentials checks plus a literal-IP block, no DNS resolution.

    For save-time validation of tenant-configured URLs (e.g. custom_provider.url) where a
    full resolve+block would risk rejecting a momentarily-unresolvable hostname; a hostname
    that isn't a literal IP is deferred to the resolve-time check at the point of use.
    """
    if not url:
        raise ValueError("URL is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("URL must use http or https.")
    if scheme == "http" and not _WEBHOOK_ALLOW_INSECURE:
        raise ValueError("URL must use https.")
    if not parsed.netloc:
        raise ValueError("URL must include a host.")
    if parsed.username or parsed.password:
        raise ValueError("URL must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("URL must include a valid hostname.")
    if (
        hostname in {"localhost", "localhost.localdomain"}
        and not _WEBHOOK_ALLOW_INSECURE
    ):
        raise ValueError("URL hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return

    if _is_blocked_ip(ip):
        raise ValueError("URL resolves to a blocked IP range.")
