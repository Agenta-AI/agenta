"""Unit tests for `MCPOAuthConnectService` (specs-wp17.md "The two-phase connect
service").

A mock authorization server behind `httpx.MockTransport`, a real `VaultService` over an
in-memory fake DAO — no real network, no real authorization server, no real MCP server.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest
from mcp.shared.auth import OAuthToken

from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthAttemptStatus
from oss.src.core.gateways.mcps.oauth.service import (
    MCPOAuthConnectService,
    callback_redirect_uri,
)
from oss.src.core.gateways.mcps.oauth.storage import (
    SecretsTokenStorage,
    grant_refresh_due,
)
from oss.src.core.gateways.mcps.oauth.state import STATE_TTL_SECONDS
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthAttemptCancelledError,
    MCPOAuthBindFailedError,
    MCPOAuthTokenExchangeError,
    MCPOAuthRegistrationUnavailableError,
    MCPOAuthCallerMismatchError,
    MCPOAuthClientNotRegisteredError,
    MCPOAuthIssuerChangedError,
    MCPOAuthNoRefreshTokenError,
    MCPOAuthRefreshFailedError,
    MCPOAuthRefreshUnavailableError,
    MCPOAuthStateExpiredError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.secrets.dtos import OAuthGrantSettingsDTO, SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.tests.pytest.utils.mcp_endpoints import InMemoryMCPEndpoints
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO
from oss.tests.pytest.utils.organization_secrets import (
    load_effective_from_list,
    owner_scope,
)

_API_URL = "https://api.agenta.ai"
_SERVER_URL = "https://mcp.acme.io/"
# A grant belongs to one connection, so every storage and every refresh in this module
# speaks for the same one unless a test deliberately introduces a second.
_ENDPOINT_ID = uuid4()
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
    load_effective = load_effective_from_list

    def __init__(self) -> None:
        self.records: List[Tuple[UUID, SecretResponseDTO]] = []

    def _scoped(self, project_id) -> List[SecretResponseDTO]:
        return [r for p, r in self.records if p == project_id]

    async def create(
        self,
        *,
        owner,
        create_secret_dto,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )
        self.records.append((project_id, record))
        return record

    async def get_by_id(
        self,
        *,
        owner,
        secret_id,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
        return next((r for r in self._scoped(project_id) if r.id == secret_id), None)

    async def get_by_slug(
        self,
        *,
        owner,
        secret_slug,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
        return next(
            (r for r in self._scoped(project_id) if r.slug == secret_slug), None
        )

    async def list(
        self,
        *,
        owner,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
        return self._scoped(project_id)

    async def update(
        self,
        *,
        owner,
        secret_id,
        update_secret_dto,
        user_id=None,
        resolve_update=None,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
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

    async def delete(
        self,
        *,
        owner,
        secret_id,
        authorize_delete=None,
        **_kwargs,
    ):
        project_id, organization_id = owner_scope(owner)
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
        endpoints_dao=InMemoryMCPEndpoints(attempts=attempts),
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


def _spent(attempts: InMemoryMCPOAuthAttemptsDAO, state: str) -> bool:
    """The handle can never be claimed again, and its verifier is gone."""
    record = attempts.attempts[state]
    return record.status != MCPOAuthAttemptStatus.PENDING and not record.code_verifier


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

    assert _spent(attempts, start.state)
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

    assert _spent(attempts, start.state)
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
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.PENDING
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
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.PENDING


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

    assert _spent(attempts, start.state)


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


# --- The attempt lifecycle the sheet sees ------------------------------------- #


async def _begin(service, *, project_id, user_id, endpoint_id):
    return await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )


@pytest.mark.asyncio
async def test_begin_names_the_attempt_and_the_one_ttl_the_browser_waits_for():
    service, _dao, attempts = _service()

    start = await _begin(
        service, project_id=uuid4(), user_id=uuid4(), endpoint_id=uuid4()
    )

    assert start.attempt_id == attempts.attempts[start.state].id
    assert start.expires_in == STATE_TTL_SECONDS


@pytest.mark.asyncio
async def test_a_cancelled_attempt_writes_nothing_when_its_callback_arrives():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    cancelled = await service.cancel(
        project_id=project_id, endpoint_id=endpoint_id, attempt_id=start.attempt_id
    )

    assert cancelled == 1
    with pytest.raises(MCPOAuthAttemptCancelledError, match="sign-in was cancelled"):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )
    assert not [r for _, r in dao.records if r.kind.value == "oauth_grant"]
    assert not attempts.attempts[start.state].code_verifier


@pytest.mark.asyncio
async def test_an_expired_attempt_reads_as_cancelled():
    service, _dao, attempts = _service()
    user_id = uuid4()
    start = await _begin(
        service, project_id=uuid4(), user_id=user_id, endpoint_id=uuid4()
    )
    attempts.attempts[start.state] = attempts.attempts[start.state].model_copy(
        update={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )

    with pytest.raises(MCPOAuthAttemptCancelledError, match="sign-in was cancelled"):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.CANCELLED


@pytest.mark.asyncio
async def test_cancelling_a_connection_leaves_its_neighbour_and_settled_attempts():
    service, _dao, attempts = _service()
    project_id, user_id = uuid4(), uuid4()
    endpoint_id, neighbour_id = uuid4(), uuid4()
    settled = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    await _callback(
        service, code="auth-code-1", state=settled.state, caller_user_id=user_id
    )
    pending = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    neighbour = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=neighbour_id
    )

    cancelled = await service.cancel(project_id=project_id, endpoint_id=endpoint_id)

    assert cancelled == 1
    assert attempts.attempts[pending.state].status == MCPOAuthAttemptStatus.CANCELLED
    assert attempts.attempts[settled.state].status == MCPOAuthAttemptStatus.CONNECTED
    assert attempts.attempts[neighbour.state].status == MCPOAuthAttemptStatus.PENDING


@pytest.mark.asyncio
async def test_disconnect_cancels_a_consent_still_in_flight():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    await service.disconnect(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
    )

    with pytest.raises(MCPOAuthAttemptCancelledError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )
    assert not [r for _, r in dao.records if r.kind.value == "oauth_grant"]


@pytest.mark.asyncio
async def test_the_outcome_tells_the_browser_whether_to_keep_waiting_and_how_it_ended():
    service, _dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    async def outcome():
        return await service.outcome(
            project_id=project_id,
            endpoint_id=endpoint_id,
            attempt_id=start.attempt_id,
        )

    assert (await outcome()).status == MCPOAuthAttemptStatus.PENDING

    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    # Claimed is the exchange in progress, which the browser waits through.
    assert (await outcome()).status == MCPOAuthAttemptStatus.PENDING

    await service.settle(
        attempt=attempt, status=MCPOAuthAttemptStatus.FAILED, error="User declined"
    )
    failed = await outcome()
    assert failed.status == MCPOAuthAttemptStatus.FAILED
    assert failed.error == "User declined"


@pytest.mark.asyncio
async def test_the_outcome_of_a_pending_attempt_past_its_expiry_is_cancelled():
    service, _dao, attempts = _service()
    project_id, endpoint_id = uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=uuid4(), endpoint_id=endpoint_id
    )
    attempts.attempts[start.state] = attempts.attempts[start.state].model_copy(
        update={"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )

    outcome = await service.outcome(
        project_id=project_id, endpoint_id=endpoint_id, attempt_id=start.attempt_id
    )

    assert outcome.status == MCPOAuthAttemptStatus.CANCELLED


@pytest.mark.asyncio
async def test_the_outcome_is_only_given_for_the_connection_that_started_it():
    service, _dao, _attempts = _service()
    project_id = uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=uuid4(), endpoint_id=uuid4()
    )

    assert (
        await service.outcome(
            project_id=project_id, endpoint_id=uuid4(), attempt_id=start.attempt_id
        )
        is None
    )
    assert (
        await service.outcome(
            project_id=uuid4(), endpoint_id=uuid4(), attempt_id=start.attempt_id
        )
        is None
    )


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
    *,
    service,
    project_id,
    endpoint_id=None,
    renewable: bool = True,
    access_token: str = "stale-access",
    refresh_token: str = "renewal-handle-1",
    expires_in: int = -3600,
) -> SecretsTokenStorage:
    """Store a grant, by default one that expired an hour ago, as a long-lived
    connection would hold."""
    storage = SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id or _ENDPOINT_ID,
        authorization_server=f"{_AS_BASE}/",
    )
    await storage.write_tokens(
        OAuthToken(
            access_token=access_token,
            token_type="Bearer",
            expires_in=expires_in,
            refresh_token=refresh_token if renewable else None,
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

    await service.refresh_grant(
        project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
    )

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

    await service.refresh_grant(
        project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
    )

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
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )


@pytest.mark.asyncio
async def test_refresh_grant_raises_when_the_stored_grant_has_no_renewal_handle():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(service=service, project_id=project_id, renewable=False)

    with pytest.raises(MCPOAuthNoRefreshTokenError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )

    assert calls == []


def _grant(*, expires_in: int, refresh_token: Optional[str]) -> OAuthGrantSettingsDTO:
    return OAuthGrantSettingsDTO(
        server=_SERVER_URL,
        access_token="live-access",
        refresh_token=refresh_token,
        expires_at=int(time.time()) + expires_in,
        scopes=["read"],
    )


def test_a_renewable_grant_is_due_inside_the_skew():
    assert grant_refresh_due(_grant(expires_in=30, refresh_token="renewal-handle-1"))


def test_a_grant_without_a_refresh_token_is_used_until_it_really_expires():
    """Nothing can renew it early, so treating the skew as expiry only took the last
    minute of a working token away (DataforSEO registers no refresh grant)."""
    assert not grant_refresh_due(_grant(expires_in=30, refresh_token=None))
    assert grant_refresh_due(_grant(expires_in=-1, refresh_token=None))


@pytest.mark.asyncio
async def test_a_grant_without_a_refresh_token_inside_the_skew_is_left_alone():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(
        service=service,
        project_id=project_id,
        access_token="live-access",
        expires_in=30,
        renewable=False,
    )

    await service.refresh_grant(
        project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
    )

    assert calls == []
    kept = await storage.get_grant()
    assert kept is not None and kept.access_token == "live-access"


@pytest.mark.asyncio
async def test_a_refused_token_is_refreshed_though_it_has_not_expired():
    """A provider can retire a token before the expiry it stated."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(
        service=service,
        project_id=project_id,
        access_token="live-access",
        expires_in=3600,
    )

    await service.refresh_grant(
        project_id=project_id,
        endpoint_id=_ENDPOINT_ID,
        server_url=_SERVER_URL,
        failed_access_token="live-access",
    )

    assert calls == ["refresh_token"]
    renewed = await storage.get_grant()
    assert renewed is not None and renewed.access_token == "renewed-1"


