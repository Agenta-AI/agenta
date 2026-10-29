"""Webhook utility functions."""

import ipaddress
import socket
from typing import Optional
from urllib.parse import urlparse

from oss.src.utils.env import env

_WEBHOOK_ALLOW_INSECURE = env.agenta.webhooks.allow_insecure


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


def _is_blocked_ip(
    ip: ipaddress._BaseAddress, *, allow_insecure: Optional[bool] = None
) -> bool:
    """The six address predicates. The only copy of them in `api/`.

    `allow_insecure` lets a caller with its own policy (the gateway egress boundary,
    `core/gateways/egress.py`) apply these predicates under its own flag instead of the
    webhook one. Left unset, the webhook flag decides, which is what every existing caller
    and every existing test relies on.
    """
    if _WEBHOOK_ALLOW_INSECURE if allow_insecure is None else allow_insecure:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or _in_shared_address_space(ip)
    )


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
