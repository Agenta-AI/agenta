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
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService

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


def _mock_as_handler(*, register_called: list, advertise_registration: bool = True):
    """A mock authorization server, optionally one that accepts no registrations.

    `advertise_registration=False` drops `registration_endpoint` from the metadata,
    which is the only condition under which naming ourselves with a client-id metadata
    document is correct. `/register` stays wired up either way so that a test can prove
    nothing reached it.
    """
    metadata = (
        _AS_METADATA
        if advertise_registration
        else {k: v for k, v in _AS_METADATA.items() if k != "registration_endpoint"}
    )

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=metadata)
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
    *, resolve, register_called=None, advertise_registration: bool = True
) -> Tuple[MCPOAuthConnectService, _FakeSecretsDAO, InMemoryMCPOAuthAttemptsDAO]:
    register_called = register_called if register_called is not None else []
    dao = _FakeSecretsDAO()
    attempts = InMemoryMCPOAuthAttemptsDAO()
    vault = VaultService(secrets_dao=dao)
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            _mock_as_handler(
                register_called=register_called,
                advertise_registration=advertise_registration,
            )
        )
    )
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=client,
        api_url=_API_URL,
        attempts_dao=attempts,
        resolve=resolve,
    )
    return service, dao, attempts


@pytest.mark.asyncio
async def test_begin_uses_the_identity_document_when_no_registration_is_advertised():
    """Being publicly resolvable is what makes the document *possible*; an authorization
    server that advertises no registration endpoint is what makes it *necessary*.

    Both conditions have to hold. Where registration is advertised the standard path
    wins, because a client-id metadata document is a draft almost nothing implements and
    a real server refuses a client id it never issued.
    """
    register_called: list = []
    service, dao, attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        register_called=register_called,
        advertise_registration=False,
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"][0] == client_metadata_url(api_url=_API_URL)
    assert register_called == []
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]

    assert attempts.attempts[start.state].strategy == "document"


@pytest.mark.asyncio
async def test_begin_registers_outbound_when_the_server_advertises_a_registration_endpoint():
    register_called: list = []
    service, dao, attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"][0] == "client-abc"
    assert register_called == [True]
    assert [r for _, r in dao.records if r.kind.value == "oauth_provider"]

    assert attempts.attempts[start.state].strategy == "outbound"


@pytest.mark.asyncio
async def test_complete_needs_no_stored_client_info_when_no_registration_is_advertised():
    """The document path stores no client registration at all, so the callback has to
    rebuild the client information deterministically rather than read it back. The whole
    flow therefore completes with an `oauth_grant` row and no `oauth_provider` row."""
    service, dao, _attempts = _service(
        resolve=lambda _h: ["1.1.1.1"], advertise_registration=False
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    completion = await service.complete(attempt=attempt, code="auth-code-1")

    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    assert grant_rows[0].id == completion.secret_id
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]


@pytest.mark.asyncio
async def test_a_second_connect_keeps_the_document_while_no_registration_is_advertised():
    """Nothing about the document path is cached, so every connect re-decides from
    scratch: it re-reads the server's metadata and re-probes this deployment's address.
    With registration still unadvertised and the address still public, the second
    connect reaches the same answer and still writes no `oauth_provider` row."""
    register_called: list = []
    service, dao, _attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        register_called=register_called,
        advertise_registration=False,
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    start2 = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["write"],
    )

    params = parse_qs(urlparse(start2.authorization_url).query)
    assert params["client_id"][0] == client_metadata_url(api_url=_API_URL)
    assert register_called == []
    assert not [r for _, r in dao.records if r.kind.value == "oauth_provider"]


@pytest.mark.asyncio
async def test_wrong_direction_2_split_horizon_still_completes_a_full_authorization():
    """specs-wp20.md "Wrong in each direction, direction 2": a hostname the detector
    misreads as internal (a private-looking resolver answer for a domain that is
    really public) simply takes WP17's always-safe outbound path. The flow still
    completes end to end — this is the harmless direction."""
    register_called: list = []
    service, dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    completion = await service.complete(attempt=attempt, code="auth-code-1")

    assert register_called == [True]
    assert completion.secret_id is not None
    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert grant_rows[0].data.grant.access_token == "tok-xyz"
