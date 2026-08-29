"""Generator for the cross-language SSRF-guard fixtures.

Two artifacts, both derived from Python's own `ipaddress` module — the ground truth,
independent of both `agenta.sdk.utils.net` and the TypeScript guard:

- `generate_ranges()`: the collapsed CIDR tables (private + reserved + multicast, per
  address family) that `services/runner/src/tools/ssrf-guard.ts` loads at runtime instead
  of a hand-transcribed table. IPv4-mapped/compatible IPv6 addresses are unwrapped to their
  embedded IPv4 and checked against the IPv4 table first, mirroring `ipaddress.IPv6Address`'s
  own `is_private`/`is_reserved` (which special-case `ipv4_mapped` before falling back to
  IPv6 network membership) — so the IPv6 table only ever applies to genuine IPv6 literals.
- `generate_vectors()`: boundary/representative addresses labeled via the six blocked
  predicates, for both languages' tests to assert their guard's verdict against.

Regenerating either and diffing against the committed JSON is the drift check: a table edited
in one language without updating the other flips a label and turns a test red.
"""

import ipaddress
from pathlib import Path
from typing import Dict, List

RANGES_PATH = (
    Path(__file__).parents[6]
    / "services"
    / "runner"
    / "src"
    / "tools"
    / "ssrf-guard-ranges.generated.json"
)
VECTORS_PATH = (
    Path(__file__).parent.parent / "unit" / "golden" / "ssrf_guard_vectors.json"
)


def generate_ranges() -> Dict[str, List[str]]:
    v4 = ipaddress._IPv4Constants
    v4_networks = list(v4._private_networks) + [
        v4._reserved_network,
        v4._multicast_network,
    ]
    v6 = ipaddress._IPv6Constants
    v6_networks = (
        list(v6._private_networks)
        + list(v6._reserved_networks)
        + [v6._multicast_network]
    )
    return {
        "ipv4": [str(n) for n in ipaddress.collapse_addresses(v4_networks)],
        "ipv6": [str(n) for n in ipaddress.collapse_addresses(v6_networks)],
    }


HOSTS: List[str] = [
    # 0.0.0.0/8
    "0.0.0.0",
    "0.255.255.255",
    "1.0.0.0",
    # 10.0.0.0/8
    "10.0.0.0",
    "10.255.255.255",
    "9.255.255.255",
    "11.0.0.0",
    # 100.64.0.0/10 (shared address space — NOT blocked)
    "100.64.0.0",
    "100.64.0.1",
    "100.127.255.255",
    "100.63.255.255",
    "100.128.0.0",
    # 127.0.0.0/8
    "127.0.0.1",
    "127.255.255.255",
    "126.255.255.255",
    "128.0.0.0",
    # 169.254.0.0/16
    "169.254.0.1",
    "169.254.169.254",
    "169.254.255.255",
    "169.253.255.255",
    "169.255.0.0",
    # 172.16.0.0/12
    "172.16.0.0",
    "172.31.255.255",
    "172.15.255.255",
    "172.32.0.0",
    # 192.0.0.0/24 (was misremembered as /29 in the runner's hand-transcribed table)
    "192.0.0.0",
    "192.0.0.7",
    "192.0.0.8",
    "192.0.0.170",
    "192.0.0.255",
    "192.0.1.0",
    # 192.0.2.0/24 (TEST-NET-1)
    "192.0.2.0",
    "192.0.2.255",
    "192.0.3.0",
    # 192.168.0.0/16
    "192.168.0.0",
    "192.168.255.255",
    "192.167.255.255",
    "192.169.0.0",
    # 198.18.0.0/15 (benchmarking)
    "198.18.0.0",
    "198.19.255.255",
    "198.17.255.255",
    "198.20.0.0",
    # 198.51.100.0/24 (TEST-NET-2)
    "198.51.100.0",
    "198.51.100.255",
    "198.51.101.0",
    # 203.0.113.0/24 (TEST-NET-3)
    "203.0.113.0",
    "203.0.113.255",
    "203.0.114.0",
    # 224.0.0.0/4 (multicast) + 240.0.0.0/4 (reserved) — one contiguous /3 once collapsed
    "224.0.0.0",
    "239.255.255.255",
    "223.255.255.255",
    "240.0.0.0",
    "255.255.255.254",
    "255.255.255.255",
    # public IPv4
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    # IPv6 unspecified / loopback
    "::",
    "::1",
    "::2",
    # fe80::/10 (link-local)
    "fe80::1",
    "fe80::ffff:ffff:ffff:ffff",
    "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fec0::1",
    # fc00::/7 (unique-local)
    "fc00::1",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    # ff00::/8 (multicast)
    "ff00::1",
    "ff02::1",
    "feff::1",
    # documentation / reserved IPv6
    "2001:db8::1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:10::1",
    "2606:4700:4700::1111",  # public — must stay allowed despite living near 2001::/23
    # IPv4-mapped IPv6
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:93.184.216.34",
    "0:0:0:0:0:ffff:10.0.0.1",
    # public IPv6
    "2001:4860:4860::8888",
]


def generate_vectors() -> List[Dict[str, object]]:
    vectors = []
    for host in HOSTS:
        ip = ipaddress.ip_address(host)
        blocked = (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        )
        vectors.append({"host": host, "blocked": blocked})
    return vectors
