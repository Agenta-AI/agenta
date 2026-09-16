"""Mint the opaque `state` handle for an MCP OAuth authorization attempt.

The handle carries nothing. Everything the callback needs — the PKCE verifier, the
initiating user, the project, the endpoint, the issuer, the token endpoint and the
redirect URI — lives in a server-side authorization attempt record addressed by this
handle. The handle travels through the authorization server's URL and logs, so the
authorization server learns only an unguessable identifier it cannot decode.
"""

import secrets

# 32 bytes of entropy, 43 url-safe characters.
_STATE_BYTES = 32

# An attempt is a browser round trip through a consent screen. Ten minutes covers a
# slow consent and leaves the verifier readable for as short a time as is practical.
STATE_TTL_SECONDS = 600


def new_state() -> str:
    """Return an opaque, unguessable, single-use authorization attempt handle."""
    return secrets.token_urlsafe(_STATE_BYTES)
