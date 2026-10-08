"""Network-safety helpers shared by every outbound call to an address that came from users,
tenants or upstreams: the blocked-address predicate and the connect-to-the-checked-address pin.
"""

import ipaddress
from urllib.parse import urlparse, urlunparse


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


def is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    """The six address predicates plus RFC 6598, with no policy flag. Callers own the flag."""
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or _in_shared_address_space(ip)
    )


def pin_to_resolved_address(url: str, address: str) -> tuple[str, str]:
    """Swap the URL host for the literal checked address; return (pinned_url, Host header).

    This is the TOCTOU close: the connection is made to the address the guard just checked,
    so a name that re-resolves between the check and the connect cannot move the request. The
    original authority travels as `Host` (and as the TLS SNI name, set by the caller from
    `extensions`), so the upstream still routes and still presents a certificate for the name
    that was registered.
    """
    parsed = urlparse(url)
    host_literal = f"[{address}]" if ":" in address else address
    pinned_netloc = f"{host_literal}:{parsed.port}" if parsed.port else host_literal
    pinned_url = urlunparse(parsed._replace(netloc=pinned_netloc))

    hostname = parsed.hostname or ""
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port:
        host_header = f"{host_header}:{parsed.port}"

    return pinned_url, host_header
