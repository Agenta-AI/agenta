"""Unit tests for OAuth registration fallback.

Same mock-authorization-server-behind-`httpx.MockTransport` pattern as
`test_gateways_mcp_oauth_service.py`, with the resolver also injected — no DNS, no
network, no real authorization server.
"""

import time
from typing import List, Tuple
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.registration import client_metadata_url
from oss.src.core.gateways.mcps.oauth.service import MCPOAuthConnectService
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthClientSecretRequiredError,
    MCPOAuthRefreshFailedError,
    MCPOAuthRegistrationUnresolvablePinError,
    MCPOAuthRegistrationUnsupportedError,
)
from oss.src.core.gateways.mcps.oauth.storage import (
    SecretsTokenStorage,
    registration_slug,
)
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO
from oss.src.core.secrets.dtos import OAuthGrantSettingsDTO, SecretResponseDTO
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


def _mock_as_handler(
    *,
    register_called: list,
    advertise_registration: bool = True,
    advertise_metadata_document: bool = True,
    token_auth_methods: list[str] | None = None,
):
    """A mock authorization server, optionally one that accepts no registrations.

    `advertise_registration=False` drops `registration_endpoint` from the metadata,
    which is the only condition under which naming ourselves with a client-id metadata
    document is correct. `/register` stays wired up either way so that a test can prove
    nothing reached it.
    """
    metadata = dict(_AS_METADATA)
    if token_auth_methods is not None:
        metadata["token_endpoint_auth_methods_supported"] = token_auth_methods
    if not advertise_registration:
        metadata.pop("registration_endpoint", None)
        if advertise_metadata_document:
            metadata["client_id_metadata_document_supported"] = True

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
    *,
    resolve,
    register_called=None,
    advertise_registration: bool = True,
    advertise_metadata_document: bool = True,
    token_auth_methods: list[str] | None = None,
    api_url: str = _API_URL,
    dao=None,
    handler=None,
) -> Tuple[MCPOAuthConnectService, _FakeSecretsDAO, InMemoryMCPOAuthAttemptsDAO]:
    register_called = register_called if register_called is not None else []
    dao = dao if dao is not None else _FakeSecretsDAO()
    attempts = InMemoryMCPOAuthAttemptsDAO()
    vault = VaultService(secrets_dao=dao)
    client = MCPOAuthClient(
        transport=httpx.MockTransport(
            handler
            or _mock_as_handler(
                register_called=register_called,
                advertise_registration=advertise_registration,
                advertise_metadata_document=advertise_metadata_document,
                token_auth_methods=token_auth_methods,
            )
        )
    )
    service = MCPOAuthConnectService(
        vault_service=vault,
        client=client,
        api_url=api_url,
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
async def test_begin_refuses_an_issuer_that_supports_no_automatic_client_identity():
    service, dao, attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        advertise_registration=False,
        advertise_metadata_document=False,
    )

    with pytest.raises(MCPOAuthRegistrationUnsupportedError):
        await service.begin(
            project_id=uuid4(),
            user_id=uuid4(),
            endpoint_id=uuid4(),
            server_url=_SERVER_URL,
            scopes=["read"],
        )

    assert dao.records == []
    assert attempts.attempts == {}


@pytest.mark.asyncio
async def test_begin_refuses_a_public_client_when_the_issuer_requires_a_secret():
    service, dao, attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        advertise_registration=False,
        advertise_metadata_document=False,
    )

    with pytest.raises(MCPOAuthClientSecretRequiredError):
        await service.begin(
            project_id=uuid4(),
            user_id=uuid4(),
            endpoint_id=uuid4(),
            server_url=_SERVER_URL,
            scopes=["read"],
            client_id="registered-client",
        )

    assert dao.records == []
    assert attempts.attempts == {}