@pytest.mark.asyncio
async def test_a_refused_token_the_row_no_longer_holds_is_not_refreshed_again():
    """The row was renewed or reconnected after the refused call went out. Its token is
    the one to use, and spending its refresh token again would retire it."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(
        service=service,
        project_id=project_id,
        access_token="live-access",
        expires_in=3600,
    )

    await service.refresh_grant(
        project_id=project_id,
        endpoint_id=_ENDPOINT_ID,
        server_url=_SERVER_URL,
        failed_access_token="an-older-access",
    )

    assert calls == []


@pytest.mark.asyncio
async def test_a_refused_token_with_no_refresh_token_asks_for_a_reconnect():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(
        service=service,
        project_id=project_id,
        access_token="live-access",
        expires_in=3600,
        renewable=False,
    )

    with pytest.raises(MCPOAuthNoRefreshTokenError) as refusal:
        await service.refresh_grant(
            project_id=project_id,
            endpoint_id=_ENDPOINT_ID,
            server_url=_SERVER_URL,
            failed_access_token="live-access",
        )

    assert refusal.value.reconnect_message == (
        "No refresh token was issued for this connection. Reconnect to continue."
    )
    assert calls == []


@pytest.mark.parametrize("status_code", [429, 503])
@pytest.mark.asyncio
async def test_a_token_endpoint_failing_on_its_side_is_temporary(status_code):
    """It says nothing about the grant, so the grant is kept as it was for the next try."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/token":
            return httpx.Response(status_code)
        return httpx.Response(404)

    service, _dao, _attempts = _service(handler=handler)
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    with pytest.raises(MCPOAuthRefreshUnavailableError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )

    kept = await storage.get_grant()
    assert kept is not None and kept.refresh_token == "renewal-handle-1"


