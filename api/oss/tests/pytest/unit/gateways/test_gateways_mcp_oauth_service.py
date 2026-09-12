"""Unit tests for `MCPOAuthConnectService` (specs-wp17.md "The two-phase connect
service").

A mock authorization server behind `httpx.MockTransport`, a real `VaultService` over an
in-memory fake DAO — no real network, no real authorization server, no real MCP server.
"""

from __future__ import annotations

from typing import List, Tuple
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.service import (
    MCPOAuthConnectService,
    callback_redirect_uri,
)
from oss.src.core.gateways.mcps.oauth.state import decode_state
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthClientNotRegisteredError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService

_SECRET_KEY = "unit-test-crypt-key"
_API_URL = "https://api.agenta.ai"
_SERVER_URL = "https://mcp.acme.io/"
_AS_BASE = "https://auth.acme.io"

_PRM = {
    "resource": _SERVER_URL,
    "authorization_servers": [f"{_AS_BASE}/"],
    "scopes_supported": ["read", "write"],
}
_AS_METADATA = {
    "issuer": f"{_AS_BASE}/",
    "authorization_endpoint": f"{_AS_BASE}/authorize",
    "token_endpoint": f"{_AS_BASE}/token",
    "registration_endpoint": f"{_AS_BASE}/register",
    "scopes_supported": ["read", "write"],
}


class _FakeSecretsDAO:
    def __init__(self) -> None:
        self.records: List[Tuple[UUID, SecretResponseDTO]] = []

    def _scoped(self, project_id) -> List[SecretResponseDTO]:
        return [r for p, r in self.records if p == project_id]

    async def create(self, *, project_id=None, organization_id=None, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )
        self.records.append((project_id, record))
        return record

    async def get_by_id(self, secret_id, project_id=None, organization_id=None):
        return next((r for r in self._scoped(project_id) if r.id == secret_id), None)

    async def get_by_slug(self, secret_slug, project_id=None, organization_id=None):
        return next(
            (r for r in self._scoped(project_id) if r.slug == secret_slug), None
        )

    async def list(self, project_id=None, organization_id=None):
        return self._scoped(project_id)

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id=None,
        organization_id=None,
        user_id=None,
        resolve_update=None,
    ):
        scoped = self._scoped(project_id)
        stored = next((r for r in scoped if r.id == secret_id), None)
        if stored is None:
            return None
        record = SecretResponseDTO(
            id=stored.id,
            slug=stored.slug,
            kind=stored.kind,
            data=update_secret_dto.secret.data.model_dump(exclude_none=True),
            header=update_secret_dto.header or stored.header,
        )
        idx = self.records.index((project_id, stored))
        self.records[idx] = (project_id, record)
        return record

    async def delete(self, secret_id, project_id=None, organization_id=None):
        self.records = [
            (p, r)
            for p, r in self.records
            if not (p == project_id and r.id == secret_id)
        ]


def _mock_as_handler(*, token_access_token="tok-xyz"):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/register":
            import json as _json

            return httpx.Response(
                201,
                json={
                    **_json.loads(request.content),
                    "client_id": "client-abc",
                    "client_secret": "secret-abc",
                },
            )
        if path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": token_access_token,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "read write",
                },
            )
        return httpx.Response(404)

    return handler


def _private_resolve(_hostname: str) -> List[str]:
    """WP17's own tests predate the identity-document strategy (specs-wp20.md) and
    assert the outbound path throughout — pin detection to "internal" so none of them
    starts resolving `_API_URL` over real DNS."""
    return ["10.0.0.5"]


def _service(
    *, dao=None, handler=None, resolve=_private_resolve
) -> Tuple[MCPOAuthConnectService, _FakeSecretsDAO]:
    dao = dao or _FakeSecretsDAO()
    vault = VaultService(secrets_dao=dao)
    client = MCPOAuthClient(
        transport=httpx.MockTransport(handler or _mock_as_handler())
    )
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=client,
        api_url=_API_URL,
        secret_key=_SECRET_KEY,
        resolve=resolve,
    )
    return service, dao


def test_callback_redirect_uri_is_fixed_and_carries_no_query():
    uri = callback_redirect_uri(api_url=_API_URL)

    assert uri == "https://api.agenta.ai/gateways/mcps/connect/callback"
    assert "?" not in uri


@pytest.mark.asyncio
async def test_discover_returns_the_client_discovery_shape():
    service, _dao = _service()

    discovery = await service.discover(server_url=_SERVER_URL)

    assert discovery.authorization_server == f"{_AS_BASE}/"
    assert set(discovery.scopes_offered) == {"read", "write"}


