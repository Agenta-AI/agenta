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

Set `AGENTA_ACCEPTANCE_REAL_MCP_URL` to point it elsewhere. It skips rather than fails when
the network is unavailable, because a firewalled deployment is not a broken gateway — and
the deployment is what has to be asked. This process reached the server over its own
network, which in CI is a different machine from the one running the API, so a runner with
internet and a container without it ran the case and failed, and a runner without internet
skipped a case the container could have run (D80).
"""

from __future__ import annotations

import os

import pytest


# Linear's public MCP server: OAuth-protected, dynamically registrable, and stable.
_REAL_MCP_URL = os.getenv(
    "AGENTA_ACCEPTANCE_REAL_MCP_URL", "https://mcp.linear.app/mcp"
)

pytestmark = [pytest.mark.acceptance]


# A connection that never opened, as the deployment's own egress classifies it. These say
# the API container has no route to the server, which is a firewall rather than a defect.
# `unresolvable` leads because a machine with no outbound network fails at the name.
#
# Everything else is a failure on purpose, and `transport_error` most of all: an answer the
# gateway received and could not read is precisely the regression this case exists for, and
# it arrives under the same coarse `unreachable` cause as a refused connection. A refusal by
# the address checks names no transport at all and so is a failure too, which is right: the
# gateway declining to dial a real public server is a defect in the gateway.
_NO_ROUTE = frozenset({"unresolvable", "connect_error", "proxy_error", "timeout"})


@pytest.mark.acceptance
def test_the_probe_discovers_oauth_on_a_real_server(authed_api):
    """A compressed answer from a real server has to survive the capped read."""
    response = authed_api(
        "POST", "/gateways/mcps/endpoints/probe", json={"url": _REAL_MCP_URL}
    )

    # The 500 this case exists for.
    assert response.status_code == 200, response.text
    probe = response.json()["probe"]

    problem = probe.get("problem") or {}
    if problem.get("transport") in _NO_ROUTE:
        pytest.skip(
            f"the deployment under test has no route to {_REAL_MCP_URL} "
            f"({problem.get('transport')}): {problem.get('message')}"
        )

    # `problem` is omitted rather than null when there is none.
    assert probe.get("problem") is None, probe.get("problem")
    assert probe["reachable"] is True
    assert probe["auth"]["mode"] == "oauth"
    # Read out of the server's own metadata documents, so a body that did not decode
    # could not have produced them.
    assert probe["auth"]["authorization_server"]
    assert probe["auth"]["scopes_offered"]