@pytest.mark.asyncio
async def test_a_token_endpoint_refusing_the_grant_is_definitive():
    calls: List[str] = []
    service, _dao, _attempts = _service(
        handler=_refreshing_as_handler(calls=calls, refusal=True)
    )
    project_id = uuid4()
    await _seed_expired_grant(service=service, project_id=project_id)

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )


@pytest.mark.asyncio
async def test_two_workers_refreshing_one_grant_perform_one_exchange():
    """Two API workers share the database and nothing else: each has its own in-worker
    lock. The connection's OAuth lock is what keeps the second from spending a refresh
    token the first has already rotated."""
    calls: List[str] = []
    dao = _FakeSecretsDAO()
    attempts = InMemoryMCPOAuthAttemptsDAO()
    endpoints = InMemoryMCPEndpoints(attempts=attempts)

    respond = _refreshing_as_handler(calls=calls)

    async def slow_token_endpoint(request: httpx.Request) -> httpx.Response:
        # The exchange takes time, as a real one does, so the other worker gets to run
        # while it is in flight.
        await asyncio.sleep(0.05)
        return respond(request)

    def worker() -> MCPOAuthConnectService:
        return MCPOAuthConnectService(
            vault_service=VaultService(secrets_dao=dao),
            client=MCPOAuthClient(transport=httpx.MockTransport(slow_token_endpoint)),
            api_url=_API_URL,
            attempts_dao=attempts,
            endpoints_dao=endpoints,
            resolve=_private_resolve,
        )

    first, second = worker(), worker()
    project_id = uuid4()
    storage = await _seed_expired_grant(service=first, project_id=project_id)

    await asyncio.gather(
        first.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        ),
        second.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        ),
    )

    assert calls == ["refresh_token"]
    renewed = await storage.get_grant()
    assert renewed is not None and renewed.access_token == "renewed-1"


