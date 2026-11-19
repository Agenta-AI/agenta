"""The account name of a person's own OAuth sign-in to a project MCP server.

At the callback of a person's sign-in, the name comes from the ID token in the token
response, else from the user info endpoint the issuer's metadata names. It is stored on
the person's grant, kept across renewals, and read back only in that person's sign-in
state. A missing name, a failed read or a slow read stores nothing and never fails the
sign-in.
"""

import asyncio
import base64
import json
from uuid import uuid4

import httpx
import pytest
from mcp.shared.auth import OAuthToken

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.core.gateways.mcps.oauth import client as client_module
from oss.src.core.gateways.mcps.oauth.client import (
    account_name_from_claims,
    account_name_from_id_token,
)
from oss.src.core.gateways.mcps.oauth.dtos import MCPUserSignIn
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage, grant_slug
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_service import (
    _AS_BASE,
    _AS_METADATA,
    _SERVER_URL,
    _mock_as_handler,
    _refreshing_as_handler,
)
from oss.tests.pytest.unit.gateways.test_gateways_mcp_oauth_user_sign_in import (
    PROJECT,
    _server,
    _service_with,
    _token,
)

_USERINFO = f"{_AS_BASE}/userinfo"


def _id_token(claims) -> str:
    def part(value) -> str:
        raw = base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
        return raw.rstrip("=")

    return f"{part({'alg': 'RS256'})}.{part(claims)}.signature"


def _handler(*, id_token=None, userinfo=None, userinfo_in="openid", seen=None):
    """The test authorization server, with an ID token in the token response and a
    user info endpoint named in its OpenID document (or in its OAuth one) on request."""
    base = _mock_as_handler()

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if seen is not None:
            seen.append((path, request.headers.get("authorization")))
        if path == "/token" and id_token is not None:
            body = json.loads(base(request).content)
            return httpx.Response(200, json={**body, "id_token": id_token})
        if userinfo is not None:
            named = {**_AS_METADATA, "userinfo_endpoint": _USERINFO}
            if path == "/.well-known/oauth-authorization-server" and (
                userinfo_in == "oauth"
            ):
                return httpx.Response(200, json=named)
            if path == "/.well-known/openid-configuration" and userinfo_in == "openid":
                return httpx.Response(200, json=named)
            if path == "/userinfo":
                return userinfo(request)
        return base(request)

    return handler


async def _sign_in(handler, *, owner_kind=SecretOwnerKind.USER):
    """A full sign-in, begin to callback. Returns the stored grant settings."""
    service, vault, _ = _service_with(handler)
    organization_id, person, endpoint_id = uuid4(), uuid4(), uuid4()
    start = await service.begin(
        project_id=PROJECT,
        user_id=person,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        scopes=["read"],
        owner_kind=owner_kind,
    )
    attempt = await service.claim(state=start.state, caller_user_id=person)
    await service.complete(
        attempt=attempt,
        code="code-1",
        organization_id=organization_id if owner_kind == SecretOwnerKind.USER else None,
    )
    if owner_kind == SecretOwnerKind.USER:
        row = vault.person_rows[(organization_id, person, grant_slug(endpoint_id))]
    else:
        [row] = [
            r for _, r in vault.secrets_dao.records if r.slug == grant_slug(endpoint_id)
        ]
    return row.data.grant


# --- reading the name ------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_name_in_the_id_token_is_stored_and_no_user_info_is_read():
    seen = []
    grant = await _sign_in(
        _handler(
            id_token=_id_token({"sub": "u1", "email": "lena@acme.io", "name": "Lena"}),
            userinfo=lambda _r: httpx.Response(500),
            seen=seen,
        )
    )

    assert grant.account_name == "lena@acme.io"
    assert "/userinfo" not in [path for path, _ in seen]


@pytest.mark.asyncio
async def test_the_name_is_read_from_the_user_info_endpoint_with_the_new_token():
    seen = []
    grant = await _sign_in(
        _handler(
            userinfo=lambda _r: httpx.Response(
                200, json={"sub": "u1", "preferred_username": "lena"}
            ),
            seen=seen,
        )
    )

    assert grant.account_name == "lena"
    assert ("/userinfo", "Bearer tok-xyz") in seen


