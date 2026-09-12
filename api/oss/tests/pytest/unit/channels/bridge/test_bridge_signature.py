import time

import pytest

from oss.src.core.channels.adapters.bridge.signature import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    sign_outbound,
    verify_bridge_signature,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

SECRET = "test-fixture-bridge-secret-not-real"  # synthetic, not a live value
BODY = b'{"type": "io.agenta.channel.message.received.v1"}'


def _signed_headers(*, timestamp: str, body: bytes, secret: str = SECRET):
    import hashlib
    import hmac

    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {SIGNATURE_HEADER: signature, TIMESTAMP_HEADER: timestamp}


def test_valid_signature_within_window_verifies_inbound():
    timestamp = str(int(time.time()))
    headers = _signed_headers(timestamp=timestamp, body=BODY)

    verify_bridge_signature(headers=headers, body=BODY, secret=SECRET)


def test_valid_signature_within_window_verifies_outbound_the_same_way():
    body = b'{"type": "bridge.receipt"}'
    headers = sign_outbound(secret=SECRET, body=body)

    verify_bridge_signature(headers=headers, body=body, secret=SECRET)


def test_stale_timestamp_and_tampered_signature_are_rejected_identically():
    stale_timestamp = str(int(time.time()) - 600)
    fresh_timestamp = str(int(time.time()))

    stale_headers = _signed_headers(timestamp=stale_timestamp, body=BODY)
    tampered_headers = _signed_headers(timestamp=fresh_timestamp, body=BODY)

    stale_error = None
    tampered_error = None

    try:
        verify_bridge_signature(headers=stale_headers, body=BODY, secret=SECRET)
    except ChannelSignatureInvalid as e:
        stale_error = e

    try:
        verify_bridge_signature(
            headers=tampered_headers, body=BODY + b"x", secret=SECRET
        )
    except ChannelSignatureInvalid as e:
        tampered_error = e

    assert type(stale_error) is type(tampered_error) is ChannelSignatureInvalid
    assert str(stale_error) == str(tampered_error)


def test_missing_headers_is_rejected():
    with pytest.raises(ChannelSignatureInvalid):
        verify_bridge_signature(headers={}, body=BODY, secret=SECRET)