@pytest.mark.asyncio
async def test_two_concurrent_calls_on_one_expired_grant_perform_one_refresh():
    """A rotating authorization server retires a renewal handle the instant it is spent,
    so a second exchange would leave one caller holding a retired grant."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await asyncio.gather(
        service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        ),
        service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        ),
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
        endpoint_id=_ENDPOINT_ID,
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

    await service.refresh_grant(
        project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
    )

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
        # The connection the flow above connected, not this module's default: the grant
        # is addressed by the endpoint the attempt carried.
        endpoint_id=endpoint_id,
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
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )

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
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )


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
        endpoint_id=_ENDPOINT_ID,
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
        await service.refresh_grant(
            project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
        )

    assert calls == []


@pytest.mark.asyncio
async def test_refresh_succeeds_and_keeps_the_pin_when_the_issuer_is_unchanged():
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    storage = await _seed_expired_grant(service=service, project_id=project_id)

    await service.refresh_grant(
        project_id=project_id, endpoint_id=_ENDPOINT_ID, server_url=_SERVER_URL
    )

    assert calls == ["refresh_token"]
    stored = await storage.get_grant()
    assert stored is not None
    assert stored.access_token == "renewed-1"
    assert stored.issuer == f"{_AS_BASE}/"


def _public_resolve(_hostname: str) -> List[str]:
    """A publicly reachable deployment, which is what makes the identity document an
    option at all. The tests below are about which option wins when both are open."""
    return ["93.184.216.34"]


def _handler_without_registration(*, advertise_document: bool = True):
    """An authorization server that advertises no registration endpoint, and by default
    takes a client ID metadata document instead."""
    metadata = {k: v for k, v in _AS_METADATA.items() if k != "registration_endpoint"}
    if advertise_document:
        metadata["client_id_metadata_document_supported"] = True

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

    assert "register yourself" in str(refusal.value)


# --- a renewal touches one connection ------------------------------------------- #


@pytest.mark.asyncio
async def test_refreshing_one_connection_leaves_the_other_at_the_same_url_untouched():
    """Two accounts at one MCP server hold two grants, and renewing one must not read,
    spend or rewrite the other's.

    The renewal used to be addressed by `(project_id, server_url)`, which named both.
    A rotating authorization server retires a refresh token the moment it is spent, so
    renewing on the wrong row did not merely rewrite it: it also burned a handle the
    rightful connection still needed.
    """
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    endpoint_a, endpoint_b = uuid4(), uuid4()

    storage_a = await _seed_expired_grant(
        service=service,
        project_id=project_id,
        endpoint_id=endpoint_a,
        access_token="stale-a",
        refresh_token="renewal-handle-a",
    )
    storage_b = await _seed_expired_grant(
        service=service,
        project_id=project_id,
        endpoint_id=endpoint_b,
        access_token="stale-b",
        refresh_token="renewal-handle-b",
    )

    await service.refresh_grant(
        project_id=project_id, endpoint_id=endpoint_b, server_url=_SERVER_URL
    )

    assert calls == ["refresh_token"]

    renewed_b = await storage_b.get_grant()
    assert renewed_b is not None and renewed_b.access_token == "renewed-1"

    untouched_a = await storage_a.get_grant()
    assert untouched_a is not None
    assert untouched_a.access_token == "stale-a"
    assert untouched_a.refresh_token == "renewal-handle-a"


@pytest.mark.asyncio
async def test_two_connections_at_one_url_refresh_without_waiting_on_each_other():
    """The in-worker lock is per connection, not per server, so two accounts at one URL
    each perform their own exchange rather than one finding the other's fresh token and
    doing nothing."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    endpoint_a, endpoint_b = uuid4(), uuid4()
    storage_a = await _seed_expired_grant(
        service=service, project_id=project_id, endpoint_id=endpoint_a
    )
    storage_b = await _seed_expired_grant(
        service=service, project_id=project_id, endpoint_id=endpoint_b
    )

    await asyncio.gather(
        service.refresh_grant(
            project_id=project_id, endpoint_id=endpoint_a, server_url=_SERVER_URL
        ),
        service.refresh_grant(
            project_id=project_id, endpoint_id=endpoint_b, server_url=_SERVER_URL
        ),
    )

    assert calls == ["refresh_token", "refresh_token"]
    grant_a = await storage_a.get_grant()
    grant_b = await storage_b.get_grant()
    assert grant_a is not None and grant_a.access_token.startswith("renewed-")
    assert grant_b is not None and grant_b.access_token.startswith("renewed-")
    assert grant_a.access_token != grant_b.access_token


