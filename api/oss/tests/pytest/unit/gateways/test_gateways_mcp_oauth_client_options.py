"""The OAuth client a connection signs in as, how it authenticates, and where discovery
looks when a server publishes no protected-resource document.

A mock authorization server behind `httpx.MockTransport` and a real `VaultService` over
an in-memory fake DAO, as in `test_gateways_mcp_oauth_service.py`.
"""

from __future__ import annotations

import base64
import json
from typing import Callable, Dict, List, Optional
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
import pytest
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import ValidationError

from oss.src.core.gateways.dtos import GatewayAuthScheme
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointData,
    MCPEndpointRoute,
    MCPOAuthConfig,
)
from oss.src.core.gateways.mcps.oauth.client import (
    MCPOAuthClient,
    client_authentication,
)
from oss.src.core.gateways.mcps.oauth.service import (
    MCPOAuthConnectService,
    callback_redirect_uri,
)
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthAttemptCancelledError,
    MCPOAuthDiscoveryError,
    MCPOAuthTokenExchangeError,
    MCPOAuthRegistrationUnavailableError,
    MCPOAuthRegistrationUnresolvablePinError,
)
from oss.src.core.gateways.policy.types import SecretInvalidError
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    SecretDTO,
)
from oss.src.core.secrets.enums import CustomSecretFormat, SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Header
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
    _FakeSecretsDAO,
)
from oss.tests.pytest.utils.mcp_endpoints import InMemoryMCPEndpoints
from oss.tests.pytest.utils.mcp_oauth_attempts import InMemoryMCPOAuthAttemptsDAO

_API_URL = "https://api.agenta.ai"
_SERVER_URL = "https://mcp.acme.io/mcp"
_AS_BASE = "https://auth.acme.io"
_DOCUMENT_CLIENT_ID = f"{_API_URL}/gateways/mcps/oauth/client-metadata.json"

_PRM = {
    "resource": "https://mcp.acme.io/",
    "authorization_servers": [f"{_AS_BASE}/"],
    "scopes_supported": ["read", "write"],
}


def _metadata(*, issuer: str = f"{_AS_BASE}/", **extra) -> Dict:
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{_AS_BASE}/authorize",
        "token_endpoint": f"{_AS_BASE}/token",
        **extra,
    }


class _AuthorizationServer:
    """Answers discovery, registration and the token endpoint, and keeps what it saw."""

    def __init__(
        self,
        *,
        metadata: Dict,
        prm: Optional[Dict] = _PRM,
        prm_status: int = 200,
        origin_metadata: Optional[Dict] = None,
    ) -> None:
        self.metadata = metadata
        self.prm = prm
        self.prm_status = prm_status
        self.origin_metadata = origin_metadata
        self.registrations: List[Dict] = []
        self.token_requests: List[httpx.Request] = []
        self.paths: List[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        # The egress layer dials a pinned address and names the host in the header.
        host, path = request.headers["host"], request.url.path
        self.paths.append(f"{host}{path}")
        if path.startswith("/.well-known/oauth-protected-resource"):
            if self.prm is None:
                return httpx.Response(404)
            return httpx.Response(self.prm_status, json=self.prm)
        if path == "/.well-known/oauth-authorization-server":
            if host == "mcp.acme.io":
                if self.origin_metadata is None:
                    return httpx.Response(404)
                return httpx.Response(200, json=self.origin_metadata)
            return httpx.Response(200, json=self.metadata)
        if path == "/register":
            body = json.loads(request.content)
            self.registrations.append(body)
            return httpx.Response(201, json={**body, "client_id": "registered-client"})
        if path == "/token":
            self.token_requests.append(request)
            return httpx.Response(
                200,
                json={
                    "access_token": f"access-{len(self.token_requests)}",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "refresh_token": "refresh-one",
                },
            )
        return httpx.Response(404)


def _public(_hostname: str) -> List[str]:
    return ["93.184.216.34"]


def _service(
    server: _AuthorizationServer,
    *,
    resolve: Callable[[str], List[str]] = _public,
):
    dao = _FakeSecretsDAO()
    attempts = InMemoryMCPOAuthAttemptsDAO()
    endpoints = InMemoryMCPEndpoints(attempts=attempts)
    service = MCPOAuthConnectService(
        vault_service=VaultService(secrets_dao=dao),
        client=MCPOAuthClient(transport=httpx.MockTransport(server)),
        api_url=_API_URL,
        attempts_dao=attempts,
        endpoints_dao=endpoints,
        resolve=resolve,
    )
    return service, dao, endpoints


def _client_id_of(authorization_url: str) -> str:
    return parse_qs(urlparse(authorization_url).query)["client_id"][0]


async def _begin(service, *, endpoint_id: UUID, project_id: UUID, oauth_config=None):
    return await service.begin(
        project_id=project_id,
        user_id=uuid4(),
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
        oauth_config=oauth_config,
    )


async def _project_secret(dao: _FakeSecretsDAO, project_id: UUID, value: str) -> UUID:
    record = await dao.create(
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id),
        create_secret_dto=CreateSecretDTO(
            header=Header(name="OAuth app secret"),
            secret=SecretDTO(
                kind=SecretKind.CUSTOM_SECRET,
                data=CustomSecretDTO(
                    secret=CustomSecretSettingsDTO(
                        format=CustomSecretFormat.TEXT, content=value
                    )
                ),
            ),
        ),
    )
    return record.id


