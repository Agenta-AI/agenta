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
from oss.src.utils.exceptions import UnauthorizedException


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


def _request(path: str = "/otlp/v1/traces") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
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


def test_unauthorized_reason_reads_the_raiser_s_reason():
    # This is what the middleware's 401 branch logs, so a 401 is one grep either way.
    assert (
        auth._unauthorized_reason(UnauthorizedException(reason="expired_signature"))
        == "expired_signature"
    )
    assert auth._unauthorized_reason(HTTPException(401, "Unauthorized")) is None


def _claims(token: str) -> dict:
    return decode(
        jwt=token,
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_exp": False},
    )


@pytest.mark.asyncio
async def test_unscoped_token_round_trips_on_any_path_with_no_scope_claim(log):
    token = await auth.sign_secret_token(user_id="u", project_id="p")

    assert "scope" not in _claims(token)

    request = _request(path="/workflows/123/revisions/commit")

    await auth.verify_secret_token(request=request, secret_token=token)

    assert request.state.user_id == "u"
    assert request.state.project_id == "p"
    assert request.state.credentials == f"Secret {token}"
    assert log.calls == []


@pytest.mark.asyncio
async def test_trace_ingest_token_verifies_on_the_otlp_ingest_path(log):
    token = await auth.sign_secret_token(
        user_id="u",
        project_id="p",
        scope=auth.TRACE_INGEST_SCOPE,
        expires_in=2 * 60 * 60,
    )

    request = _request(path="/otlp/v1/traces")

    await auth.verify_secret_token(request=request, secret_token=token)

    assert request.state.user_id == "u"
    assert request.state.project_id == "p"
    assert log.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/workflows/123/revisions/commit",
        "/vault/v1/secrets",
    ],
)
async def test_trace_ingest_token_is_rejected_everywhere_else(log, path):
    token = await auth.sign_secret_token(
        user_id="u",
        project_id="p",
        scope=auth.TRACE_INGEST_SCOPE,
        expires_in=2 * 60 * 60,
    )

    with pytest.raises(UnauthorizedException) as raised:
        await auth.verify_secret_token(request=_request(path=path), secret_token=token)

    assert raised.value.status_code == 401
    assert raised.value.detail["reason"] == "scope_forbidden"

    (_, event, fields) = log.of("warn")[0]
    assert event == "[auth] secret token unauthorized"
    assert fields["reason"] == "scope_forbidden"
    assert fields["scope"] == auth.TRACE_INGEST_SCOPE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/otlp/v1/traces",
        "/workflows/123/revisions/commit",
        "/vault/v1/secrets",
    ],
)
async def test_unknown_scope_is_rejected_on_every_path(log, path):
    token = await auth.sign_secret_token(
        user_id="u",
        project_id="p",
        scope="garbage-scope",
    )

    with pytest.raises(UnauthorizedException) as raised:
        await auth.verify_secret_token(request=_request(path=path), secret_token=token)

    assert raised.value.detail["reason"] == "scope_forbidden"


@pytest.mark.asyncio
async def test_expiry_override_changes_exp_and_the_default_stays_fifteen_minutes(log):
    now = datetime.now(timezone.utc).timestamp()

    overridden = await auth.sign_secret_token(user_id="u", expires_in=60)
    assert now + 55 < _claims(overridden)["exp"] < now + 65

    # No override = the general credential's unchanged 15-minute lifetime.
    default = await auth.sign_secret_token(user_id="u")
    assert now + 15 * 60 - 5 < _claims(default)["exp"] < now + 15 * 60 + 5


@pytest.mark.asyncio
async def test_every_token_records_when_it_was_issued(log):
    """A rejected credential has to be able to say how OLD it is, not only that it expired.

    The export-failure diagnostics report credential age from `iat`; without it a stale
    credential is indistinguishable from a wrong one, which is what made this class of 401
    take a week to diagnose.
    """
    now = datetime.now(timezone.utc).timestamp()

    for token in (
        await auth.sign_secret_token(user_id="u"),
        await auth.sign_secret_token(user_id="u", scope=auth.TRACE_INGEST_SCOPE),
        await auth.sign_secret_token(user_id="u", expires_in=60),
    ):
        assert now - 5 < _claims(token)["iat"] < now + 5


@pytest.mark.asyncio
async def test_issued_at_and_expiry_span_exactly_the_requested_lifetime(log):
    # Both derive from one instant, so age + remaining life never drift apart.
    claims = _claims(await auth.sign_secret_token(user_id="u", expires_in=7200))

    assert claims["exp"] - claims["iat"] == 7200


@pytest.mark.asyncio
async def test_expired_scoped_token_is_rejected_as_expired(log):
    token = await auth.sign_secret_token(
        user_id="u",
        scope=auth.TRACE_INGEST_SCOPE,
        expires_in=-3600,
    )

    with pytest.raises(UnauthorizedException) as raised:
        await auth.verify_secret_token(
            request=_request(path="/otlp/v1/traces"),
            secret_token=token,
        )

    assert raised.value.detail["reason"] == "expired_signature"
