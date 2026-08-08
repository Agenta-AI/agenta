"""HMAC signing/verification for both directions of the bridge wire contract,
with timestamp replay protection. Mirrors the Slack adapter's scheme (same
`v0:{timestamp}:{body}` base string, same digest shape) so a bridge author
already familiar with Slack's docs recognises it.
"""

import hashlib
import hmac
import time
from typing import Mapping, Optional

from oss.src.core.channels.types import ChannelSignatureInvalid

_VERSION = "v0"
SIGNATURE_HEADER = "x-agenta-bridge-signature"
TIMESTAMP_HEADER = "x-agenta-bridge-timestamp"
_REPLAY_WINDOW_SECONDS = 300


def _is_fresh(timestamp: str, *, now: float) -> bool:
    try:
        sent_at = int(timestamp)
    except ValueError:
        return False
    return abs(now - sent_at) <= _REPLAY_WINDOW_SECONDS


def _digest(*, secret: str, timestamp: str, body: bytes) -> str:
    signed_bytes = f"{_VERSION}:{timestamp}:".encode("utf-8") + body
    return (
        f"{_VERSION}="
        + hmac.new(secret.encode("utf-8"), signed_bytes, hashlib.sha256).hexdigest()
    )


def verify_bridge_signature(
    *,
    headers: Mapping[str, str],
    body: bytes,
    secret: str,
    channel: str = "bridge",
) -> None:
    """Raise ChannelSignatureInvalid unless the request is fresh and signed.

    Callers passing a plain dict (tests) must lower-case their own keys, same
    convention as the Slack adapter's verifier.
    """

    signature = headers.get(SIGNATURE_HEADER)
    timestamp = headers.get(TIMESTAMP_HEADER)

    if not signature or not timestamp or not _is_fresh(timestamp, now=time.time()):
        raise ChannelSignatureInvalid(channel=channel)

    expected = _digest(secret=secret, timestamp=timestamp, body=body)

    if not hmac.compare_digest(expected, signature):
        raise ChannelSignatureInvalid(channel=channel)


def sign_outbound(
    *, secret: str, body: bytes, timestamp: Optional[str] = None
) -> Mapping[str, str]:
    """Sign a delivery command for the bridge to verify on its side. Returns
    the two headers to attach to the outbound HTTP call."""

    ts = timestamp or str(int(time.time()))
    return {
        SIGNATURE_HEADER: _digest(secret=secret, timestamp=ts, body=body),
        TIMESTAMP_HEADER: ts,
    }