def _put_endpoint(endpoints, endpoint_id: UUID, oauth_config: MCPOAuthConfig) -> None:
    endpoints.put(
        MCPEndpoint(
            id=endpoint_id,
            slug="acme",
            auth_mode=GatewayAuthScheme.OAUTH,
            data=MCPEndpointData(
                route=MCPEndpointRoute(base_url=_SERVER_URL),
                oauth_config=oauth_config,
            ),
        )
    )


# ---------------------------------------------------------------------------
# Which client a connection signs in as
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_client_the_person_entered_comes_before_every_other_option():
    server = _AuthorizationServer(
        metadata=_metadata(
            registration_endpoint=f"{_AS_BASE}/register",
            client_id_metadata_document_supported=True,
        )
    )
    service, _dao, _endpoints = _service(server)

    start = await _begin(
        service,
        endpoint_id=uuid4(),
        project_id=uuid4(),
        oauth_config=MCPOAuthConfig(client_id="app-from-github"),
    )

    assert _client_id_of(start.authorization_url) == "app-from-github"
    assert server.registrations == []


@pytest.mark.asyncio
async def test_a_stored_registration_comes_before_the_metadata_document():
    """A connection that works with a registered client keeps that client, even after
    the authorization server starts accepting metadata documents."""
    server = _AuthorizationServer(
        metadata=_metadata(registration_endpoint=f"{_AS_BASE}/register")
    )
    service, _dao, _endpoints = _service(server)
    project_id = uuid4()

    first = await _begin(service, endpoint_id=uuid4(), project_id=project_id)
    server.metadata["client_id_metadata_document_supported"] = True
    second = await _begin(service, endpoint_id=uuid4(), project_id=project_id)

    assert _client_id_of(first.authorization_url) == "registered-client"
    assert _client_id_of(second.authorization_url) == "registered-client"
    assert len(server.registrations) == 1


@pytest.mark.asyncio
async def test_the_metadata_document_is_used_only_where_it_is_advertised():
    server = _AuthorizationServer(
        metadata=_metadata(
            registration_endpoint=f"{_AS_BASE}/register",
            client_id_metadata_document_supported=True,
        )
    )
    service, _dao, _endpoints = _service(server)

    start = await _begin(service, endpoint_id=uuid4(), project_id=uuid4())

    assert _client_id_of(start.authorization_url) == _DOCUMENT_CLIENT_ID
    assert server.registrations == []


@pytest.mark.asyncio
async def test_registration_is_used_where_the_metadata_document_is_not_advertised():
    server = _AuthorizationServer(
        metadata=_metadata(registration_endpoint=f"{_AS_BASE}/register")
    )
    service, _dao, _endpoints = _service(server)

    start = await _begin(service, endpoint_id=uuid4(), project_id=uuid4())

    assert _client_id_of(start.authorization_url) == "registered-client"