@pytest.mark.asyncio
async def test_a_user_info_endpoint_in_the_oauth_metadata_is_read_too():
    grant = await _sign_in(
        _handler(
            userinfo=lambda _r: httpx.Response(200, json={"name": "Lena at Acme"}),
            userinfo_in="oauth",
        )
    )

    assert grant.account_name == "Lena at Acme"


@pytest.mark.asyncio
async def test_no_name_from_the_server_stores_none():
    grant = await _sign_in(_handler())

    assert grant.account_name is None
    assert grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_a_failed_user_info_read_stores_no_name_and_the_sign_in_succeeds():
    grant = await _sign_in(_handler(userinfo=lambda _r: httpx.Response(500)))

    assert grant.account_name is None
    assert grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_a_user_info_answer_that_is_not_json_stores_no_name():
    grant = await _sign_in(
        _handler(userinfo=lambda _r: httpx.Response(200, content=b"<html>"))
    )

    assert grant.account_name is None
    assert grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_a_slow_user_info_read_stores_no_name_and_the_sign_in_succeeds(
    monkeypatch,
):
    monkeypatch.setattr(client_module, "_ACCOUNT_NAME_TIMEOUT_SECONDS", 0.05)

    async def slow(*_args, **_kwargs):
        await asyncio.sleep(1)
        return "too late"

    monkeypatch.setattr(client_module.MCPOAuthClient, "_read_account_name", slow)

    grant = await _sign_in(_handler())

    assert grant.account_name is None
    assert grant.access_token == "tok-xyz"


@pytest.mark.asyncio
async def test_the_projects_own_sign_in_reads_no_name():
    seen = []
    grant = await _sign_in(
        _handler(
            userinfo=lambda _r: httpx.Response(200, json={"email": "x@acme.io"}),
            seen=seen,
        ),
        owner_kind=SecretOwnerKind.PROJECT,
    )

    assert grant.account_name is None
    assert "/userinfo" not in [path for path, _ in seen]


@pytest.mark.asyncio
async def test_a_user_info_endpoint_from_another_issuer_is_not_called():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    **_AS_METADATA,
                    "issuer": "https://elsewhere.example/",
                    "userinfo_endpoint": _USERINFO,
                },
            )
        return _mock_as_handler()(request)

    grant = await _sign_in(handler)

    assert grant.account_name is None
    assert "/userinfo" not in seen


@pytest.mark.asyncio
async def test_an_unusable_id_token_does_not_fail_the_sign_in():
    grant = await _sign_in(_handler(id_token={"not": "a token"}))

    assert grant.account_name is None
    assert grant.access_token == "tok-xyz"


# --- keeping and returning the name ----------------------------------------------- #


@pytest.mark.asyncio
async def test_a_renewal_keeps_the_account_name():
    service, vault, _ = _service_with(_refreshing_as_handler(calls=[]))
    organization_id, person, endpoint_id = uuid4(), uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=person)
    await SecretsTokenStorage(
        vault_service=vault,
        project_id=PROJECT,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server="https://auth.acme.io/",
        owner=owner,
    ).write_tokens(
        OAuthToken(
            access_token="stale",
            token_type="Bearer",
            expires_in=-60,
            refresh_token="renew-me",
        ),
        account_name="lena@acme.io",
    )

    await service.refresh_grant(
        project_id=PROJECT,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        owner=owner,
    )

    renewed = vault.person_rows[(organization_id, person, grant_slug(endpoint_id))]
    assert renewed.data.grant.access_token == "renewed-1"
    assert renewed.data.grant.account_name == "lena@acme.io"


