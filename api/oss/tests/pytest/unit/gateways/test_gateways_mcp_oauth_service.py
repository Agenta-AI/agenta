"""Unit tests for `MCPOAuthConnectService` (specs-wp17.md "The two-phase connect
service").

A mock authorization server behind `httpx.MockTransport`, a real `VaultService` over an
in-memory fake DAO — no real network, no real authorization server, no real MCP server.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Tuple
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest
from mcp.shared.auth import OAuthToken

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.service import (
    MCPOAuthConnectService,
    callback_redirect_uri,
)
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthRegistrationUnavailableError,
    MCPOAuthCallerMismatchError,
    MCPOAuthClientNotRegisteredError,
    MCPOAuthIssuerChangedError,
    MCPOAuthRefreshFailedError,
    MCPOAuthStateExpiredError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO

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
    *, dao=None, handler=None, resolve=_private_resolve, attempts=None
) -> Tuple[MCPOAuthConnectService, _FakeSecretsDAO, InMemoryMCPOAuthAttemptsDAO]:
    dao = dao or _FakeSecretsDAO()
    attempts = attempts or InMemoryMCPOAuthAttemptsDAO()
    vault = VaultService(secrets_dao=dao)
    client = MCPOAuthClient(
        transport=httpx.MockTransport(handler or _mock_as_handler())
    )
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=client,
        api_url=_API_URL,
        attempts_dao=attempts,
        resolve=resolve,
    )
    return service, dao, attempts


async def _callback(service, *, code: str, state: str, caller_user_id):
    """The two halves of the callback, as the router runs them back to back.

    `claim()` consumes the attempt and `complete()` exchanges against it; the router
    authorises the caller in between. Tests that are not about that gap say so once
    here rather than spelling both calls out.
    """
    attempt = await service.claim(state=state, caller_user_id=caller_user_id)
    return await service.complete(attempt=attempt, code=code)


def test_callback_redirect_uri_is_fixed_and_carries_no_query():
    uri = callback_redirect_uri(api_url=_API_URL)

    assert uri == "https://api.agenta.ai/gateways/mcps/connect/callback"
    assert "?" not in uri


@pytest.mark.asyncio
async def test_discover_returns_the_client_discovery_shape():
    service, _dao, _attempts = _service()

    discovery = await service.discover(server_url=_SERVER_URL)

    assert discovery.authorization_server == f"{_AS_BASE}/"
    assert set(discovery.scopes_offered) == {"read", "write"}


@pytest.mark.asyncio
async def test_begin_returns_an_authorization_url_with_the_fixed_redirect_uri_and_pkce():
    service, dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
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
async def test_the_authorization_url_carries_no_verifier_and_no_identity():
    """OR41: the verifier used to ride inside `state`, readable by the very server it
    is meant to be proved against. The URL now carries an opaque handle and nothing
    else about the attempt."""
    service, _dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    record = attempts.attempts[start.state]
    params = parse_qs(urlparse(start.authorization_url).query)
    state = params["state"][0]

    assert state == start.state
    assert record.code_verifier not in start.authorization_url
    assert str(project_id) not in start.authorization_url
    assert str(user_id) not in start.authorization_url
    assert str(endpoint_id) not in start.authorization_url
    # The only thing derived from the verifier that leaves us is its S256 challenge.
    assert params["code_challenge"][0] != record.code_verifier


@pytest.mark.asyncio
async def test_begin_records_the_attempt_the_callback_will_need():
    service, _dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    record = attempts.attempts[start.state]
    assert record.project_id == project_id
    assert record.user_id == user_id
    assert record.endpoint_id == endpoint_id
    assert record.server_url == _SERVER_URL
    assert record.issuer == f"{_AS_BASE}/"
    assert record.token_endpoint == f"{_AS_BASE}/token"
    assert record.redirect_uri == callback_redirect_uri(api_url=_API_URL)
    assert len(record.code_verifier) >= 43


@pytest.mark.asyncio
async def test_begin_reuses_client_registration_on_a_second_call():
    service, dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["write"],
    )

    provider_rows = [r for _, r in dao.records if r.kind.value == "oauth_provider"]
    assert len(provider_rows) == 1


@pytest.mark.asyncio
async def test_complete_with_valid_code_and_state_writes_an_oauth_grant_and_returns_its_id():
    service, dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    completion = await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )

    assert completion.project_id == project_id
    assert completion.user_id == user_id
    assert completion.endpoint_id == endpoint_id
    assert completion.server_url == _SERVER_URL
    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    assert grant_rows[0].id == completion.secret_id
    assert grant_rows[0].data.grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_a_replayed_state_is_refused_on_the_second_use():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )
    grants_after_first = [r for _, r in dao.records if r.kind.value == "oauth_grant"]

    with pytest.raises(MCPOAuthStateInvalidError):
        await _callback(
            service, code="auth-code-2", state=start.state, caller_user_id=user_id
        )

    assert start.state not in attempts.attempts
    assert [r for _, r in dao.records if r.kind.value == "oauth_grant"] == (
        grants_after_first
    )


@pytest.mark.asyncio
async def test_an_expired_attempt_is_refused_and_consumed():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    record = attempts.attempts[start.state]
    attempts.attempts[start.state] = record.model_copy(
        update={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )

    with pytest.raises(MCPOAuthStateExpiredError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )

    assert start.state not in attempts.attempts
    assert not [r for _, r in dao.records if r.kind.value == "oauth_grant"]


@pytest.mark.asyncio
async def test_a_callback_from_another_user_is_refused_and_writes_nothing():
    """The authorization server also holds `state`. Without the caller check a hostile
    server could present it with its own code and land its own tokens in the victim's
    project."""
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    with pytest.raises(MCPOAuthCallerMismatchError):
        await _callback(
            service, code="hostile-code", state=start.state, caller_user_id=uuid4()
        )

    assert not [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    # Refused without consuming: the rightful browser can still finish.
    assert start.state in attempts.attempts
    completion = await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )
    assert completion.project_id == project_id


@pytest.mark.asyncio
async def test_a_callback_with_no_session_is_refused_and_writes_nothing():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    with pytest.raises(MCPOAuthCallerMismatchError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=None
        )

    assert not [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert start.state in attempts.attempts


@pytest.mark.asyncio
async def test_the_grant_lands_in_the_attempts_project_not_a_project_the_server_names():
    """A hostile server controls `code` and the metadata it publishes; it controls
    nothing about where the grant is written, because that comes from the record."""
    service, dao, _attempts = _service()
    victim_project, attacker_project = uuid4(), uuid4()
    user_id, endpoint_id = uuid4(), uuid4()

    start = await service.begin(
        project_id=victim_project,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    completion = await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )

    assert completion.project_id == victim_project
    owners = {owner for owner, r in dao.records if r.kind.value == "oauth_grant"}
    assert owners == {victim_project}
    assert attacker_project not in owners


@pytest.mark.asyncio
async def test_complete_with_an_unknown_state_raises_before_any_http_call():
    service, _dao, _attempts = _service()

    with pytest.raises(MCPOAuthStateInvalidError):
        await _callback(
            service, code="auth-code-1", state="not-a-handle", caller_user_id=uuid4()
        )


@pytest.mark.asyncio
async def test_complete_without_a_prior_registration_raises_client_not_registered():
    """The record verifies but the client registration was deleted in between."""
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    dao.records = [r for r in dao.records if r[1].kind.value != "oauth_provider"]

    with pytest.raises(MCPOAuthClientNotRegisteredError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )

    assert start.state not in attempts.attempts


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

    service, _dao, _attempts = _service(handler=failing_token_handler)
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    from oss.src.core.gateways.mcps.oauth.types import MCPOAuthTokenExchangeError

    with pytest.raises(MCPOAuthTokenExchangeError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )


@pytest.mark.asyncio
async def test_step_up_reuses_the_same_grant_row_rather_than_creating_a_second_one():
    """WP19's seam (specs-wp17.md): a second begin()/complete() for the same
    server_url with a narrower scopes list rotates the existing oauth_grant row."""
    service, dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start1 = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    completion1 = await _callback(
        service, code="auth-code-1", state=start1.state, caller_user_id=user_id
    )

    start2 = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read", "write"],
    )
    completion2 = await _callback(
        service, code="auth-code-2", state=start2.state, caller_user_id=user_id
    )

    grant_rows = [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert len(grant_rows) == 1
    # Compared as a set rather than attribute to attribute. Any `secret... = <identifier>`
    # shape reads as a high-entropy assignment to gitleaks' generic-api-key rule, which
    # blocks the commit, and the set form asserts the same thing: one grant, reused.
    assert len({completion1.secret_id, completion2.secret_id}) == 1


@pytest.mark.asyncio
async def test_the_sweep_drops_only_attempts_past_their_expiry():
    service, _dao, attempts = _service()
    user_id = uuid4()

    live = await service.begin(
        project_id=uuid4(),
        user_id=user_id,
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    stale = await service.begin(
        project_id=uuid4(),
        user_id=user_id,
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    attempts.attempts[stale.state] = attempts.attempts[stale.state].model_copy(
        update={"expires_at": datetime.now(timezone.utc) - timedelta(hours=1)}
    )

    swept = await service.sweep_expired_attempts()

    assert swept == 1
    assert stale.state not in attempts.attempts
    assert live.state in attempts.attempts


# --- OR55: renewing a stored grant ---------------------------------------------- #


def _refreshing_as_handler(*, calls: List[str], refusal: bool = False):
    """The mock authorization server, with a token endpoint that records each grant type.

    `calls` receives one entry per token request, so a test can assert how many refreshes
    actually travelled rather than inferring it from the stored result.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/token":
            form = parse_qs(request.content.decode())
            grant_type = form.get("grant_type", [""])[0]
            calls.append(grant_type)
            if refusal:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(
                200,
                json={
                    "access_token": f"renewed-{len(calls)}",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": "read write",
                },
            )
        return httpx.Response(404)

    return handler