@pytest.mark.asyncio
async def test_a_server_with_neither_needs_a_client_the_person_registers():
    """GitHub (#6985): no registration endpoint and no metadata documents. The URL
    client id used to be sent anyway, and the provider refused it in its own page."""
    service, _dao, _endpoints = _service(_AuthorizationServer(metadata=_metadata()))

    with pytest.raises(MCPOAuthRegistrationUnavailableError) as refusal:
        await _begin(service, endpoint_id=uuid4(), project_id=uuid4())

    assert "register yourself" in str(refusal.value)


@pytest.mark.asyncio
async def test_registration_says_the_callback_is_a_web_page():
    server = _AuthorizationServer(
        metadata=_metadata(registration_endpoint=f"{_AS_BASE}/register")
    )
    service, _dao, _endpoints = _service(server)

    await _begin(service, endpoint_id=uuid4(), project_id=uuid4())

    assert server.registrations[0]["application_type"] == "web"


# ---------------------------------------------------------------------------
# A client the person registered with the provider
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_client_the_person_entered_completes_with_its_secret_from_the_vault():
    server = _AuthorizationServer(metadata=_metadata())
    service, dao, endpoints = _service(server)
    project_id, endpoint_id = uuid4(), uuid4()
    secret_id = await _project_secret(dao, project_id, "app-secret-one")
    config = MCPOAuthConfig(
        client_id="app-from-github",
        client_secret_id=secret_id,
        token_endpoint_auth_method="client_secret_post",
    )
    _put_endpoint(endpoints, endpoint_id, config)

    start = await _begin(
        service, endpoint_id=endpoint_id, project_id=project_id, oauth_config=config
    )
    attempt = await service.claim(
        state=start.state,
        caller_user_id=(await service.lookup(state=start.state)).user_id,
    )
    await service.complete(attempt=attempt, code="code-one")

    form = parse_qs(server.token_requests[0].content.decode())
    assert form["client_id"] == ["app-from-github"]
    assert form["client_secret"] == ["app-secret-one"]
    grant = await SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
    ).get_grant()
    assert grant.client_id == "app-from-github"
    # The secret is read for the request; it is not copied into a registration row.
    assert not [r for _, r in dao.records if r.kind == SecretKind.OAUTH_PROVIDER]


@pytest.mark.asyncio
async def test_a_client_secret_that_is_gone_is_refused_before_consent():
    service, _dao, _endpoints = _service(_AuthorizationServer(metadata=_metadata()))

    with pytest.raises(SecretInvalidError):
        await _begin(
            service,
            endpoint_id=uuid4(),
            project_id=uuid4(),
            oauth_config=MCPOAuthConfig(
                client_id="app-from-github", client_secret_id=uuid4()
            ),
        )


async def _store_grant(
    service, *, project_id: UUID, endpoint_id: UUID, client_id: str
) -> None:
    """An expired grant issued to `client_id`, as a consent would have written it."""
    await SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server=f"{_AS_BASE}/",
    ).write_tokens(
        OAuthToken(
            access_token="access-old", refresh_token="refresh-old", expires_in=-10
        ),
        client_id=client_id,
    )


@pytest.mark.asyncio
async def test_a_grant_from_an_entered_client_is_renewed_as_that_client():
    server = _AuthorizationServer(metadata=_metadata())
    service, dao, endpoints = _service(server)
    project_id, endpoint_id = uuid4(), uuid4()
    secret_id = await _project_secret(dao, project_id, "app-secret-one")
    _put_endpoint(
        endpoints,
        endpoint_id,
        MCPOAuthConfig(
            client_id="app-from-github",
            client_secret_id=secret_id,
            token_endpoint_auth_method="client_secret_post",
        ),
    )
    await _store_grant(
        service,
        project_id=project_id,
        endpoint_id=endpoint_id,
        client_id="app-from-github",
    )

    await service.refresh_grant(
        project_id=project_id, endpoint_id=endpoint_id, server_url=_SERVER_URL
    )

    form = parse_qs(server.token_requests[0].content.decode())
    assert form["grant_type"] == ["refresh_token"]
    assert form["client_id"] == ["app-from-github"]
    assert form["client_secret"] == ["app-secret-one"]


