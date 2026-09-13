"""Shared fixtures for the gateway unit suites.

Both relay planes and the MCP OAuth client now resolve their target before they dial it
(`core/gateways/egress.py`, OD26). Unit tests must never make that a real DNS lookup: the
result would depend on the machine, and `example`/`.test` names do not resolve at all. Every
test in this directory therefore gets a stubbed resolver that answers with one public
address, so the guard runs for real — resolve, range-check, pin — against a deterministic
answer. A test that wants a different answer calls `resolves_to` (or patches `getaddrinfo`
itself), which wins because it runs inside the test body.
"""

import pytest

# example.com. Routable and in no blocked range, matching the webhook suite's precedent.
PUBLIC_ADDRESS = "93.184.216.34"

# The three addresses a registered hostname must not be allowed to reach at request time.
LOOPBACK_ADDRESS = "127.0.0.1"
LINK_LOCAL_ADDRESS = "169.254.169.254"  # cloud instance metadata
PRIVATE_ADDRESS = "10.0.0.7"


def _addrinfo(*addresses: str):
    return [(None, None, None, None, (address, 0)) for address in addresses]


@pytest.fixture
def resolves_to(monkeypatch):
    """Make every hostname resolve to the given addresses, in order.

    Returns the call log, so a test can assert the guard was consulted.
    """
    calls: list[str] = []

    def _apply(*addresses: str):
        def _getaddrinfo(host, *_args, **_kwargs):
            calls.append(host)
            return _addrinfo(*addresses)

        monkeypatch.setattr(
            "oss.src.core.webhooks.utils.socket.getaddrinfo", _getaddrinfo
        )
        return calls

    return _apply


@pytest.fixture(autouse=True)
def _public_dns_by_default(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *_args, **_kwargs: _addrinfo(PUBLIC_ADDRESS),
    )
