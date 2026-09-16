"""The probe against a real MCP server, over the deployment's own egress.

Every other case for the probe answers from a transport this process controls, and one
thing no such transport reproduces is that real servers compress their responses. A
capped read yields decoded bytes, and rebuilding the response around them while keeping
the upstream's `content-encoding` made the next read raise `DecodingError`, which left
the connect dialog with a 500 and no cause. The mock upstreams serve uncompressed, so
every suite stayed green while probing any real server was broken.

This is the case that would have caught it. It needs a deployment with outbound internet
access, which is why it is acceptance rather than unit, and it needs no credential and no
consent: the probe is the unauthenticated step that asks a server how to authorize.

Set `AGENTA_ACCEPTANCE_REAL_MCP_URL` to point it elsewhere. It skips rather than fails
when the network is unavailable, because a firewalled runner is not a broken gateway.
"""

from __future__ import annotations

import os

import httpx
import pytest


# Linear's public MCP server: OAuth-protected, dynamically registrable, and stable.
_REAL_MCP_URL = os.getenv(
    "AGENTA_ACCEPTANCE_REAL_MCP_URL", "https://mcp.linear.app/mcp"
)

pytestmark = [pytest.mark.acceptance]


def _reachable(url: str) -> bool:
    try:
        with httpx.Client(timeout=10.0) as client:
            client.get(url)
        return True
    except httpx.HTTPError:
        return False


@pytest.mark.acceptance
def test_the_probe_discovers_oauth_on_a_real_server(authed_api):
    """A compressed answer from a real server has to survive the capped read."""
    if not _reachable(_REAL_MCP_URL):
        pytest.skip(f"{_REAL_MCP_URL} is not reachable from this runner")

    response = authed_api(
        "POST", "/gateways/mcps/endpoints/probe", json={"url": _REAL_MCP_URL}
    )

    # The 500 this case exists for.
    assert response.status_code == 200, response.text
    probe = response.json()["probe"]

    # `problem` is omitted rather than null when there is none.
    assert probe.get("problem") is None, probe.get("problem")
    assert probe["reachable"] is True
    assert probe["auth"]["mode"] == "oauth"
    # Read out of the server's own metadata documents, so a body that did not decode
    # could not have produced them.
    assert probe["auth"]["authorization_server"]
    assert probe["auth"]["scopes_offered"]