@pytest.mark.asyncio
async def test_a_grant_is_not_renewed_by_a_client_entered_after_it_was_issued():
    """The grant was issued to one app, and the person has since entered another. The
    new app is not presented with the old grant's refresh token: the authorization
    server would refuse it, so the person connects again."""
    server = _AuthorizationServer(metadata=_metadata())
    service, _dao, endpoints = _service(server)
    project_id, endpoint_id = uuid4(), uuid4()
    _put_endpoint(endpoints, endpoint_id, MCPOAuthConfig(client_id="app-changed"))
    await _store_grant(
        service,
        project_id=project_id,
        endpoint_id=endpoint_id,
        client_id="app-from-github",
    )

    with pytest.raises(MCPOAuthRegistrationUnresolvablePinError):
        await service.refresh_grant(
            project_id=project_id, endpoint_id=endpoint_id, server_url=_SERVER_URL
        )

    assert server.token_requests == []


@pytest.mark.asyncio
async def test_a_grant_from_the_metadata_document_is_renewed_as_the_document():
    """Not as a registration the same issuer may also hold."""
    server = _AuthorizationServer(metadata=_metadata())
    service, _dao, _endpoints = _service(server)
    project_id, endpoint_id = uuid4(), uuid4()
    await SecretsTokenStorage(
        vault_service=service.vault_service,
        project_id=project_id,
        server_url=_SERVER_URL,
        authorization_server=f"{_AS_BASE}/",
        redirect_uri=callback_redirect_uri(api_url=_API_URL),
    ).set_client_info(
        OAuthClientInformationFull(
            client_id="registered-client",
            client_secret="registered-secret",
            redirect_uris=[callback_redirect_uri(api_url=_API_URL)],
        )
    )
    await _store_grant(
        service,
        project_id=project_id,
        endpoint_id=endpoint_id,
        client_id=_DOCUMENT_CLIENT_ID,
    )

    await service.refresh_grant(
        project_id=project_id, endpoint_id=endpoint_id, server_url=_SERVER_URL
    )

    form = parse_qs(server.token_requests[0].content.decode())
    assert form["client_id"] == [_DOCUMENT_CLIENT_ID]
    assert "client_secret" not in form


@pytest.mark.asyncio
async def test_a_consent_does_not_finish_once_the_connection_selects_another_client():
    """Checked under the connection's lock, next to the mode and the address, so it
    holds however the client was changed."""
    server = _AuthorizationServer(
        metadata=_metadata(registration_endpoint=f"{_AS_BASE}/register")
    )
    service, _dao, endpoints = _service(server)
    project_id, endpoint_id = uuid4(), uuid4()
    start = await _begin(service, endpoint_id=endpoint_id, project_id=project_id)
    attempt = await service.claim(
        state=start.state,
        caller_user_id=(await service.lookup(state=start.state)).user_id,
    )
    _put_endpoint(endpoints, endpoint_id, MCPOAuthConfig(client_id="app-from-github"))

    with pytest.raises(MCPOAuthAttemptCancelledError):
        await service.complete(attempt=attempt, code="code-one")

    assert endpoints.endpoints[endpoint_id].secret_id is None
    assert (await service.lookup(state=start.state)).status == "cancelled"


def test_a_client_secret_or_method_needs_a_client_id():
    with pytest.raises(ValidationError):
        MCPOAuthConfig(client_secret_id=uuid4())
    with pytest.raises(ValidationError):
        MCPOAuthConfig(token_endpoint_auth_method="client_secret_basic")


def test_the_auth_method_has_to_agree_with_the_secret():
    with pytest.raises(ValidationError):
        MCPOAuthConfig(
            client_id="app", client_secret_id=uuid4(), token_endpoint_auth_method="none"
        )
    with pytest.raises(ValidationError):
        MCPOAuthConfig(client_id="app", token_endpoint_auth_method="client_secret_post")
    assert MCPOAuthConfig(client_id="app", token_endpoint_auth_method="none")


