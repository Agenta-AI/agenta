"""The OAuth `state` token (specs-wp17.md "The state token").

Same HMAC-signed, base64url shape as `core/gateway/connections/utils.py`'s
`make_oauth_state`/`decode_oauth_state`, reimplemented here rather than imported to keep
this package independent of the Composio/connections domain (specs-wp17.md: "target:
custom only"). Carries the PKCE code_verifier across the browser round trip — there is no
server-side session to hold it, and the request may land on any replica.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import List, Optional, TypedDict
from uuid import UUID

_STATE_TTL_SECONDS = 3600


class MCPOAuthStatePayload(TypedDict):
    project_id: str
    user_id: str
    server_url: str
    code_verifier: str
    scopes: List[str]
    nonce: str
    ts: int


def make_state(
    *,
    project_id: UUID,
    user_id: UUID,
    server_url: str,
    code_verifier: str,
    scopes: List[str],
    secret_key: str,
) -> str:
    payload = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "server_url": server_url,
        "code_verifier": code_verifier,
        "scopes": scopes,
        "nonce": secrets.token_hex(8),
        "ts": int(time.time()),
    }
    payload_bytes = json.dumps(payload, sort_keys=True).encode()
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode().rstrip("=")
    sig = hmac.new(
        secret_key.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def decode_state(
    state: str,
    *,
    secret_key: str,
    max_age: int = _STATE_TTL_SECONDS,
) -> Optional[MCPOAuthStatePayload]:
    try:
        payload_b64, sig = state.rsplit(".", 1)
        expected_sig = hmac.new(
            secret_key.encode(), payload_b64.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None

        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload = json.loads(base64.urlsafe_b64decode(payload_b64))

        if time.time() - payload.get("ts", 0) > max_age:
            return None

        return payload
    except Exception:
        return None
