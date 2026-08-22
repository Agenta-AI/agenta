"""A rejected `Secret` token must say WHY it was rejected.

Trace exports from the agent runner failed with 401 for a week and the server side logged
nothing that told an expired credential apart from a malformed one. These pin the two reasons
and the age the expired one reports.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jwt import decode, encode
from starlette.requests import Request

from oss.src.middlewares import auth
from oss.src.utils.exceptions import InternalServerErrorException, UnauthorizedException


SECRET_KEY = "unit-test-secret-key-with-32-bytes"


class _RecordingLog:
    """Stands in for the module logger and keeps every (level, event, fields) call."""

    def __init__(self):
        self.calls = []

    def _record(self, level):
        def log(event, *args, **fields):
            self.calls.append((level, event, fields))

        return log

    def __getattr__(self, level):
        return self._record(level)

    def of(self, level):
        return [call for call in self.calls if call[0] == level]


@pytest.fixture(name="log")
def _log(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(auth, "log", recorder)
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)
    return recorder


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/otlp/v1/traces",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


def _token(expires_in_seconds: int) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
    return encode(
        payload={"user_id": "u", "project_id": "p", "exp": int(expiry.timestamp())},
        key=SECRET_KEY,
        algorithm="HS256",
    )


@pytest.mark.asyncio
async def test_expired_token_reports_expired_signature_and_its_age(log):
    with pytest.raises(UnauthorizedException) as raised:
        await auth.verify_secret_token(
            request=_request(),
            secret_token=_token(expires_in_seconds=-3600),
        )

    assert raised.value.detail["reason"] == "expired_signature"

    (_, event, fields) = log.of("warn")[0]
    assert event == "[auth] secret token unauthorized"
    assert fields["reason"] == "expired_signature"
    # The age is what names the cause: the runner held the credential past its 15-minute life.
    assert 3500 < fields["expired_seconds_ago"] < 3700


@pytest.mark.asyncio
async def test_malformed_token_reports_invalid_token(log):
    with pytest.raises(UnauthorizedException) as raised:
        await auth.verify_secret_token(request=_request(), secret_token="not-a-jwt")

    assert raised.value.detail["reason"] == "invalid_token"

    (_, event, fields) = log.of("debug")[0]
    assert event == "[auth] secret token unauthorized"
    assert fields["reason"] == "invalid_token"
    assert log.of("warn") == []


@pytest.mark.asyncio
async def test_live_token_authenticates_and_logs_nothing(log):
    request = _request()

    await auth.verify_secret_token(
        request=request,
        secret_token=_token(expires_in_seconds=600),
    )

    assert request.state.user_id == "u"
    assert request.state.project_id == "p"
    assert log.calls == []


@pytest.mark.asyncio
async def test_signed_token_records_exact_issued_at_lifetime(log):
    token = await auth.sign_secret_token(user_id="u", project_id="p")

    claims = decode(
        jwt=token,
        key=SECRET_KEY,
        algorithms=["HS256"],
    )

    assert isinstance(claims["iat"], int)
    assert isinstance(claims["exp"], int)
    assert claims["exp"] - claims["iat"] == auth._SECRET_EXP


@pytest.mark.asyncio
async def test_intentional_http_exception_survives_verification(log, monkeypatch):
    expected = HTTPException(status_code=401, detail="Intentional denial")

    def reject(*args, **kwargs):
        raise expected

    monkeypatch.setattr(auth, "decode", reject)

    with pytest.raises(HTTPException) as raised:
        await auth.verify_secret_token(request=_request(), secret_token="unused")

    assert raised.value is expected


@pytest.mark.asyncio
async def test_unexpected_verification_error_stays_internal(log, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(auth, "decode", fail)

    with pytest.raises(InternalServerErrorException) as raised:
        await auth.verify_secret_token(request=_request(), secret_token="unused")

    assert raised.value.status_code == 500


def test_unauthorized_reason_reads_the_raiser_s_reason():
    # This is what the middleware's 401 branch logs, so a 401 is one grep either way.
    assert (
        auth._unauthorized_reason(UnauthorizedException(reason="expired_signature"))
        == "expired_signature"
    )
    assert auth._unauthorized_reason(HTTPException(401, "Unauthorized")) is None
