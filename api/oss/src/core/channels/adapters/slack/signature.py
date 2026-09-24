# Confirmed against Slack's "Verifying requests from Slack" docs (2026-08):
# headers X-Slack-Signature / X-Slack-Request-Timestamp; base string
# "v0:{timestamp}:{body}"; digest "v0={hexdigest}"; replay window 5 minutes.

import hashlib
import hmac
import time
from typing import Mapping

from oss.src.core.channels.types import ChannelSignatureInvalid

_VERSION = "v0"
_SIGNATURE_HEADER = "x-slack-signature"
_TIMESTAMP_HEADER = "x-slack-request-timestamp"
_REPLAY_WINDOW_SECONDS = 300


def _is_fresh(timestamp: str, *, now: float) -> bool:
    try:
        sent_at = int(timestamp)
    except ValueError:
        return False
    return abs(now - sent_at) <= _REPLAY_WINDOW_SECONDS


def verify_slack_signature(
    *,
    headers: Mapping[str, str],
    body: bytes,
    signing_secret: str,
    channel: str = "slack",
) -> None:
    """Raise ChannelSignatureInvalid unless the request is fresh and signed.

    Case-insensitive header lookup: Slack sends the canonical-cased names, but
    ASGI/Starlette headers are already a case-insensitive mapping — this
    function accepts any Mapping, so callers passing a plain dict (tests) must
    lower-case their own keys.
    """

    signature = headers.get(_SIGNATURE_HEADER)
    timestamp = headers.get(_TIMESTAMP_HEADER)

    if not signature or not timestamp or not _is_fresh(timestamp, now=time.time()):
        raise ChannelSignatureInvalid(channel=channel)

    signed_bytes = f"{_VERSION}:{timestamp}:".encode("utf-8") + body
    expected = (
        f"{_VERSION}="
        + hmac.new(
            signing_secret.encode("utf-8"), signed_bytes, hashlib.sha256
        ).hexdigest()
    )

    if not hmac.compare_digest(expected, signature):
        raise ChannelSignatureInvalid(channel=channel)