@pytest.mark.asyncio
async def test_a_connection_with_no_grant_is_refused_even_when_a_sibling_has_one():
    """A never-connected endpoint at an already-connected URL must be told to connect,
    not handed the neighbour's tokens."""
    calls: List[str] = []
    service, _dao, _attempts = _service(handler=_refreshing_as_handler(calls=calls))
    project_id = uuid4()
    await _seed_expired_grant(
        service=service, project_id=project_id, endpoint_id=uuid4()
    )

    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=uuid4(), server_url=_SERVER_URL
        )

    assert calls == []


@pytest.mark.asyncio
async def test_a_completed_grant_records_the_connection_that_consented():
    """Two consents at one server write two rows, each naming its own connection."""
    service, _dao, _attempts = _service()
    project_id, user_id = uuid4(), uuid4()
    endpoint_a, endpoint_b = uuid4(), uuid4()

    for endpoint_id in (endpoint_a, endpoint_b):
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

    written = [
        secret
        for secret in await service.vault_service.list_secrets(project_id=project_id)
        if secret.kind == SecretKind.OAUTH_GRANT
    ]
    assert len(written) == 2
    assert {secret.data.grant.endpoint_id for secret in written} == {
        endpoint_a,
        endpoint_b,
    }


# --- What lands during the token exchange --------------------------------------- #


