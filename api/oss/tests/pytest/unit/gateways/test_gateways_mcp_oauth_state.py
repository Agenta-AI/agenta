"""Unit tests for the MCP OAuth state handle (OD25).

The handle is opaque. These cases pin that it stays opaque: there is nothing in it to
decode, and nothing about the attempt can be read back out of it.
"""

from __future__ import annotations

import base64
import json
import re

from oss.src.core.gateways.mcps.oauth.state import STATE_TTL_SECONDS, new_state


def test_state_is_url_safe_and_high_entropy():
    state = new_state()

    assert re.fullmatch(r"[A-Za-z0-9_-]+", state)
    # 32 bytes of randomness, base64url without padding.
    assert len(state) >= 43


def test_two_states_never_collide():
    states = {new_state() for _ in range(2000)}

    assert len(states) == 2000


def test_state_has_no_decodable_structure():
    """The old handle was `base64url(json).hmac`, so the authorization server could
    read the PKCE verifier straight out of the query string. Nothing decodes now."""
    state = new_state()

    assert "." not in state

    padded = state + "=" * (-len(state) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded)
    except Exception:  # pylint: disable=broad-except
        return

    try:
        payload = json.loads(decoded)
    except Exception:  # pylint: disable=broad-except
        return

    raise AssertionError(f"state decoded to structured content: {payload}")


def test_the_attempt_window_is_minutes_not_an_hour():
    assert 0 < STATE_TTL_SECONDS <= 900
