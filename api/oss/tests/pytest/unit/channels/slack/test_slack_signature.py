import time

import pytest

from oss.src.core.channels.adapters.slack.signature import verify_slack_signature
from oss.src.core.channels.types import ChannelSignatureInvalid

SECRET = "test-fixture-signing-secret-not-real"  # synthetic, not a live value
BODY = (
    b"token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&"
    b"team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&"
    b"user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&"
    b"text=&response_url=https%3A%2F%2Fhooks.slack.com%2F&trigger_id=xxx"
)


def _signed_headers(*, timestamp: str, body: bytes, secret: str = SECRET):
    import hashlib
    import hmac

    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
    }


def test_valid_signature_within_window_verifies():
    timestamp = str(int(time.time()))
    headers = _signed_headers(timestamp=timestamp, body=BODY)

    verify_slack_signature(headers=headers, body=BODY, signing_secret=SECRET)


def test_valid_signature_stale_timestamp_is_rejected():
    stale_timestamp = str(int(time.time()) - 600)
    headers = _signed_headers(timestamp=stale_timestamp, body=BODY)

    with pytest.raises(ChannelSignatureInvalid):
        verify_slack_signature(headers=headers, body=BODY, signing_secret=SECRET)


def test_tampered_body_original_signature_is_rejected():
    timestamp = str(int(time.time()))
    headers = _signed_headers(timestamp=timestamp, body=BODY)

    with pytest.raises(ChannelSignatureInvalid):
        verify_slack_signature(
            headers=headers, body=BODY + b"tampered", signing_secret=SECRET
        )


def test_both_rejection_paths_raise_the_same_exception_with_no_detail():
    timestamp = str(int(time.time()))
    stale_timestamp = str(int(time.time()) - 600)

    stale_headers = _signed_headers(timestamp=stale_timestamp, body=BODY)
    tampered_headers = _signed_headers(timestamp=timestamp, body=BODY)

    stale_error = None
    tampered_error = None

    try:
        verify_slack_signature(headers=stale_headers, body=BODY, signing_secret=SECRET)
    except ChannelSignatureInvalid as e:
        stale_error = e

    try:
        verify_slack_signature(
            headers=tampered_headers, body=BODY + b"x", signing_secret=SECRET
        )
    except ChannelSignatureInvalid as e:
        tampered_error = e

    assert type(stale_error) is type(tampered_error) is ChannelSignatureInvalid
    assert str(stale_error) == str(tampered_error)


def test_missing_headers_is_rejected():
    with pytest.raises(ChannelSignatureInvalid):
        verify_slack_signature(headers={}, body=BODY, signing_secret=SECRET)
