"""Unit tests for the MCP OAuth state token (specs-wp17.md "The state token")."""

from __future__ import annotations

import time
from uuid import uuid4

from oss.src.core.gateways.mcps.oauth.state import decode_state, make_state

_SECRET = "unit-test-secret"


def test_state_round_trips_all_fields():
    project_id, user_id = uuid4(), uuid4()

    state = make_state(
        project_id=project_id,
        user_id=user_id,
        server_url="https://mcp.acme.io/",
        code_verifier="a" * 43,
        scopes=["read", "write"],
        secret_key=_SECRET,
    )
    payload = decode_state(state, secret_key=_SECRET)

    assert payload is not None
    assert payload["project_id"] == str(project_id)
    assert payload["user_id"] == str(user_id)
    assert payload["server_url"] == "https://mcp.acme.io/"
    assert payload["code_verifier"] == "a" * 43
    assert payload["scopes"] == ["read", "write"]


def test_tampered_state_is_rejected():
    state = make_state(
        project_id=uuid4(),
        user_id=uuid4(),
        server_url="https://mcp.acme.io/",
        code_verifier="a" * 43,
        scopes=[],
        secret_key=_SECRET,
    )
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")

    assert decode_state(tampered, secret_key=_SECRET) is None


def test_expired_state_is_rejected():
    state = make_state(
        project_id=uuid4(),
        user_id=uuid4(),
        server_url="https://mcp.acme.io/",
        code_verifier="a" * 43,
        scopes=[],
        secret_key=_SECRET,
    )

    assert decode_state(state, secret_key=_SECRET, max_age=-1) is None


def test_wrong_secret_key_is_rejected():
    state = make_state(
        project_id=uuid4(),
        user_id=uuid4(),
        server_url="https://mcp.acme.io/",
        code_verifier="a" * 43,
        scopes=[],
        secret_key=_SECRET,
    )

    assert decode_state(state, secret_key="a-different-secret") is None


def test_state_carries_a_fresh_timestamp():
    state = make_state(
        project_id=uuid4(),
        user_id=uuid4(),
        server_url="https://mcp.acme.io/",
        code_verifier="a" * 43,
        scopes=[],
        secret_key=_SECRET,
    )
    payload = decode_state(state, secret_key=_SECRET)

    assert payload is not None
    assert abs(time.time() - payload["ts"]) < 5
