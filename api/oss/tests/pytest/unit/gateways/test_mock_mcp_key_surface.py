"""The header-authenticated mock MCP surface.

The connect journey's API-key screen is reached by probing a server that answers the
anonymous handshake with a 401 naming no OAuth metadata. No mock surface answered that
way: `/` is open, `/oauth/mcp` publishes a protected-resource document, and the bearer
profile on `/` is selected by an `X-Agenta-Mock-Profile` request header a browser never
sends. So the screen existed and nothing could be pointed at it by hand.

Driven through Starlette's `TestClient` against the router directly, so these cases do not
depend on `AGENTA_GATEWAYS_MOCKS_ENABLED`, which decides only whether the deployed app
mounts it.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.core.gateways.mcps.providers.mock.app import (
    KEY_MCP_PATH,
    build_key_router,
    relay,
)
from oss.src.utils.env import env

_HANDSHAKE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {}},
}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.post("/")(relay)
    app.include_router(build_key_router())
    return TestClient(app)


@pytest.fixture
def key() -> str:
    return env.mock_gateways.mcp_key_value


def test_the_unauthenticated_handshake_is_challenged(client):
    response = client.post(KEY_MCP_PATH, json=_HANDSHAKE)

    assert response.status_code == 401
    assert "Bearer" in response.headers["WWW-Authenticate"]
    # The whole point of this surface. A challenge naming a protected-resource document is
    # the OAuth path; this one has to be the other one, or the probe reports `oauth` and
    # the key screen is unreachable again.
    assert "resource_metadata" not in response.headers["WWW-Authenticate"]
    assert env.mock_gateways.mcp_key_header in response.json()["error_description"]


def test_a_get_is_challenged_rather_than_refused_as_a_method(client):
    """`/` answers 405 to a GET, which tells a client nothing about what it wants."""
    response = client.get(KEY_MCP_PATH)

    assert response.status_code == 401
    assert "resource_metadata" not in response.headers["WWW-Authenticate"]


def test_it_publishes_no_protected_resource_document(client):
    assert client.get("/.well-known/oauth-protected-resource").status_code == 404
    assert (
        client.get(f"/.well-known/oauth-protected-resource{KEY_MCP_PATH}").status_code
        == 404
    )


def test_the_registered_header_is_accepted(client, key):
    """What an endpoint carrying a `credential_header` sends: the stored value verbatim,
    under the name the endpoint registered."""
    response = client.post(
        KEY_MCP_PATH,
        json=_HANDSHAKE,
        headers={env.mock_gateways.mcp_key_header: key},
    )

    assert response.status_code == 200
    assert response.json()["result"]["serverInfo"]["name"]


def test_the_authorization_fallback_is_accepted(client, key):
    """What an endpoint that registered no header name sends
    (`providers/http/adapter.py::_credential_headers`)."""
    response = client.post(
        KEY_MCP_PATH,
        json=_HANDSHAKE,
        headers={"Authorization": f"Bearer {key}"},
    )

    assert response.status_code == 200


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Api-Key": "wrong"},
        {"Authorization": "Bearer wrong"},
        {"Authorization": "wrong"},
    ],
)
def test_a_credential_it_did_not_issue_is_refused(client, headers):
    response = client.post(KEY_MCP_PATH, json=_HANDSHAKE, headers=headers)

    assert response.status_code == 401


def test_an_authorized_request_answers_the_same_bytes_as_the_open_surface(client, key):
    """One handler behind all three surfaces, so the framing rules stay in one place."""
    authorized = client.post(
        KEY_MCP_PATH, json=_HANDSHAKE, headers={env.mock_gateways.mcp_key_header: key}
    )
    open_surface = client.post("/", json=_HANDSHAKE)

    assert authorized.status_code == open_surface.status_code
    assert authorized.headers["content-type"] == open_surface.headers["content-type"]
    assert json.loads(authorized.content) == json.loads(open_surface.content)


def test_a_notification_is_still_framed_as_one(client, key):
    """202 with no body, which is the strict framing every mock tier owes a client.

    Carrying the negotiated protocol version, because the shared handler refuses a
    post-handshake call without it — the rule this surface must not soften.
    """
    response = client.post(
        KEY_MCP_PATH,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={
            env.mock_gateways.mcp_key_header: key,
            "mcp-protocol-version": "2025-03-26",
        },
    )

    assert response.status_code == 202
    assert not response.content


def test_the_framing_rules_are_not_softened_by_the_credential(client, key):
    """A call past the handshake that omits the negotiated version is still refused,
    with the credential accepted. The surface adds authentication and nothing else."""
    response = client.post(
        KEY_MCP_PATH,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        headers={env.mock_gateways.mcp_key_header: key},
    )

    assert response.status_code == 400