@pytest.mark.asyncio
async def test_begin_accepts_a_public_registered_client_when_the_issuer_allows_it():
    service, _dao, _attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        advertise_registration=False,
        advertise_metadata_document=False,
        token_auth_methods=["none"],
    )

    start = await service.begin(
        project_id=uuid4(),
        user_id=uuid4(),
        endpoint_id=uuid4(),
        server_url=_SERVER_URL,
        scopes=["read"],
        client_id="public-client",
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"] == ["public-client"]


@pytest.mark.asyncio
async def test_begin_uses_a_user_registered_client_when_automatic_identity_is_unsupported():
    service, dao, attempts = _service(
        resolve=lambda _h: ["1.1.1.1"],
        advertise_registration=False,
        advertise_metadata_document=False,
    )
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
        client_id="registered-client",
        client_secret="registered-secret",
    )

    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["client_id"] == ["registered-client"]
    providers = [r for _, r in dao.records if r.kind.value == "oauth_provider"]
    assert len(providers) == 1
    assert providers[0].data.provider.client_secret == "registered-secret"
    assert providers[0].data.provider.extra["client_info"].get("client_secret") is None
    assert (
        providers[0].data.provider.extra["client_info"]["token_endpoint_auth_method"]
        == "client_secret_post"
    )
    assert attempts.attempts[start.state].strategy == "outbound"

    reconnect = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    reconnect_params = parse_qs(urlparse(reconnect.authorization_url).query)
    assert reconnect_params["client_id"] == ["registered-client"]
    assert len([r for _, r in dao.records if r.kind.value == "oauth_provider"]) == 1


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


# --- OR78: a registration is only reusable while it names our callback ------------ #


_MOVED_API_URL = "https://agenta.example-tunnel.app"


def _stored_registration(dao: _FakeSecretsDAO):
    return next(r for _, r in dao.records if r.kind.value == "oauth_provider")


@pytest.mark.asyncio
async def test_a_changed_public_address_registers_again_instead_of_reusing_a_stale_client():
    """A deployment's public address changes whenever a tunnel is added, rotated or
    dropped, and a registration under RFC 7591 is bound to the redirect URIs it was
    created with.

    Before this, the stored registration was found by issuer alone, its `client_id` was
    sent, and the authorization server refused it: the client it knows is registered
    against an address the request no longer uses. Nothing re-registered, so the
    connection stayed unconnectable until someone deleted the record by hand, and the
    error the person saw was the authorization server's, which says nothing about
    redirect URIs.
    """
    register_called: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    before, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called, dao=dao
    )
    await before.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    assert register_called == [True]
    assert _API_URL in str(_stored_registration(dao).data.provider.extra["client_info"])

    # The same vault, the same authorization server, a new public address.
    after, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"],
        register_called=register_called,
        dao=dao,
        api_url=_MOVED_API_URL,
    )
    start = await after.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )

    assert register_called == [True, True]
    params = parse_qs(urlparse(start.authorization_url).query)
    assert params["redirect_uri"][0].startswith(_MOVED_API_URL)
    # The fresh registration sits BESIDE the old one rather than replacing it (D6).
    # Inverted on purpose: the previous assertion stated the defect as an expectation.
    # Every grant already issued was bound to the old client, and an authorization server
    # refuses a refresh presented by a client it never issued those tokens to, so
    # overwriting the row turned "one endpoint cannot connect" into "the endpoints that
    # could stop refreshing".
    providers = [r for _, r in dao.records if r.kind.value == "oauth_provider"]
    assert len(providers) == 2
    addresses = [str(p.data.provider.extra["client_info"]) for p in providers]
    assert any(_API_URL in address for address in addresses)
    assert any(_MOVED_API_URL in address for address in addresses)


@pytest.mark.asyncio
async def test_an_unchanged_public_address_reuses_the_registration_it_has():
    """The other half: re-registering on every connect would mint a fresh client each
    time, which authorization servers rate limit."""
    register_called: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id = uuid4(), uuid4()

    service, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], register_called=register_called, dao=dao
    )
    for _ in range(2):
        await service.begin(
            project_id=project_id,
            user_id=user_id,
            endpoint_id=uuid4(),
            server_url=_SERVER_URL,
            scopes=["read"],
        )

    assert register_called == [True]
    assert len([r for _, r in dao.records if r.kind.value == "oauth_provider"]) == 1


