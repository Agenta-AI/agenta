"""A grant ADDS one capability to a general-purpose Secret token; a scope CONFINES one.

The secret-resolve grant is what lets the platform runtime read write-only vault secrets in
plaintext. These pin the axis separation: a granted token stays valid everywhere (unlike a
scoped one), the claim round-trips into ``request.state.token_grants``, and principals
without it — including plain unscoped tokens — read as grant-less.
"""

from datetime import datetime, timedelta, timezone

import pytest
from jwt import decode, encode
from starlette.requests import Request

from oss.src.middlewares import auth
from oss.src.utils.exceptions import UnauthorizedException


SECRET_KEY = "unit-test-secret-key-with-32-bytes"


class _RecordingLog:
    def __init__(self):
        self.calls = []

    def __getattr__(self, level):
        def log(event, *args, **fields):
            self.calls.append((level, event, fields))

        return log


@pytest.fixture(name="log")
def _log(monkeypatch):
    recorder = _RecordingLog()
    monkeypatch.setattr(auth, "log", recorder)
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)
    return recorder


def _request(path: str = "/vault/v1/secrets/") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


def _claims(token: str) -> dict:
    return decode(
        jwt=token,
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_exp": False},
    )


@pytest.mark.asyncio
async def test_granted_token_carries_the_claim_and_stays_valid_on_any_path(log):
    token = await auth.sign_secret_token(
        user_id="u",
        project_id="p",
        grants=[auth.SECRET_RESOLVE_GRANT],
    )

    assert _claims(token)["grants"] == [auth.SECRET_RESOLVE_GRANT]
    # A grant must never confine the token the way a scope does: the runtime uses this same
    # credential for workflows, tools, and session coordination.
    for path in (
        "/vault/v1/secrets/",
        "/workflows/123/revisions/commit",
        "/access/permissions/check",
    ):
        request = _request(path=path)
        await auth.verify_secret_token(request=request, secret_token=token)
        assert auth.request_has_grant(request, auth.SECRET_RESOLVE_GRANT)

    assert log.calls == []


@pytest.mark.asyncio
async def test_plain_token_carries_no_grants_claim_and_reads_grant_less(log):
    token = await auth.sign_secret_token(user_id="u", project_id="p")

    assert "grants" not in _claims(token)

    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)

    assert request.state.token_grants == ()
    assert not auth.request_has_grant(request, auth.SECRET_RESOLVE_GRANT)


def test_request_without_verified_token_has_no_grants():
    # Session and ApiKey principals never populate token_grants at all.
    assert not auth.request_has_grant(_request(), auth.SECRET_RESOLVE_GRANT)


@pytest.mark.asyncio
async def test_foreign_grant_names_do_not_confer_secret_resolve(log):
    token = await auth.sign_secret_token(user_id="u", grants=["something-else"])

    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)

    assert request.state.token_grants == ("something-else",)
    assert not auth.request_has_grant(request, auth.SECRET_RESOLVE_GRANT)


@pytest.mark.asyncio
async def test_grants_ride_expiry_unchanged(log):
    # The grant changes what the token may READ, never how long it lives.
    now = datetime.now(timezone.utc).timestamp()
    claims = _claims(
        await auth.sign_secret_token(user_id="u", grants=[auth.SECRET_RESOLVE_GRANT])
    )

    assert now + 15 * 60 - 5 < claims["exp"] < now + 15 * 60 + 5


@pytest.mark.asyncio
async def test_forged_grants_on_a_foreign_signed_token_are_rejected(log):
    expiry = datetime.now(timezone.utc) + timedelta(seconds=600)
    forged = encode(
        payload={
            "user_id": "u",
            "grants": [auth.SECRET_RESOLVE_GRANT],
            "exp": int(expiry.timestamp()),
        },
        key="some-other-key-entirely-not-ours!",
        algorithm="HS256",
    )

    # The concrete rejection, not any failure: a signature check that broke into an
    # AttributeError would otherwise still read as "rejected".
    with pytest.raises(UnauthorizedException) as rejected:
        await auth.verify_secret_token(request=_request(), secret_token=forged)

    assert rejected.value.status_code == 401
    assert rejected.value.detail["reason"] == "invalid_token"