@pytest.mark.asyncio
async def test_a_renewal_with_an_unusable_id_token_keeps_the_grant():
    refreshing = _refreshing_as_handler(calls=[])

    def handler(request: httpx.Request) -> httpx.Response:
        response = refreshing(request)
        if request.url.path == "/token":
            return httpx.Response(200, json={**response.json(), "id_token": 42})
        return response

    service, vault, _ = _service_with(handler)
    organization_id, person, endpoint_id = uuid4(), uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=person)
    await SecretsTokenStorage(
        vault_service=vault,
        project_id=PROJECT,
        server_url=_SERVER_URL,
        endpoint_id=endpoint_id,
        authorization_server="https://auth.acme.io/",
        owner=owner,
    ).write_tokens(
        OAuthToken(
            access_token="stale",
            token_type="Bearer",
            expires_in=-60,
            refresh_token="renew-me",
        ),
        account_name="lena@acme.io",
    )

    await service.refresh_grant(
        project_id=PROJECT,
        endpoint_id=endpoint_id,
        server_url=_SERVER_URL,
        owner=owner,
    )

    renewed = vault.person_rows[(organization_id, person, grant_slug(endpoint_id))]
    assert renewed.data.grant.access_token == "renewed-1"
    assert renewed.data.grant.account_name == "lena@acme.io"


@pytest.mark.asyncio
async def test_each_person_reads_only_their_own_account_name():
    service, vault, _ = _service_with(_mock_as_handler())
    server = _server(MCPAuthScheme.OAUTH, service)
    organization_id, lena, omar = uuid4(), uuid4(), uuid4()
    for person, name in ((lena, "lena@acme.io"), (omar, "omar@acme.io")):
        await SecretsTokenStorage(
            vault_service=vault,
            project_id=PROJECT,
            server_url=_SERVER_URL,
            endpoint_id=server.id,
            owner=SecretOwner.for_user(organization_id=organization_id, user_id=person),
        ).write_tokens(
            OAuthToken(access_token=f"a-{name}", token_type="Bearer"),
            account_name=name,
        )

    for person, name in ((lena, "lena@acme.io"), (omar, "omar@acme.io")):
        sign_ins = await service.sign_ins(
            organization_id=organization_id, user_id=person, endpoints=[server]
        )
        assert sign_ins == {server.id: MCPUserSignIn(is_ready=True, account_name=name)}


@pytest.mark.asyncio
async def test_a_token_sign_in_has_no_account_name():
    service, _, _ = _service_with(_mock_as_handler())
    server = _server(MCPAuthScheme.API_KEY, service)
    organization_id, person = uuid4(), uuid4()
    await _token(service, organization_id=organization_id, person=person, server=server)

    sign_ins = await service.sign_ins(
        organization_id=organization_id, user_id=person, endpoints=[server]
    )

    assert sign_ins == {server.id: MCPUserSignIn(is_ready=True)}


# --- the claims ------------------------------------------------------------------- #


def test_the_address_wins_over_the_user_name_and_the_display_name():
    assert (
        account_name_from_claims(
            {"name": "Lena", "preferred_username": "lena", "email": "lena@acme.io"}
        )
        == "lena@acme.io"
    )
    assert account_name_from_claims({"name": "Lena", "preferred_username": "lena"}) == (
        "lena"
    )
    assert account_name_from_claims({"name": "  Lena  "}) == "Lena"


def test_claims_with_no_usable_name_give_none():
    assert account_name_from_claims({"sub": "u1"}) is None
    assert account_name_from_claims({"email": ""}) is None
    assert account_name_from_claims({"email": 42}) is None
    assert account_name_from_claims(["lena"]) is None
    assert account_name_from_claims(json.loads('{"email": "\\ud800"}')) is None
    assert (
        account_name_from_claims(json.loads('{"email": "\\ud800", "name": "Lena"}'))
        == "Lena"
    )


def test_a_long_name_is_cut():
    assert len(account_name_from_claims({"name": "x" * 500})) == 200


def test_a_malformed_id_token_gives_no_name():
    assert account_name_from_id_token(None) is None
    assert account_name_from_id_token("not-a-jwt") is None
    assert account_name_from_id_token("a.%%%.c") is None
    assert account_name_from_id_token("a.bm90LWpzb24.c") is None
    deep = base64.urlsafe_b64encode(b"[" * 100_000).decode().rstrip("=")
    assert account_name_from_id_token(f"a.{deep}.c") is None