def test_registration_covers_matches_the_callback_the_deployment_would_send():
    from mcp.shared.auth import OAuthClientInformationFull

    from oss.src.core.gateways.mcps.oauth.registration import registration_covers

    callback = "https://api.agenta.ai/gateways/mcps/connect/callback"
    registered = OAuthClientInformationFull(
        redirect_uris=[callback], client_id="client-abc"
    )

    assert registration_covers(registered, redirect_uri=callback)
    # A trailing slash is the one difference a client library can introduce without
    # changing where the browser lands.
    assert registration_covers(registered, redirect_uri=f"{callback}/")
    # Everything else is a different address, and the authorization server says so.
    assert not registration_covers(
        registered,
        redirect_uri="https://agenta.example-tunnel.app/gateways/mcps/connect/callback",
    )
    assert not registration_covers(
        registered, redirect_uri="http://api.agenta.ai/gateways/mcps/connect/callback"
    )


def test_registration_covers_accepts_any_of_several_registered_callbacks():
    from mcp.shared.auth import OAuthClientInformationFull

    from oss.src.core.gateways.mcps.oauth.registration import registration_covers

    first = "https://api.agenta.ai/gateways/mcps/connect/callback"
    second = "https://agenta.example-tunnel.app/gateways/mcps/connect/callback"
    registered = OAuthClientInformationFull(
        redirect_uris=[first, second], client_id="client-abc"
    )

    assert registration_covers(registered, redirect_uri=first)
    assert registration_covers(registered, redirect_uri=second)


# --- D6: a re-registration must not strand the grants the old client holds -------- #


def _client_binding_as_handler(*, registrations: list, refresh_attempts: list = None):
    """An authorization server that issues a distinct client per registration and refuses
    a refresh presented by a client it did not issue those tokens to.

    Both behaviours are ordinary. RFC 7591 gives every registration its own `client_id`,
    and a refresh token belongs to the client it was issued to; presenting someone else's
    is `invalid_client`. Keeping one mutable registration per issuer overwrote the client
    every existing grant depended on, and this is the refusal those grants then got.
    """
    issued_to: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if path == "/register":
            body = _json.loads(request.content)
            client_id = f"client-{len(registrations) + 1}"
            registrations.append(
                {"client_id": client_id, "redirect_uris": body.get("redirect_uris")}
            )
            return httpx.Response(
                201, json={**body, "client_id": client_id, "client_secret": "secret"}
            )
        if path == "/token":
            form = dict(parse_qs(request.content.decode()))
            presented = form.get("client_id", [""])[0]
            if form.get("grant_type", [""])[0] == "refresh_token":
                if refresh_attempts is not None:
                    # Which client identity was actually put on the wire.
                    refresh_attempts.append(presented)
                handle = form.get("refresh_token", [""])[0]
                owner = issued_to.get(handle)
                if owner != presented:
                    return httpx.Response(
                        400,
                        json={
                            "error": "invalid_client",
                            "error_description": (
                                f"these tokens were issued to {owner}, not {presented}"
                            ),
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "access_token": "renewed",
                        "token_type": "Bearer",
                        "expires_in": 3600,
                        "refresh_token": handle,
                        "scope": "read",
                    },
                )
            handle = f"refresh-for-{presented}"
            issued_to[handle] = presented
            # Already expired, so a renewal can be reached without waiting.
            return httpx.Response(
                200,
                json={
                    "access_token": "first",
                    "token_type": "Bearer",
                    "expires_in": -1,
                    "refresh_token": handle,
                    "scope": "read",
                },
            )
        return httpx.Response(404)

    return handler


async def _connect(service, *, project_id, user_id, endpoint_id):
    start = await service.begin(
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
    )
    attempt = await service.claim(state=start.state, caller_user_id=user_id)
    return await service.complete(attempt=attempt, code="code-1")


def _grant_storage(dao, *, project_id, endpoint_id, authorization_server=None):
    return SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=dao),
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server=authorization_server,
    )


