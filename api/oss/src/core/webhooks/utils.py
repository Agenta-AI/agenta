"""Webhook utility functions."""

import ipaddress
import socket
from typing import Optional
from urllib.parse import urlparse

from oss.src.utils.env import env
from oss.src.utils.network import is_blocked_ip

_WEBHOOK_ALLOW_INSECURE = env.agenta.webhooks.allow_insecure


def _is_blocked_ip(
    ip: ipaddress._BaseAddress, *, allow_insecure: Optional[bool] = None
) -> bool:
    """The shared address predicate (`utils/network.py`) under the webhook insecure flag.

    `allow_insecure` lets a caller with its own policy (the gateway egress boundary,
    `core/gateways/egress.py`) apply these predicates under its own flag instead of the
    webhook one. Left unset, the webhook flag decides, which is what every existing caller
    and every existing test relies on.
    """
    if _WEBHOOK_ALLOW_INSECURE if allow_insecure is None else allow_insecure:
        return False
    return is_blocked_ip(ip)


def resolve_validated_ip(
    url: str, *, allow_insecure: Optional[bool] = None, label: str = "Webhook URL"
) -> str:
    """Validate `url` and resolve it to a single blocked-range-checked literal IP.

    Resolves once here; callers must connect to the returned literal IP (not
    re-resolve the hostname) so a DNS-rebind between validation and send cannot
    reach an internal host.

    `allow_insecure` overrides the webhook flag for a caller that owns its own policy; see
    :func:`_is_blocked_ip`. `label` names the thing being refused, so a caller that is not a
    webhook does not hand its user webhook wording.
    """
    insecure = _WEBHOOK_ALLOW_INSECURE if allow_insecure is None else allow_insecure

    if not url:
        raise ValueError(f"{label} is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError(f"{label} must use http or https.")
    if scheme == "http" and not insecure:
        raise ValueError(f"{label} must use https.")
    if not parsed.netloc:
        raise ValueError(f"{label} must include a host.")
    if parsed.username or parsed.password:
        raise ValueError(f"{label} must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError(f"{label} must include a valid hostname.")
    if hostname in {"localhost", "localhost.localdomain"} and not insecure:
        raise ValueError(f"{label} hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        if _is_blocked_ip(ip, allow_insecure=insecure):
            raise ValueError(f"{label} resolves to a blocked IP range.")
        return str(ip)

    try:
        addresses = [
            ipaddress.ip_address(info[4][0])
            for info in socket.getaddrinfo(hostname, None)
        ]
    except socket.gaierror as exc:
        raise ValueError(f"{label} hostname could not be resolved.") from exc

    if not addresses or any(
        _is_blocked_ip(addr, allow_insecure=insecure) for addr in addresses
    ):
        raise ValueError(f"{label} resolves to a blocked IP range.")

    return str(addresses[0])


def resolve_validated_webhook_ip(url: str) -> str:
    """:func:`resolve_validated_ip` under the webhook flag. Unchanged behaviour."""
    return resolve_validated_ip(url)


def validate_webhook_url(url: str) -> None:
    resolve_validated_webhook_ip(url)


def validate_url_format_and_literal_ip(
    url: str, *, allow_insecure: Optional[bool] = None, label: str = "URL"
) -> None:
    """Scheme/host/credentials checks plus a literal-IP block, no DNS resolution.

    For save-time validation of tenant-configured URLs (e.g. custom_provider.url) where a
    full resolve+block would risk rejecting a momentarily-unresolvable hostname; a hostname
    that isn't a literal IP is deferred to the resolve-time check at the point of use.

    `allow_insecure` overrides the webhook flag for a caller that owns its own policy, the
    same way :func:`resolve_validated_ip` takes it: the gateway egress boundary validates a
    save under the flag its relay will enforce at call time. Left unset, the webhook flag
    decides, which is what every existing caller relies on. `label` names the thing being
    refused; its default is the word every one of these messages already opened with, so a
    caller that passes nothing reads exactly as it did before.
    """
    insecure = _WEBHOOK_ALLOW_INSECURE if allow_insecure is None else allow_insecure

    if not url:
        raise ValueError(f"{label} is required.")

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError(f"{label} must use http or https.")
    if scheme == "http" and not insecure:
        raise ValueError(f"{label} must use https.")
    if not parsed.netloc:
        raise ValueError(f"{label} must include a host.")
    if parsed.username or parsed.password:
        raise ValueError(f"{label} must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError(f"{label} must include a valid hostname.")
    if hostname in {"localhost", "localhost.localdomain"} and not insecure:
        raise ValueError(f"{label} hostname is not allowed.")

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return

    if _is_blocked_ip(ip, allow_insecure=insecure):
        raise ValueError(f"{label} resolves to a blocked IP range.")