def _paused_exchange(service):
    """Hold the token exchange open until the test lets it go.

    Returns the event that releases it and the event that says it has started, so a
    test can cancel, disconnect or edit while the code is being spent.
    """
    started, release = asyncio.Event(), asyncio.Event()

    async def _exchange_token(**_kwargs):
        started.set()
        await release.wait()
        return OAuthToken(access_token="tok-paused", token_type="Bearer")

    service.client.exchange_token = _exchange_token
    return started, release


async def _complete_around(service, start, user_id, during):
    """Claim, start the exchange, run `during` while it is held, then let it finish."""
    started, release = _paused_exchange(service)
    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    completing = asyncio.create_task(service.complete(attempt=attempt, code="code-1"))
    await started.wait()
    await during()
    release.set()
    return await asyncio.gather(completing, return_exceptions=True)


def _grant_rows(dao):
    return [r for _, r in dao.records if r.kind.value == "oauth_grant"]


@pytest.mark.asyncio
async def test_a_cancel_during_the_exchange_wins_and_nothing_is_written():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    async def cancel():
        await service.cancel(
            project_id=project_id,
            endpoint_id=endpoint_id,
            attempt_id=start.attempt_id,
        )

    (outcome,) = await _complete_around(service, start, user_id, cancel)

    assert isinstance(outcome, MCPOAuthAttemptCancelledError)
    assert _grant_rows(dao) == []
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.CANCELLED


@pytest.mark.asyncio
async def test_a_disconnect_during_the_exchange_wins_and_nothing_is_written():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    async def disconnect():
        await service.disconnect(
            project_id=project_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )

    (outcome,) = await _complete_around(service, start, user_id, disconnect)

    assert isinstance(outcome, MCPOAuthAttemptCancelledError)
    assert _grant_rows(dao) == []
    assert service.endpoints_dao.endpoints[endpoint_id].secret_id is None


@pytest.mark.parametrize(
    "moved",
    [
        {"data": MCPEndpointData(route=MCPEndpointRoute(base_url="https://mcp.new/"))},
        {"auth_mode": GatewayAuthScheme.API_KEY},
    ],
    ids=["address changed", "mode changed"],
)
@pytest.mark.asyncio
async def test_an_edit_during_the_exchange_wins_and_nothing_is_written(moved):
    """No grant at all, so a stale completion cannot overwrite a newer one either."""
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )
    endpoints = service.endpoints_dao

    async def edit():
        current = await endpoints.fetch_endpoint(
            project_id=project_id, endpoint_id=endpoint_id
        )
        endpoints.put(current.model_copy(update=moved))

    (outcome,) = await _complete_around(service, start, user_id, edit)

    assert isinstance(outcome, MCPOAuthAttemptCancelledError)
    assert _grant_rows(dao) == []
    assert endpoints.endpoints[endpoint_id].secret_id is None
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.CANCELLED


