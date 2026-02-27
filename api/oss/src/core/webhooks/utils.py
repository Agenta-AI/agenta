"""Webhook utility functions."""

import ipaddress
import os
import random
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from oss.src.core.webhooks.config import (
    WEBHOOK_RETRY_BASE_DELAY,
    WEBHOOK_RETRY_MULTIPLIER,
    WEBHOOK_RETRY_MAX_DELAY,
    WEBHOOK_RETRY_JITTER_FACTOR,
)

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


def calculate_next_retry_at(attempt: int) -> datetime:
    """
    Calculate next retry time with exponential backoff and jitter.

    Formula: delay = min(base * (multiplier^attempt), max_delay) ± jitter
    Schedule: ~1s, ~5s, ~25s, ~125s, ~625s (with ±20% jitter)

    Args:
        attempt: Current attempt number (0-indexed)

    Returns:
        Datetime for next retry

    Examples:
        >>> # attempt=0: ~1s, attempt=1: ~5s, attempt=2: ~25s
        >>> next_retry = calculate_next_retry_at(0)
        >>> # Returns time ~1 second from now (with jitter)
    """
    # Calculate base delay with exponential backoff
    base_delay = WEBHOOK_RETRY_BASE_DELAY * (WEBHOOK_RETRY_MULTIPLIER**attempt)

    # Cap at maximum delay
    capped_delay = min(base_delay, WEBHOOK_RETRY_MAX_DELAY)

    # Add jitter: ±20% randomness to prevent thundering herd
    jitter = capped_delay * WEBHOOK_RETRY_JITTER_FACTOR * (random.random() * 2 - 1)
    final_delay = max(0, capped_delay + jitter)

    return datetime.now(timezone.utc) + timedelta(seconds=final_delay)