# ---------------------------------------------------------------------------
# How the client authenticates at the token endpoint
# ---------------------------------------------------------------------------


def _token_client(requests: List[httpx.Request]) -> MCPOAuthClient:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, json={"access_token": "access-one", "token_type": "Bearer"}
        )

    return MCPOAuthClient(transport=httpx.MockTransport(handler))


def _client_info(method: Optional[str], secret: Optional[str] = "app-secret-one"):
    return OAuthClientInformationFull(
        client_id="app-one",
        client_secret=secret,
        token_endpoint_auth_method=method,
    )


async def _exchange(client: MCPOAuthClient, client_info) -> None:
    await client.exchange_token(
        token_endpoint=f"{_AS_BASE}/token",
        code="code-one",
        code_verifier="verifier-one",
        redirect_uri=callback_redirect_uri(api_url=_API_URL),
        client_info=client_info,
    )


async def _refresh(client: MCPOAuthClient, client_info) -> None:
    await client.refresh_token(
        token_endpoint=f"{_AS_BASE}/token",
        refresh_token="refresh-one",
        client_info=client_info,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("send", [_exchange, _refresh])
async def test_client_secret_basic_sends_the_credentials_as_basic_auth(send):
    requests: List[httpx.Request] = []

    await send(_token_client(requests), _client_info("client_secret_basic"))

    expected = base64.b64encode(b"app-one:app-secret-one").decode()
    assert requests[0].headers["authorization"] == f"Basic {expected}"
    form = parse_qs(requests[0].content.decode())
    assert "client_id" not in form
    assert "client_secret" not in form


@pytest.mark.asyncio
@pytest.mark.parametrize("send", [_exchange, _refresh])
async def test_client_secret_post_sends_the_credentials_in_the_body(send):
    requests: List[httpx.Request] = []

    await send(_token_client(requests), _client_info("client_secret_post"))

    assert "authorization" not in requests[0].headers
    form = parse_qs(requests[0].content.decode())
    assert form["client_id"] == ["app-one"]
    assert form["client_secret"] == ["app-secret-one"]


@pytest.mark.asyncio
@pytest.mark.parametrize("send", [_exchange, _refresh])
async def test_none_sends_only_the_client_id(send):
    requests: List[httpx.Request] = []

    await send(_token_client(requests), _client_info("none", secret=None))

    assert "authorization" not in requests[0].headers
    form = parse_qs(requests[0].content.decode())
    assert form["client_id"] == ["app-one"]
    assert "client_secret" not in form


@pytest.mark.asyncio
@pytest.mark.parametrize("send", [_exchange, _refresh])
async def test_a_registration_that_names_no_method_takes_the_rfc_default(send):
    """RFC 7591 s2: an unnamed method is `client_secret_basic` for a client with a
    secret, and a client issued none is public."""
    with_secret: List[httpx.Request] = []
    await send(_token_client(with_secret), _client_info(None))
    assert with_secret[0].headers["authorization"].startswith("Basic ")

    without: List[httpx.Request] = []
    await send(_token_client(without), _client_info(None, secret=None))
    assert "authorization" not in without[0].headers
    assert parse_qs(without[0].content.decode())["client_id"] == ["app-one"]


@pytest.mark.asyncio
@pytest.mark.parametrize("send", [_exchange, _refresh])
@pytest.mark.parametrize(
    "method, secret, refusal",
    [
        ("private_key_jwt", "app-secret-one", "does not support"),
        ("none", "app-secret-one", "has a client secret"),
        ("client_secret_basic", None, "has no client secret"),
        ("client_secret_post", None, "has no client secret"),
    ],
)
async def test_a_method_that_cannot_be_honored_is_refused_before_anything_is_sent(
    send, method, secret, refusal
):
    requests: List[httpx.Request] = []

    with pytest.raises(MCPOAuthTokenExchangeError, match=refusal):
        await send(_token_client(requests), _client_info(method, secret=secret))

    assert requests == []


def test_basic_credentials_are_form_encoded_before_they_are_joined():
    """RFC 6749 s2.3.1: a colon in the id or the secret must not split the pair."""
    _data, headers = client_authentication(
        OAuthClientInformationFull(
            client_id="app:one",
            client_secret="secret one",
            token_endpoint_auth_method="client_secret_basic",
        ),
        {},
    )

    decoded = base64.b64decode(headers["Authorization"].split()[1]).decode()
    assert decoded == "app%3Aone:secret+one"


# ---------------------------------------------------------------------------
# Discovery at the server's origin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_server_with_no_protected_resource_document_is_its_own_issuer():
    server = _AuthorizationServer(
        metadata=_metadata(),
        prm=None,
        origin_metadata={
            "issuer": "https://mcp.acme.io",
            "authorization_endpoint": "https://mcp.acme.io/authorize",
            "token_endpoint": "https://mcp.acme.io/token",
            "registration_endpoint": "https://mcp.acme.io/register",
        },
    )
    client = MCPOAuthClient(transport=httpx.MockTransport(server))

    discovery = await client.discover(server_url=_SERVER_URL)

    assert discovery.authorization_server == "https://mcp.acme.io"
    assert discovery.token_endpoint == "https://mcp.acme.io/token"
    # No document, so no resource identifier to send.
    assert discovery.resource is None


@pytest.mark.asyncio
async def test_the_origin_is_not_tried_after_a_document_names_another_resource():
    server = _AuthorizationServer(
        metadata=_metadata(),
        prm={**_PRM, "resource": "https://elsewhere.example/"},
        origin_metadata={
            "issuer": "https://mcp.acme.io",
            "authorization_endpoint": "https://mcp.acme.io/authorize",
            "token_endpoint": "https://mcp.acme.io/token",
        },
    )
    client = MCPOAuthClient(transport=httpx.MockTransport(server))

    with pytest.raises(MCPOAuthDiscoveryError, match="different resource"):
        await client.discover(server_url=_SERVER_URL)

    assert "mcp.acme.io/.well-known/oauth-authorization-server" not in server.paths


@pytest.mark.asyncio
async def test_the_origin_is_not_tried_after_a_document_that_does_not_parse():
    server = _AuthorizationServer(
        metadata=_metadata(),
        prm={"resource": "https://mcp.acme.io/"},
        origin_metadata={
            "issuer": "https://mcp.acme.io",
            "authorization_endpoint": "https://mcp.acme.io/authorize",
            "token_endpoint": "https://mcp.acme.io/token",
        },
    )
    client = MCPOAuthClient(transport=httpx.MockTransport(server))

    with pytest.raises(MCPOAuthDiscoveryError, match="could not be read"):
        await client.discover(server_url=_SERVER_URL)

    assert "mcp.acme.io/.well-known/oauth-authorization-server" not in server.paths


@pytest.mark.asyncio
async def test_the_origin_is_not_tried_after_the_named_issuer_fails_its_pin():
    server = _AuthorizationServer(
        metadata=_metadata(issuer="https://impostor.example/"),
        origin_metadata={
            "issuer": "https://mcp.acme.io",
            "authorization_endpoint": "https://mcp.acme.io/authorize",
            "token_endpoint": "https://mcp.acme.io/token",
        },
    )
    client = MCPOAuthClient(transport=httpx.MockTransport(server))

    with pytest.raises(MCPOAuthDiscoveryError, match="different issuer"):
        await client.discover(server_url=_SERVER_URL)

    assert "mcp.acme.io/.well-known/oauth-authorization-server" not in server.paths


@pytest.mark.asyncio
async def test_the_origin_document_has_to_name_the_origin_as_its_issuer():
    server = _AuthorizationServer(
        metadata=_metadata(),
        prm=None,
        origin_metadata={
            "issuer": "https://impostor.example",
            "authorization_endpoint": "https://mcp.acme.io/authorize",
            "token_endpoint": "https://mcp.acme.io/token",
        },
    )
    client = MCPOAuthClient(transport=httpx.MockTransport(server))

    with pytest.raises(MCPOAuthDiscoveryError, match="different issuer"):
        await client.discover(server_url=_SERVER_URL)
