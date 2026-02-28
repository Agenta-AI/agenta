"""Webhook utility functions."""

import ipaddress
import os
import socket
from urllib.parse import urlparse

_WEBHOOK_ALLOW_INSECURE = (
    os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE") or "true"
).lower() in {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


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


def validate_webhook_url(url: str) -> None:
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
        if _is_blocked_ip(ip):
            raise ValueError("Webhook URL resolves to a blocked IP range.")
        return
    except ValueError:
        pass

    try:
        addresses = {
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        }
    except socket.gaierror as exc:
        raise ValueError("Webhook URL hostname could not be resolved.") from exc

    if not addresses or any(_is_blocked_ip(ip) for ip in addresses):
        raise ValueError("Webhook URL resolves to a blocked IP range.")