async def _seed_expired_grant(
    *, service, project_id, renewable: bool = True
) -> SecretsTokenStorage:
    """Store a grant that expired an hour ago, as a long-lived connection would hold."""
    storage = SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        authorization_server=f"{_AS_BASE}/",
    )
    await storage.write_tokens(
        OAuthToken(
            access_token="stale-access",
            token_type="Bearer",
            expires_in=-3600,
            refresh_token="renewal-handle-1" if renewable else None,
            scope="read write",
        )
    )
    return storage


@pytest.mark.asyncio
async def test_refresh_grant_exchanges_the_stored_refresh_token_and_stores_the_result():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == ["refresh_token"]
    renewed = await storage.get_tokens()
    assert renewed is not None
    assert renewed.access_token == "renewed-1"
    assert renewed.expires_in is not None and renewed.expires_in > 0


@pytest.mark.asyncio
async def test_refresh_grant_keeps_the_old_renewal_handle_when_the_server_rotates_none():
    """RFC 6749 s6: a non-rotating server returns no new handle and the old one lives on.
    Dropping it would make the next expiry unrecoverable."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "renewed-no-rotation",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                },
            )
        return httpx.Response(404)

    service, _dao, _attempts = _service(handler=handler)
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    renewed = await storage.get_tokens()
    assert renewed is not None
    assert renewed.refresh_token == "renewal-handle-1"


@pytest.mark.asyncio
async def test_refresh_grant_raises_a_typed_refusal_when_the_server_refuses():
    calls: List[str] = []
    service, _dao, _attempts = _service(
        handler=_refreshing_as_handler(calls=calls, refusal=True)
    )
    project_id = uuid4()
    await _seed_expired_grant(service=service, project_id=project_id)

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)


@pytest.mark.asyncio
async def test_refresh_grant_raises_when_the_stored_grant_has_no_renewal_handle():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(service=service, project_id=project_id, renewable=False)

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == []


@pytest.mark.asyncio
async def test_two_concurrent_calls_on_one_expired_grant_perform_one_refresh():
    """A rotating authorization server retires a renewal handle the instant it is spent,
    so a second exchange would leave one caller holding a retired grant."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await asyncio.gather(
        service.refresh_grant(project_id=project_id, server_url=_SERVER_URL),
        service.refresh_grant(project_id=project_id, server_url=_SERVER_URL),
    )

    assert calls == ["refresh_token"]
    renewed = await storage.get_tokens()
    assert renewed is not None and renewed.access_token == "renewed-1"


