"""SSRF guard on OrganizationProvidersService.test_oidc_connection's issuer_url."""

import pytest

from ee.src.core.organizations.service import OrganizationProvidersService


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {
            "authorization_endpoint": "https://idp.example/auth",
            "token_endpoint": "https://idp.example/token",
            "userinfo_endpoint": "https://idp.example/userinfo",
        }

    def json(self):
        return self._payload


class _FakeAsyncClient:
    calls = []

    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, url, **kwargs):
        _FakeAsyncClient.calls.append((url, kwargs))
        return _FakeResponse()


@pytest.fixture(autouse=True)
def _reset_calls():
    _FakeAsyncClient.calls = []
    yield
    _FakeAsyncClient.calls = []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "issuer_url",
    [
        "http://169.254.169.254",
        "https://127.0.0.1",
        "https://10.0.0.5",
        "https://localhost",
        "https://192.168.1.1",
    ],
)
async def test_oidc_connection_blocks_internal_issuer_url(issuer_url, monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.organizations.service.httpx.AsyncClient", _FakeAsyncClient
    )

    result = await OrganizationProvidersService.test_oidc_connection(
        issuer_url=issuer_url,
        client_id="client",
        client_secret="secret",
    )

    assert result is False
    # Fails closed before any request is attempted against the blocked target.
    assert _FakeAsyncClient.calls == []


@pytest.mark.asyncio
async def test_oidc_connection_allows_public_issuer_url(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.organizations.service.httpx.AsyncClient", _FakeAsyncClient
    )
    monkeypatch.setattr(
        "ee.src.core.organizations.service.resolve_validated_webhook_ip",
        lambda url: "93.184.216.34",
    )

    result = await OrganizationProvidersService.test_oidc_connection(
        issuer_url="https://idp.example",
        client_id="client",
        client_secret="secret",
    )

    assert result is True
    assert len(_FakeAsyncClient.calls) == 1
    called_url, kwargs = _FakeAsyncClient.calls[0]
    assert "93.184.216.34" in called_url
    assert kwargs["headers"]["Host"] == "idp.example"


@pytest.mark.asyncio
async def test_oidc_connection_defaults_secure_with_no_env_var(monkeypatch):
    # _WEBHOOK_ALLOW_INSECURE is a module-level constant read at import time; assert the
    # constant itself is False (secure by default), not env-var presence at test time.
    from oss.src.core.webhooks import utils as webhook_utils

    assert webhook_utils._WEBHOOK_ALLOW_INSECURE is False

    monkeypatch.setattr(
        "ee.src.core.organizations.service.httpx.AsyncClient", _FakeAsyncClient
    )

    result = await OrganizationProvidersService.test_oidc_connection(
        issuer_url="https://10.0.0.9",
        client_id="client",
        client_secret="secret",
    )

    assert result is False
    assert _FakeAsyncClient.calls == []