@pytest.mark.asyncio
async def test_a_grant_still_refreshes_after_the_address_change_re_registers():
    """The defect D6 names, end to end.

    Connection A connects at the deployment's original address. The address changes, so
    connection B's connect registers a new client. A's grant was bound to the old client
    and its renewal has to keep presenting that one.
    """
    registrations: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id = uuid4(), uuid4()
    endpoint_a, endpoint_b = uuid4(), uuid4()
    # One authorization server across both services: it is the deployment's address that
    # changes, and the server is what remembers which client each refresh token belongs to.
    authorization_server = _client_binding_as_handler(registrations=registrations)

    before, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], dao=dao, handler=authorization_server
    )
    await _connect(
        before, project_id=project_id, user_id=user_id, endpoint_id=endpoint_a
    )
    assert [r["client_id"] for r in registrations] == ["client-1"]

    after, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"],
        dao=dao,
        api_url=_MOVED_API_URL,
        handler=authorization_server,
    )
    await _connect(
        after, project_id=project_id, user_id=user_id, endpoint_id=endpoint_b
    )
    assert [r["client_id"] for r in registrations] == ["client-1", "client-2"]

    await after.refresh_grant(
        project_id=project_id, endpoint_id=endpoint_a, server_url=_SERVER_URL
    )

    renewed = await _grant_storage(
        dao, project_id=project_id, endpoint_id=endpoint_a
    ).get_grant()
    assert renewed is not None
    assert renewed.access_token == "renewed"
    assert renewed.expires_at is not None and renewed.expires_at > time.time()


@pytest.mark.asyncio
async def test_a_grant_keeps_its_registration_across_two_consecutive_renewals():
    """D24. The case the D6 fix never ran: refresh twice.

    The first renewal rewrote the grant with no registration reference at all, because
    the reader that resolves a grant's own registration never recorded which one it had
    resolved and the write persists whatever that holds. So the pin survived the consent
    and died on the first refresh, and every refresh after it resolved whatever
    registration the issuer holds now — which is the address-change failure D6 closed,
    reappearing one renewal later.
    """
    registrations: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id = uuid4(), uuid4()
    endpoint_a, endpoint_b = uuid4(), uuid4()
    authorization_server = _client_binding_as_handler(registrations=registrations)

    before, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"], dao=dao, handler=authorization_server
    )
    await _connect(
        before, project_id=project_id, user_id=user_id, endpoint_id=endpoint_a
    )
    issued_against = registration_slug(
        issuer_url=f"{_AS_BASE}/",
        redirect_uri=f"{_API_URL}/gateways/mcps/connect/callback",
    )

    # The deployment moves, so a second connect registers a different client at the same
    # issuer. Now there are two, and only the pin says which one A's tokens belong to.
    after, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"],
        dao=dao,
        api_url=_MOVED_API_URL,
        handler=authorization_server,
    )
    await _connect(
        after, project_id=project_id, user_id=user_id, endpoint_id=endpoint_b
    )
    assert [r["client_id"] for r in registrations] == ["client-1", "client-2"]

    storage = _grant_storage(dao, project_id=project_id, endpoint_id=endpoint_a)

    for renewal in (1, 2):
        await after.refresh_grant(
            project_id=project_id, endpoint_id=endpoint_a, server_url=_SERVER_URL
        )
        renewed = await storage.get_grant()
        assert renewed is not None, f"renewal {renewal} left no grant"
        assert renewed.access_token == "renewed"
        # The whole finding: this was None after the first renewal.
        assert renewed.client_registration_slug == issued_against, (
            f"renewal {renewal} lost the registration reference"
        )