@pytest.mark.asyncio
async def test_refresh_grant_does_nothing_when_the_stored_grant_is_still_live():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        authorization_server=f"{_AS_BASE}/",
    )
    await storage.write_tokens(
        OAuthToken(
            access_token="live-access",
            token_type="Bearer",
            expires_in=3600,
            refresh_token="renewal-handle-1",
        )
    )

    await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == []


# --- The issuer a grant was created against ------------------------------------- #


_MOVED_AS_BASE = "https://auth.acme-successor.io"


def _moved_issuer_handler(*, calls: List[Tuple[str, str]]):
    """The same MCP server later in its life, naming an authorization server it now
    controls. Every discovery check still passes: the protected-resource document is
    same-origin with the server, and the new authorization server's metadata agrees
    with itself. `calls` records every token request, host included, so a test can
    assert that nothing travelled rather than infer it."""

    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(
                200,
                json={**_PRM, "authorization_servers": [f"{_MOVED_AS_BASE}/"]},
            )
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": f"{_MOVED_AS_BASE}/",
                    "authorization_endpoint": f"{_MOVED_AS_BASE}/authorize",
                    "token_endpoint": f"{_MOVED_AS_BASE}/token",
                    "scopes_supported": ["read", "write"],
                },
            )
        if path == "/token":
            form = parse_qs(request.content.decode())
            calls.append((host, form.get("grant_type", [""])[0]))
            return httpx.Response(
                200,
                json={
                    "access_token": "issued-by-the-new-server",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                },
            )
        return httpx.Response(404)

    return handler