@pytest.mark.asyncio
async def test_a_completed_attempt_binds_the_grant_and_records_connected():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    completion = await _callback(
        service, code="auth-code-1", state=start.state, caller_user_id=user_id
    )

    (grant,) = _grant_rows(dao)
    assert completion.secret_id is not None
    assert (
        service.endpoints_dao.endpoints[endpoint_id].secret_id == completion.secret_id
    )
    assert attempts.attempts[start.state].status == MCPOAuthAttemptStatus.CONNECTED


@pytest.mark.asyncio
async def test_a_refused_exchange_is_recorded_as_the_attempts_failure():
    service, _dao, attempts = _service()
    user_id = uuid4()
    start = await _begin(
        service, project_id=uuid4(), user_id=user_id, endpoint_id=uuid4()
    )

    async def _refuse(**_kwargs):
        raise MCPOAuthTokenExchangeError(
            token_endpoint="https://auth.acme.io/token", detail="invalid_grant"
        )

    service.client.exchange_token = _refuse

    with pytest.raises(MCPOAuthTokenExchangeError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )

    record = attempts.attempts[start.state]
    assert record.status == MCPOAuthAttemptStatus.FAILED
    assert "invalid_grant" in record.error


def _connection(
    service, endpoint_id, *, auth_mode=GatewayAuthScheme.OAUTH, secret_id=None
):
    service.endpoints_dao.put(
        MCPEndpoint(
            id=endpoint_id,
            slug="acme",
            auth_mode=auth_mode,
            secret_id=secret_id,
            data=MCPEndpointData(route=MCPEndpointRoute(base_url=_SERVER_URL)),
        )
    )


@pytest.mark.asyncio
async def test_a_disconnect_decides_on_the_connection_as_it_stands_under_the_lock():
    """Disconnect was refused or allowed on a read taken before the lock. An edit to an
    API key landing in between then had its key cleared."""
    service, _dao, _attempts = _service()
    project_id, user_id, endpoint_id, key = uuid4(), uuid4(), uuid4(), uuid4()
    _connection(
        service, endpoint_id, auth_mode=GatewayAuthScheme.API_KEY, secret_id=key
    )

    unchanged = await service.disconnect(
        project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    assert unchanged.auth_mode == GatewayAuthScheme.API_KEY
    assert service.endpoints_dao.endpoints[endpoint_id].secret_id == key


@pytest.mark.asyncio
async def test_a_bind_that_fails_is_a_failure_and_leaves_no_grant():
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await _begin(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    async def no_row(**_kwargs):
        return None

    service.endpoints_dao.bind_endpoint_secret = no_row

    with pytest.raises(MCPOAuthBindFailedError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )

    assert _grant_rows(dao) == []
    record = attempts.attempts[start.state]
    assert record.status == MCPOAuthAttemptStatus.FAILED
    assert record.error == MCPOAuthBindFailedError().message


@pytest.mark.asyncio
async def test_a_disconnect_during_a_begin_cancels_the_attempt_it_creates():
    """Begin holds the connection's lock from discovery to the recorded attempt. A
    disconnect arriving meanwhile waits for the attempt, then cancels it."""
    service, dao, attempts = _service()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()
    _connection(service, endpoint_id)
    reached, release = asyncio.Event(), asyncio.Event()
    original = service.client.discover

    async def paused(**kwargs):
        reached.set()
        await release.wait()
        return await original(**kwargs)

    service.client.discover = paused
    beginning = asyncio.create_task(
        _begin(service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id)
    )
    await reached.wait()
    disconnecting = asyncio.create_task(
        service.disconnect(
            project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
        )
    )
    await asyncio.sleep(0.05)
    assert not disconnecting.done()
    release.set()
    start = await beginning
    await disconnecting

    with pytest.raises(MCPOAuthAttemptCancelledError):
        await _callback(
            service, code="auth-code-1", state=start.state, caller_user_id=user_id
        )
    assert _grant_rows(dao) == []
    assert service.endpoints_dao.endpoints[endpoint_id].secret_id is None