@pytest.mark.asyncio
async def test_resolving_a_grants_registration_records_which_one_it_resolved():
    """The root of D24, at the seam that lost it.

    `write_tokens` persists whatever the storage last resolved, so a reader that returns
    a registration without recording it leaves the next write with nothing to persist.
    Both branches have to record: the pinned one, and the by-issuer fallback a grant
    written before the reference existed still takes.
    """
    dao = _FakeSecretsDAO()
    project_id, endpoint_id = uuid4(), uuid4()
    storage = _grant_storage(
        dao,
        project_id=project_id,
        endpoint_id=endpoint_id,
        authorization_server=f"{_AS_BASE}/",
    )
    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=[f"{_API_URL}/gateways/mcps/connect/callback"],
            client_id="client-1",
        )
    )
    # Whatever slug the row is actually stored under: this storage knows no callback
    # address, so `set_client_info` wrote it under the issuer's own slug.
    slug = _stored_registration(dao).slug
    assert slug

    # A grant carrying no reference: resolved by issuer, and now pinned for next time.
    storage.resolved_registration_slug = None
    resolved = await storage.get_client_info_for_grant(
        OAuthGrantSettingsDTO(
            server=_SERVER_URL, scopes=["read"], issuer=f"{_AS_BASE}/"
        )
    )
    assert resolved is not None and resolved.client_id == "client-1"
    assert storage.resolved_registration_slug == slug

    # A grant carrying one: resolved by it, and kept.
    storage.resolved_registration_slug = None
    resolved = await storage.get_client_info_for_grant(
        OAuthGrantSettingsDTO(
            server=_SERVER_URL,
            scopes=["read"],
            issuer=f"{_AS_BASE}/",
            client_registration_slug=slug,
        )
    )
    assert resolved is not None
    assert storage.resolved_registration_slug == slug


@pytest.mark.asyncio
async def test_a_pin_naming_a_deleted_registration_is_still_carried_forward():
    """Dropping it would silently downgrade the next renewal to "whatever this issuer
    has now", which is the behaviour the pin exists to prevent."""
    dao = _FakeSecretsDAO()
    storage = _grant_storage(
        dao,
        project_id=uuid4(),
        endpoint_id=uuid4(),
        authorization_server=f"{_AS_BASE}/",
    )

    with pytest.raises(MCPOAuthRegistrationUnresolvablePinError):
        await storage.get_client_info_for_grant(
            OAuthGrantSettingsDTO(
                server=_SERVER_URL,
                scopes=["read"],
                issuer=f"{_AS_BASE}/",
                client_registration_slug="oauth-provider-does-not-exist",
            )
        )

    # Recorded before the refusal, so a write that follows still says which client these
    # tokens belong to rather than silently unpinning them.
    assert storage.resolved_registration_slug == "oauth-provider-does-not-exist"


@pytest.mark.asyncio
async def test_a_grant_records_the_registration_it_was_issued_against():
    """The bookkeeping the renewal above depends on."""
    registrations: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    service, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"],
        dao=dao,
        handler=_client_binding_as_handler(registrations=registrations),
    )
    await _connect(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    grant = await _grant_storage(
        dao, project_id=project_id, endpoint_id=endpoint_id
    ).get_grant()

    assert grant is not None
    assert grant.client_registration_slug == registration_slug(
        issuer_url=f"{_AS_BASE}/",
        redirect_uri=f"{_API_URL}/gateways/mcps/connect/callback",
    )


@pytest.mark.asyncio
async def test_a_grant_that_records_no_registration_still_finds_the_issuers():
    """Every grant written before the reference existed carries none, and the issuer's
    registration is exactly where they were already being resolved."""
    dao = _FakeSecretsDAO()
    project_id, endpoint_id = uuid4(), uuid4()

    await _grant_storage(
        dao,
        project_id=project_id,
        endpoint_id=endpoint_id,
        authorization_server=f"{_AS_BASE}/",
    ).set_client_info(
        OAuthClientInformationFull(
            redirect_uris=[f"{_API_URL}/gateways/mcps/connect/callback"],
            client_id="legacy-client",
        )
    )
    # Its own instance, so nothing has resolved a registration on it and the grant records
    # none — the shape of every grant written before the reference existed.
    legacy = _grant_storage(
        dao,
        project_id=project_id,
        endpoint_id=endpoint_id,
        authorization_server=f"{_AS_BASE}/",
    )
    await legacy.write_tokens(
        OAuthToken(access_token="stale", token_type="Bearer", expires_in=-1)
    )
    stored = await legacy.get_grant()
    assert stored is not None and stored.client_registration_slug is None

    resolved = await legacy.get_client_info_for_grant(stored)

    assert resolved is not None and resolved.client_id == "legacy-client"


@pytest.mark.asyncio
async def test_a_grant_whose_registration_is_gone_gets_no_substitute():
    """Any other client at this issuer was never issued these tokens, so there is nothing
    to fall back to; the caller turns that into a reconnect."""
    dao = _FakeSecretsDAO()
    project_id, endpoint_id = uuid4(), uuid4()
    storage = _grant_storage(
        dao,
        project_id=project_id,
        endpoint_id=endpoint_id,
        authorization_server=f"{_AS_BASE}/",
    )
    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=[f"{_API_URL}/gateways/mcps/connect/callback"],
            client_id="another-client",
        )
    )
    stored = OAuthGrantSettingsDTO(
        server=_SERVER_URL,
        scopes=["read"],
        issuer=f"{_AS_BASE}/",
        client_registration_slug="oauth-provider-does-not-exist",
    )

    # Refused, not answered `None`. `None` is what a grant carrying no pin at all says,
    # and the renewal reads that as permission to present the deployment's identity
    # document — the substitute this case exists to rule out (N3).
    with pytest.raises(MCPOAuthRegistrationUnresolvablePinError):
        await storage.get_client_info_for_grant(stored)


