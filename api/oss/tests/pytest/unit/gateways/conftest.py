"""Shared fixtures for the gateway unit suites.

Both relay planes and the MCP OAuth client now resolve their target before they dial it
(`core/gateways/egress.py`, OD26). Unit tests must never make that a real DNS lookup: the
result would depend on the machine, and `example`/`.test` names do not resolve at all. Every
test in this directory therefore gets a stubbed resolver that answers with one public
address, so the guard runs for real — resolve, range-check, pin — against a deterministic
answer. A test that wants a different answer calls `resolves_to` (or patches `getaddrinfo`
itself), which wins because it runs inside the test body.

A stubbed answer is not enough on its own, because the answer is fetched through a bounded
thread pool: `resolve_offloaded` gives a caller one second to be given a thread at all and
refuses the address when that runs out. Under `-n auto` on a busy box, twenty worker
processes can miss that bound while the resolution itself takes microseconds, and the case
then fails on a refusal with nothing to do with the code it is about. So the offload is
taken out of the way here too, and the cases whose subject IS the pool ask for it back by
taking `real_resolver_offload`.
"""

import pytest

from oss.src.core.gateways import egress
from oss.src.core.gateways.mcps.oauth import registration
from oss.src.utils.env import env

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


@pytest.fixture
def real_resolver_offload():
    """Keep the resolver's own offload: its thread pool, its two bounds and their timing.

    For the cases whose subject is the pool. Everywhere else the offload is scaffolding
    between a test and the answer it stubbed, and its one-second queue bound makes the case
    depend on how busy the box is.
    """
    return True


@pytest.fixture(autouse=True)
def _resolve_without_the_pool(request, monkeypatch):
    """Resolve on the spot, so no case in this directory waits for a thread.

    `resolve_offloaded` refuses an address when no pool thread becomes free within a second,
    and reports it as `saturated`. That bound is right on the relay path and wrong here: the
    resolution is a stub answering in microseconds, so all the bound can measure is the
    scheduling delay of a twenty-worker run, and a case that fails on it has been failed by
    the box. Observed as an intermittent failure in the OAuth registration suite, whose
    discovery leg refused with "no protected-resource metadata found" while the log carried
    `saturated=True waited=1.767`.
    """
    if "real_resolver_offload" in request.fixturenames:
        return

    async def _inline(resolve, *, timeout=None):
        return resolve()

    # Both bindings: the boundary calls it as a module global, and the registration check
    # imported the name into its own module, so patching one leaves the other on the pool.
    monkeypatch.setattr(egress, "resolve_offloaded", _inline)
    monkeypatch.setattr(registration, "resolve_offloaded", _inline)


@pytest.fixture(autouse=True)
def _llm_gateway_plane_on(monkeypatch):
    """Serve the LLM gateway plane for the suites in this directory.

    `AGENTA_LLM_GATEWAY_ENABLED` defaults off, so every one of these tests would otherwise
    be answered by the switch instead of by the code it is about. What the switch itself
    does — that it refuses, in which shape, on which surfaces, and that it leaves the MCP
    plane alone — is asserted in `test_gateways_plane_flags.py`, which sets both switches
    per test and so is unaffected by this default.

    The MCP plane needs no equivalent: its switch ships on.
    """
    monkeypatch.setattr(env.llm_gateway, "enabled", True)
