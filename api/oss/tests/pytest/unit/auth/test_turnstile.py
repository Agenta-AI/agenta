import httpx
import pytest

from oss.src.core.auth import turnstile
from oss.src.core.auth.turnstile import (
    TURNSTILE_FAILURE_MESSAGE,
    TURNSTILE_TOKEN_HEADER,
    verify_turnstile_or_raise,
)
from oss.src.utils.env import env
from oss.src.utils.exceptions import UnauthorizedException


class _Request:
    def __init__(self, headers: dict[str, str]):
        self._headers = {key.lower(): value for key, value in headers.items()}

    def get_header(self, key: str):
        return self._headers.get(key.lower())


@pytest.fixture(autouse=True)
def _turnstile_enabled(monkeypatch):
    monkeypatch.setattr(turnstile, "is_ee", lambda: True)
    monkeypatch.setattr(env.cloudflare.turnstile, "site_key", "site")
    monkeypatch.setattr(env.cloudflare.turnstile, "secret_key", "secret")
    monkeypatch.setattr(
        env.cloudflare.turnstile, "allowed_hostnames_raw", "cloud.agenta.ai"
    )


def _mock_siteverify(monkeypatch, *, json_body=None, status_code=200):
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == turnstile.TURNSTILE_VERIFY_URL
        return httpx.Response(status_code, json=json_body or {})

    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(turnstile.httpx, "AsyncClient", client_factory)


@pytest.mark.asyncio
async def test_missing_token_raises_401():
    with pytest.raises(UnauthorizedException) as exc_info:
        await verify_turnstile_or_raise(request=_Request({}), auth_flow="signin")

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == {"message": "Please complete the security check."}


@pytest.mark.asyncio
async def test_rejected_token_raises_401(monkeypatch):
    _mock_siteverify(
        monkeypatch,
        json_body={"success": False, "error-codes": ["timeout-or-duplicate"]},
    )

    with pytest.raises(UnauthorizedException) as exc_info:
        await verify_turnstile_or_raise(
            request=_Request({TURNSTILE_TOKEN_HEADER: "token"}), auth_flow="signin"
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == {"message": TURNSTILE_FAILURE_MESSAGE}


@pytest.mark.asyncio
async def test_wrong_hostname_raises_401(monkeypatch):
    _mock_siteverify(
        monkeypatch, json_body={"success": True, "hostname": "evil.example.com"}
    )

    with pytest.raises(UnauthorizedException) as exc_info:
        await verify_turnstile_or_raise(
            request=_Request({TURNSTILE_TOKEN_HEADER: "token"}), auth_flow="signin"
        )

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_siteverify_unreachable_raises_401(monkeypatch):
    _mock_siteverify(monkeypatch, status_code=503)

    with pytest.raises(UnauthorizedException) as exc_info:
        await verify_turnstile_or_raise(
            request=_Request({TURNSTILE_TOKEN_HEADER: "token"}), auth_flow="signin"
        )

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_accepted_token_passes(monkeypatch):
    _mock_siteverify(
        monkeypatch, json_body={"success": True, "hostname": "cloud.agenta.ai"}
    )

    await verify_turnstile_or_raise(
        request=_Request({TURNSTILE_TOKEN_HEADER: "token"}), auth_flow="signin"
    )