@pytest.mark.asyncio
async def test_a_renewal_whose_pinned_registration_is_gone_asks_for_a_reconnect():
    """N3, through the renewal rather than at the reader.

    The reader answered `None` for a pin it could not resolve, which is what a grant
    carrying no pin at all answers, and the renewal reads that as permission to present
    the deployment's own identity document. So the one substitution the pin exists to
    prevent was the one that happened, and the authorization server refused the refresh
    with an error about an unknown client.

    A refresh failure instead, which the data plane already turns into the reconnect
    that mints a fresh registration along with fresh tokens.
    """
    registrations: list = []
    dao = _FakeSecretsDAO()
    project_id, user_id, endpoint_id = uuid4(), uuid4(), uuid4()

    refresh_attempts: list = []
    service, _dao, _attempts = _service(
        resolve=lambda _h: ["10.0.0.5"],
        dao=dao,
        handler=_client_binding_as_handler(
            registrations=registrations, refresh_attempts=refresh_attempts
        ),
    )
    await _connect(
        service, project_id=project_id, user_id=user_id, endpoint_id=endpoint_id
    )

    storage = _grant_storage(dao, project_id=project_id, endpoint_id=endpoint_id)
    stored = await storage.get_grant()
    assert stored is not None and stored.client_registration_slug

    # The registration goes, and the grant still names it.
    registration = _stored_registration(dao)
    # The DAO holds `(project_id, record)` pairs, so the record is the second element;
    # filtering the pairs themselves deleted nothing and left the case proving nothing.
    dao.records = [pair for pair in dao.records if pair[1] is not registration]
    # Aged through a storage carrying the grant's own issuer, because a renewal refuses a
    # grant that does not record who issued it and would stop before reading any
    # registration at all.
    aging = _grant_storage(
        dao,
        project_id=project_id,
        endpoint_id=endpoint_id,
        authorization_server=stored.issuer,
    )
    # And carrying the pin, because `write_tokens` persists whatever the storage last
    # resolved: a fresh one writes `None` there and would quietly unpin the grant, which
    # is the D24 defect and would leave this case testing the unpinned path instead.
    aging.resolved_registration_slug = stored.client_registration_slug
    await aging.write_tokens(
        OAuthToken(
            access_token=stored.access_token,
            token_type="Bearer",
            expires_in=-3600,
            refresh_token=stored.refresh_token,
            scope=" ".join(stored.scopes) if stored.scopes else None,
        )
    )

    exchanges_before = len(registrations)
    with pytest.raises(MCPOAuthRefreshFailedError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=endpoint_id, server_url=_SERVER_URL
        )

    # And it refused without presenting anything. This is the assertion that separates
    # the fix from the defect: answering `None` also ended in a refresh failure, because
    # the authorization server rejected the substituted client — but it rejected it
    # AFTER the deployment's identity document had been put on the wire as the client
    # for somebody else's tokens. Nothing reaches the token endpoint now.
    assert refresh_attempts == []
    assert len(registrations) == exchanges_before
