"""Unit tests for OAuth registration fallback.

Same mock-authorization-server-behind-`httpx.MockTransport` pattern as
`test_gateways_mcp_oauth_service.py`, with the resolver also injected — no DNS, no
network, no real authorization server.
"""

from typing import List, Tuple
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.registration import client_metadata_url
from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
from oss.src.core.gateways.mcps.oauth.state import decode_state
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


def _mock_as_handler(*, register_called: list):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/register":
            register_called.append(True)
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
                    "access_token": "tok-xyz",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "read write",
                },
            )
        return httpx.Response(404)

    return handler


def _service(
    *, resolve, register_called=None
) -> Tuple[MCPOAuthConnectService, _FakeSecretsDAO]:
    register_called = register_called if register_called is not None else []
    dao = _FakeSecretsDAO()
    vault = VaultService(secrets_dao=dao)
    client = MCPOAuthClient(
        transport=httpx.MockTransport(_mock_as_handler(register_called=register_called))
    )
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=client,
        api_url=_API_URL,
        secret_key=_SECRET_KEY,
        resolve=resolve,
    )
    return service, dao


@pytest.mark.asyncio
async def test_begin_prefers_the_identity_document_when_publicly_resolvable():
    register_called: list = []
    service, dao = _service(
        resolve=lambda _h: ["1.1.1.1"], register_called=register_called
    )
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"][0] == client_metadata_url(api_url=_API_URL)
    assert register_called == []
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]

    payload = decode_state(start.state, secret_key=_SECRET_KEY)
    assert payload is not None
    assert payload["strategy"] == "document"


@pytest.mark.asyncio
async def test_begin_falls_back_to_outbound_registration_when_not_publicly_resolvable():
    register_called: list = []
    service, dao = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called
    )
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"][0] == "client-abc"
    assert register_called == [True]
    assert [r for _, r in dao.records if r.kind.value == "oauth_provider"]

    payload = decode_state(start.state, secret_key=_SECRET_KEY)
    assert payload is not None
    assert payload["strategy"] == "outbound"


@pytest.mark.asyncio
async def test_complete_via_the_identity_document_needs_no_stored_client_info():
    service, dao = _service(resolve=lambda _h: ["1.1.1.1"])
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    completion = await service.complete(code="auth-code-1", state=start.state)

    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    assert grant_rows[0].id == completion.secret_id
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]


@pytest.mark.asyncio
async def test_a_second_connect_reprobes_and_keeps_using_the_document_when_still_resolvable():
    service, dao = _service(resolve=lambda _h: ["1.1.1.1"])
    project_id, user_id = uuid4(), uuid4()

    await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    start2 = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["write"]
    )

    params = parse_qs(urlparse(start2.authorization_url).query)
    assert params["client_id"][0] == client_metadata_url(api_url=_API_URL)
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]


@pytest.mark.asyncio
async def test_wrong_direction_2_split_horizon_still_completes_a_full_authorization():
    """specs-wp20.md "Wrong in each direction, direction 2": a hostname the detector
    misreads as internal (a private-looking resolver answer for a domain that is
    really public) simply takes WP17's always-safe outbound path. The flow still
    completes end to end — this is the harmless direction."""
    register_called: list = []
    service, dao = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called
    )
    project_id, user_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id, user_id=user_id, server_url=_SERVER_URL, scopes=["read"]
    )
    completion = await service.complete(code="auth-code-1", state=start.state)

    assert register_called == [True]
    assert completion.secret_id is not None
    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert grant_rows[0].data.grant.access_token == "tok-xyz"
