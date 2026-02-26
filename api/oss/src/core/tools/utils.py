"""OAuth state signing utilities for tool connection callbacks."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional
from uuid import UUID


_STATE_TTL = 3600  # 1 hour


def make_oauth_state(
    *,
    project_id: UUID,
    user_id: UUID,
    secret_key: str,
) -> str:
    """Generate an HMAC-signed state token to embed in OAuth callback URLs."""
    payload = {
        "project_id": str(project_id),
        "user_id": str(user_id),
        "nonce": secrets.token_hex(8),
        "ts": int(time.time()),
    }
    payload_bytes = json.dumps(payload, sort_keys=True).encode()
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode().rstrip("=")
    sig = hmac.new(
        secret_key.encode(),
        payload_b64.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def decode_oauth_state(
    state: str,
    *,
    secret_key: str,
    max_age: int = _STATE_TTL,
) -> Optional[dict]:
    """Validate and decode an HMAC-signed OAuth state token.

    Returns the payload dict, or None if the signature is invalid or the token
    has expired.
    """
    try:
        payload_b64, sig = state.rsplit(".", 1)
        expected_sig = hmac.new(
            secret_key.encode(),
            payload_b64.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None

        # Restore stripped padding
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload = json.loads(base64.urlsafe_b64decode(payload_b64))

        if time.time() - payload.get("ts", 0) > max_age:
            return None

        return payload
    except Exception:
        return None