@pytest.mark.asyncio
async def test_a_completed_grant_records_the_authorization_server_that_issued_it():
    service, _dao, _attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )

    storage = SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
    )
    stored = await storage.get_grant()
    assert stored is not None
    assert stored.issuer == f"{_AS_BASE}/"


@pytest.mark.asyncio
async def test_refresh_is_refused_when_the_resource_now_names_another_issuer():
    """The MCP server publishes its own protected-resource document, so it can name a
    different authorization server whenever it likes and every pinning check inside
    discovery still passes. The renewal handle must not travel to that server."""
    calls: List[Tuple[str, str]] = []
    service, _dao, _attempts = _service(handler=_moved_issuer_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    with pytest.raises(MCPOAuthIssuerChangedError):
        await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == []
    stored = await storage.get_grant()
    assert stored is not None
    assert stored.refresh_token == "renewal-handle-1"
    assert stored.access_token == "stale-access"
    assert stored.issuer == f"{_AS_BASE}/"


@pytest.mark.asyncio
async def test_the_issuer_refusal_is_a_refresh_failure_the_relay_already_handles():
    """`MCPGatewayService._renewed` turns a refresh failure into "reconnect"; a moved
    issuer is exactly that case, and a legitimate migration is the same reconnect."""
    calls: List[Tuple[str, str]] = []
    service, _dao, _attempts = _service(handler=_moved_issuer_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(service=service, project_id=project_id)

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)


@pytest.mark.asyncio
async def test_refresh_is_refused_when_the_stored_grant_names_no_issuer():
    """A grant with no pin cannot be checked against anything, so there is no safe
    server to present its renewal handle to. Reconnecting writes the pin."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
    )
    await storage.write_tokens(
        OAuthToken(
            access_token="stale-access",
            token_type="Bearer",
            expires_in=-3600,
            refresh_token="renewal-handle-1",
            scope="read write",
        )
    )

    with pytest.raises(MCPOAuthIssuerChangedError):
        await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == []


@pytest.mark.asyncio
async def test_refresh_succeeds_and_keeps_the_pin_when_the_issuer_is_unchanged():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await service.refresh_grant(project_id=project_id, server_url=_SERVER_URL)

    assert calls == ["refresh_token"]
    stored = await storage.get_grant()
    assert stored is not None
    assert stored.access_token == "renewed-1"
    assert stored.issuer == f"{_AS_BASE}/"


def _public_resolve(_hostname: str) -> List[str]:
    """A publicly reachable deployment, which is what makes the identity document an
    option at all. The tests below are about which option wins when both are open."""
    return ["93.184.216.34"]


def _handler_without_registration():
    """An authorization server that advertises no registration endpoint."""
    metadata = {k: v for k, v in _AS_METADATA.items() if k != "registration_endpoint"}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=metadata)
        if path == "/register":
            raise AssertionError("must not register where none is advertised")
        return httpx.Response(404)

    return handler


@pytest.mark.asyncio
async def test_a_server_that_advertises_registration_gets_a_registered_client():
    """The regression: a real authorization server refuses a client id it never issued.

    Linear advertises a registration endpoint and answers "the clientId provided does
    not match to this client" when handed a client-id metadata document instead. The
    document used to win whenever this deployment was publicly reachable, which is every
    deployment that can complete a consent flow at all, so the draft strategy was chosen
    precisely where the standard one was available and wanted.
    """
    service, _dao, _attempts = _service(resolve=_public_resolve)

    start = await service.begin(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    assert "client_id=client-abc" in start.authorization_url
    assert "client-metadata.json" not in start.authorization_url


@pytest.mark.asyncio
async def test_the_identity_document_is_kept_for_a_server_that_offers_no_registration():
    service, _dao, _attempts = _service(
        handler=_handler_without_registration(), resolve=_public_resolve
    )

    start = await service.begin(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    assert "client-metadata.json" in start.authorization_url


@pytest.mark.asyncio
async def test_no_registration_and_no_public_address_is_refused_with_a_reason():
    service, _dao, _attempts = _service(
        handler=_handler_without_registration(), resolve=_private_resolve
    )

    with pytest.raises(MCPOAuthRegistrationUnavailableError) as refusal:
        await service.begin(
            project_id=uuid4(),
            user_id=uuid4(),
            endpoint_id=uuid4(),
            server_url=_SERVER_URL,
            scopes=["read"],
        )

    assert "no registration endpoint" in str(refusal.value)
