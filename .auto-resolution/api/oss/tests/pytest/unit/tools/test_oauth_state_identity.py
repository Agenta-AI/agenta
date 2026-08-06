from __future__ import annotations

from uuid import uuid4

from oss.src.core.gateway.connections.utils import (
    decode_oauth_state,
    make_oauth_state,
)

_SECRET = "unit-test-secret"


def test_state_round_trips_connection_identity():
    """slug/integration survive the signed round-trip so the OAuth callback can tag the
    completion message and the playground can settle the RIGHT connect widget."""
    project_id, user_id = uuid4(), uuid4()

    state = make_oauth_state(
        project_id=project_id,
        user_id=user_id,
        secret_key=_SECRET,
        slug="github-main",
        integration_key="github",
    )
    payload = decode_oauth_state(state, secret_key=_SECRET)

    assert payload is not None
    assert payload["project_id"] == str(project_id)
    assert payload["slug"] == "github-main"
    assert payload["integration"] == "github"


def test_state_omits_identity_when_not_provided():
    """Back-compat: an untagged token carries no identity keys (older callers/openers)."""
    payload = decode_oauth_state(
        make_oauth_state(
            project_id=uuid4(),
            user_id=uuid4(),
            secret_key=_SECRET,
        ),
        secret_key=_SECRET,
    )

    assert payload is not None
    assert "slug" not in payload
    assert "integration" not in payload


def test_tampered_identity_token_is_rejected():
    """The identity is inside the signed payload — flipping a byte fails the HMAC check."""
    state = make_oauth_state(
        project_id=uuid4(),
        user_id=uuid4(),
        secret_key=_SECRET,
        slug="slack",
        integration_key="slack",
    )
    tampered = state[:-1] + ("0" if state[-1] != "0" else "1")

    assert decode_oauth_state(tampered, secret_key=_SECRET) is None