@pytest.mark.asyncio
async def test_begin_returns_an_authorization_url_with_the_fixed_redirect_uri_and_pkce():
    service, dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )

    parsed = urlparse(start.authorization_url)
    params = parse_qs(parsed.query)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == f"{_AS_BASE}/authorize"
    assert params["redirect_uri"][0] == callback_redirect_uri(api_url=_API_URL)
    assert params["client_id"][0] == "client-abc"
    assert params["code_challenge_method"][0] == "S256"
    assert "code_challenge" in params
    assert params["scope"][0] == "read"

    # Client registration was written — proves get-or-create ran, not a bare pass-through.
    assert any(r.slug and "oauth-provider" in r.slug for _, r in dao.records)


@pytest.mark.asyncio
async def test_begin_state_decodes_to_the_right_identity_and_verifier():
    service, _dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    payload = decode_state(start.state, secret_key=_SECRET_KEY)

    assert payload is not None
    assert payload["project_id"] == str(project_id)
    assert payload["user_id"] == str(user_id)
    assert payload["server_url"] == _SERVER_URL
    assert len(payload["code_verifier"]) >= 43


@pytest.mark.asyncio
async def test_begin_reuses_client_registration_on_a_second_call():
    service, dao = _service()
    project_id, user_id = uuid4(), uuid4()

    await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["write"]
    )

    provider_rows = [r for _, r in dao.records if r.kind.value == "oauth_provider"]
    assert len(provider_rows) == 1


@pytest.mark.asyncio
async def test_complete_with_valid_code_and_state_writes_an_oauth_grant_and_returns_its_id():
    service, dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    completion = await service.complete(code="auth-code-1", state=start.state)

    assert completion.project_id == project_id
    assert completion.server_url == _SERVER_URL
    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    assert grant_rows[0].id == completion.secret_id
    assert grant_rows[0].data.grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_complete_with_tampered_state_raises_before_any_http_call():
    service, _dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    tampered = start.state[:-1] + ("0" if start.state[-1] != "0" else "1")

    with pytest.raises(MCPOAuthStateInvalidError):
        await service.complete(code="auth-code-1", state=tampered)


@pytest.mark.asyncio
async def test_complete_with_expired_state_raises():
    service, _dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    payload = decode_state(start.state, secret_key=_SECRET_KEY)
    assert payload is not None
    payload["ts"] = 0  # decades ago
    import base64
    import hashlib
    import hmac
    import json

    payload_b64 = (
        base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True).encode())
        .decode()
        .rstrip("=")
    )
    sig = hmac.new(
        _SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    expired_state = f"{payload_b64}.{sig}"

    with pytest.raises(MCPOAuthStateInvalidError):
        await service.complete(code="auth-code-1", state=expired_state)


@pytest.mark.asyncio
async def test_complete_without_a_prior_registration_raises_client_not_registered():
    service, _dao = _service()
    from oss.src.core.gateways.mcps.oauth.state import make_state

    state = make_state(
        project_id=uuid4(),
        user_id=uuid4(),
        server_url=_SERVER_URL,
        code_verifier="a" * 43,
        scopes=["read"],
        secret_key=_SECRET_KEY,
    )

    with pytest.raises(MCPOAuthClientNotRegisteredError):
        await service.complete(code="auth-code-1", state=state)


@pytest.mark.asyncio
async def test_complete_with_token_endpoint_error_raises_typed_exception():
    def failing_token_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if request.url.path == "/register":
            import json as _json

            return httpx.Response(
                201,
                json={
                    **_json.loads(request.content),
                    "client_id": "client-abc",
                    "client_secret": "secret-abc",
                },
            )
        if request.url.path == "/token":
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(404)

    service, _dao = _service(handler=failing_token_handler)
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )

    from oss.src.core.gateways.mcps.oauth.types import MCPOAuthTokenExchangeError

    with pytest.raises(MCPOAuthTokenExchangeError):
        await service.complete(code="auth-code-1", state=start.state)


@pytest.mark.asyncio
async def test_step_up_reuses_the_same_grant_row_rather_than_creating_a_second_one():
    """WP19's seam (specs-wp17.md): a second begin()/complete() for the same
    server_url with a narrower scopes list rotates the existing oauth_grant row."""
    service, dao = _service()
    project_id, user_id = uuid4(), uuid4()

    start1 = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    completion1 = await service.complete(code="auth-code-1", state=start1.state)

    start2 = await service.begin(
        project_id=project_id,
        user_id=user_id,
        server_url=_SERVER_URL,
        scopes=["read", "write"],
    )
    completion2 = await service.complete(code="auth-code-2", state=start2.state)

    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    first_id = completion1.secret_id
    second_id = completion2.secret_id
    assert first_id == second_id
