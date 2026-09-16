"""Unit tests for `SecretsTokenStorage`.

A real `VaultService` over an in-memory fake `SecretsDAOInterface` — no Postgres, no
encryption key, no network — matching `unit/secrets/test_services.py`'s own fake-DAO
pattern.
"""

from __future__ import annotations

from typing import List, Optional, Tuple
from uuid import UUID, uuid4

import pytest
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from oss.src.core.gateways.mcps.oauth.registration import registration_covers
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthRegistrationUnresolvablePinError,
)
from oss.src.core.gateways.mcps.oauth.storage import (
    registration_slug,
    SecretsTokenStorage,
    _issuer_slug as issuer_slug_for_test,
    grant_slug,
)
from oss.src.core.secrets.dtos import (
    OAuthGrantSettingsDTO,
    OAuthProviderDTO,
    OAuthProviderSettingsDTO,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Header


class _FakeSecretsDAO:
    def __init__(self) -> None:
        self.records: List[Tuple[UUID, SecretResponseDTO]] = []
        self.create_calls = 0
        self.update_calls = 0

    def _scoped(self, project_id) -> List[SecretResponseDTO]:
        return [r for p, r in self.records if p == project_id]

    async def create(self, *, project_id=None, organization_id=None, create_secret_dto):
        self.create_calls += 1
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
        self.update_calls += 1
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


def _storage(
    *,
    dao: Optional[_FakeSecretsDAO] = None,
    project_id=None,
    server_url="https://mcp.acme.io/",
    endpoint_id=None,
    authorization_server=None,
):
    dao = dao or _FakeSecretsDAO()
    vault = VaultService(secrets_dao=dao)
    storage = SecretsTokenStorage(
        vault_service=vault,
        project_id=project_id or uuid4(),
        server_url=server_url,
        endpoint_id=endpoint_id or uuid4(),
        authorization_server=authorization_server,
    )
    return storage, dao


# --- tokens ------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_get_tokens_returns_none_when_nothing_stored():
    storage, _dao = _storage()

    assert await storage.get_tokens() is None


@pytest.mark.asyncio
async def test_set_then_get_tokens_round_trips():
    storage, _dao = _storage()

    await storage.set_tokens(
        OAuthToken(
            access_token="tok-1",
            refresh_token="ref-1",
            expires_in=3600,
            scope="read write",
        )
    )
    tokens = await storage.get_tokens()

    assert tokens is not None
    assert tokens.access_token == "tok-1"
    assert tokens.refresh_token == "ref-1"
    assert tokens.token_type == "Bearer"
    assert tokens.scope == "read write"
    assert tokens.expires_in is not None and tokens.expires_in > 0


@pytest.mark.asyncio
async def test_second_set_tokens_updates_in_place_not_a_second_row():
    storage, dao = _storage()

    await storage.set_tokens(OAuthToken(access_token="tok-1"))
    await storage.set_tokens(OAuthToken(access_token="tok-2"))

    assert dao.create_calls == 1
    assert dao.update_calls == 1
    tokens = await storage.get_tokens()
    assert tokens is not None
    assert tokens.access_token == "tok-2"


@pytest.mark.asyncio
async def test_two_server_urls_under_one_project_do_not_collide():
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    storage_a, _ = _storage(
        dao=dao, project_id=project_id, server_url="https://a.example/mcp"
    )
    storage_b, _ = _storage(
        dao=dao, project_id=project_id, server_url="https://b.example/mcp"
    )

    await storage_a.set_tokens(OAuthToken(access_token="tok-a"))
    await storage_b.set_tokens(OAuthToken(access_token="tok-b"))

    tokens_a = await storage_a.get_tokens()
    tokens_b = await storage_b.get_tokens()
    assert tokens_a is not None and tokens_a.access_token == "tok-a"
    assert tokens_b is not None and tokens_b.access_token == "tok-b"


@pytest.mark.asyncio
async def test_two_projects_on_the_same_server_url_do_not_collide():
    dao = _FakeSecretsDAO()
    storage_p1, _ = _storage(
        dao=dao, project_id=uuid4(), server_url="https://mcp.acme.io/"
    )
    storage_p2, _ = _storage(
        dao=dao, project_id=uuid4(), server_url="https://mcp.acme.io/"
    )

    await storage_p1.set_tokens(OAuthToken(access_token="tok-p1"))

    assert await storage_p2.get_tokens() is None
    tokens_p1 = await storage_p1.get_tokens()
    assert tokens_p1 is not None and tokens_p1.access_token == "tok-p1"


@pytest.mark.asyncio
async def test_write_tokens_returns_the_written_secret_id():
    storage, _dao = _storage()

    written = await storage.write_tokens(OAuthToken(access_token="tok-1"))

    assert written.id is not None
    grant = await storage.get_tokens()
    assert grant is not None and grant.access_token == "tok-1"


# --- client info --------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_get_client_info_returns_none_when_nothing_stored():
    storage, _dao = _storage()

    assert await storage.get_client_info() is None


@pytest.mark.asyncio
async def test_set_then_get_client_info_round_trips():
    storage, _dao = _storage(authorization_server="https://auth.acme.io/")

    info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-123",
        client_secret="shh",
        scope="read write",
    )
    await storage.set_client_info(info)
    fetched = await storage.get_client_info()

    assert fetched is not None
    assert fetched.client_id == "client-123"
    assert fetched.client_secret == "shh"


@pytest.mark.asyncio
async def test_second_set_client_info_updates_in_place():
    storage, dao = _storage(authorization_server="https://auth.acme.io/")

    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
            client_id="client-1",
        )
    )
    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
            client_id="client-2",
        )
    )

    assert dao.create_calls == 1
    assert dao.update_calls == 1
    fetched = await storage.get_client_info()
    assert fetched is not None and fetched.client_id == "client-2"


@pytest.mark.asyncio
async def test_client_info_falls_back_to_server_url_before_issuer_is_known():
    storage, _dao = _storage(authorization_server=None)

    info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-preregistration",
    )
    await storage.set_client_info(info)
    fetched = await storage.get_client_info()

    assert fetched is not None and fetched.client_id == "client-preregistration"


# --- a grant belongs to one connection ------------------------------------------ #


@pytest.mark.asyncio
async def test_two_connections_at_one_url_hold_separate_grants():
    """Two accounts at the same MCP server are two connections, and each keeps its own
    tokens.

    Under the previous key the grant's slug was a `uuid5` of the server URL, so the
    second connection's consent found the first one's row and updated it. Both
    connections then presented the second account's token, and the first account's
    tokens were gone with nothing reported.
    """
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    url = "https://mcp.acme.io/"
    storage_a, _ = _storage(dao=dao, project_id=project_id, server_url=url)
    storage_b, _ = _storage(dao=dao, project_id=project_id, server_url=url)

    await storage_a.set_tokens(OAuthToken(access_token="tok-account-a"))
    await storage_b.set_tokens(OAuthToken(access_token="tok-account-b"))

    # Two rows, not one updated twice.
    assert dao.create_calls == 2
    assert dao.update_calls == 0

    tokens_a = await storage_a.get_tokens()
    tokens_b = await storage_b.get_tokens()
    assert tokens_a is not None and tokens_a.access_token == "tok-account-a"
    assert tokens_b is not None and tokens_b.access_token == "tok-account-b"


@pytest.mark.asyncio
async def test_the_grant_slug_is_the_connection_not_the_server_url():
    endpoint_id = uuid4()
    same_endpoint_other_url, dao = _storage(
        server_url="https://moved.example/mcp", endpoint_id=endpoint_id
    )

    await same_endpoint_other_url.set_tokens(OAuthToken(access_token="tok"))

    stored_slug = dao.records[0][1].slug
    assert stored_slug == grant_slug(endpoint_id)
    # The URL is routing; it appears in the payload, never in the key.
    assert "moved" not in stored_slug


@pytest.mark.asyncio
async def test_a_written_grant_records_the_connection_it_belongs_to():
    endpoint_id = uuid4()
    storage, dao = _storage(endpoint_id=endpoint_id)

    await storage.set_tokens(OAuthToken(access_token="tok"))

    assert dao.records[0][1].data.grant.endpoint_id == endpoint_id


@pytest.mark.asyncio
async def test_a_grant_read_ignores_another_connections_row():
    """The lookup addresses one slug, so a project full of other connections' grants is
    not a place a reader can land by accident."""
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    url = "https://mcp.acme.io/"
    other, _ = _storage(dao=dao, project_id=project_id, server_url=url)
    await other.set_tokens(OAuthToken(access_token="tok-other"))

    unconnected, _ = _storage(dao=dao, project_id=project_id, server_url=url)

    assert await unconnected.get_tokens() is None
    assert await unconnected.get_grant() is None


@pytest.mark.asyncio
async def test_a_grant_operation_without_a_connection_is_refused():
    """Only the client-registration half of this class is connection-independent, so a
    storage built for that half must not silently read or write somebody's grant."""
    vault = VaultService(secrets_dao=_FakeSecretsDAO())
    registration_only = SecretsTokenStorage(
        vault_service=vault,
        project_id=uuid4(),
        server_url="https://mcp.acme.io/",
        authorization_server="https://auth.acme.io/",
    )

    with pytest.raises(ValueError):
        await registration_only.get_tokens()
    with pytest.raises(ValueError):
        await registration_only.set_tokens(OAuthToken(access_token="tok"))


@pytest.mark.asyncio
async def test_two_connections_at_one_authorization_server_share_one_registration():
    """A client registration names this deployment to an authorization server. It is not
    an account, so two connections there reuse it rather than minting a second client."""
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    issuer = "https://auth.acme.io/"
    storage_a, _ = _storage(dao=dao, project_id=project_id, authorization_server=issuer)
    storage_b, _ = _storage(dao=dao, project_id=project_id, authorization_server=issuer)

    info = OAuthClientInformationFull(
        redirect_uris=["https://api.agenta.ai/gateways/mcps/connect/callback"],
        client_id="client-shared",
    )
    await storage_a.set_client_info(info)

    fetched = await storage_b.get_client_info()
    assert fetched is not None and fetched.client_id == "client-shared"
    assert dao.create_calls == 1


# ---------------------------------------------------------------------------
# D14: the registration is addressed, not searched for
# ---------------------------------------------------------------------------


class _CountingVault:
    """Counts what the storage asked the vault for. A project listing decrypts every
    secret the project holds, so whether one happens is the claim."""

    def __init__(self, *, by_slug=None, listed=None) -> None:
        self._by_slug = by_slug or {}
        self._listed = listed or []
        self.slug_reads: list = []
        self.listings = 0
        self.written: list = []

    async def get_secret_by_slug(self, *, secret_slug, project_id):
        self.slug_reads.append(secret_slug)
        return self._by_slug.get(secret_slug)

    async def list_secrets(self, *, project_id):
        self.listings += 1
        return list(self._listed)

    async def create_secret(self, *, project_id, create_secret_dto):
        self.written.append(create_secret_dto)
        return SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
        )


def _provider_secret(*, issuer: str, slug: str) -> SecretResponseDTO:
    """A registration this module wrote, which is what carries the provenance mark."""
    return SecretResponseDTO(
        id=uuid4(),
        slug=slug,
        kind=SecretKind.OAUTH_PROVIDER,
        header=Header(name="OAuth client"),
        data=OAuthProviderDTO(
            provider=OAuthProviderSettingsDTO(
                client_id="client-1",
                client_secret="placeholder-client-secret",
                issuer_url=issuer,
                scopes=["tools:call"],
                extra={
                    "client_info": {
                        "client_id": "client-1",
                        "redirect_uris": [_REDIRECT_URI],
                    },
                    "registered_by": "agenta-mcp-oauth",
                },
            )
        ),
    )


_ISSUER = "https://auth.example.com/"
_REDIRECT_URI = "https://api.example.com/gateways/mcps/connect/callback"


def _storage_over(vault) -> SecretsTokenStorage:
    return SecretsTokenStorage(
        vault_service=vault,
        project_id=uuid4(),
        server_url="https://mcp.example.com/",
        authorization_server=_ISSUER,
    )


@pytest.mark.asyncio
async def test_a_registration_is_read_by_slug_without_listing_the_project():
    slug = issuer_slug_for_test(_ISSUER)
    vault = _CountingVault(by_slug={slug: _provider_secret(issuer=_ISSUER, slug=slug)})

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "client-1"
    assert vault.slug_reads == [slug]
    assert vault.listings == 0


@pytest.mark.asyncio
async def test_a_registration_stored_under_another_slug_is_still_found():
    """The fallback is not dead code: losing track of a registration means registering a
    fresh client at a server that may rate limit it."""
    vault = _CountingVault(
        listed=[_provider_secret(issuer=_ISSUER, slug="legacy-oauth-provider")]
    )

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "client-1"
    assert vault.listings == 1


@pytest.mark.asyncio
async def test_a_row_at_the_slug_for_another_issuer_is_not_accepted():
    """The slug is derived from the issuer, so this should not happen — but a row that
    does not name this issuer is not this issuer's client whatever it is called."""
    slug = issuer_slug_for_test(_ISSUER)
    vault = _CountingVault(
        by_slug={slug: _provider_secret(issuer="https://elsewhere/", slug=slug)}
    )

    assert await _storage_over(vault).get_client_info() is None
    assert vault.listings == 1


# ---------------------------------------------------------------------------
# M8: a row this class did not write must not be a 500
# ---------------------------------------------------------------------------


def _foreign_provider_secret(*, issuer: str, extra: dict) -> SecretResponseDTO:
    """An OAuth-provider secret at the same issuer, created through the vault's public
    surface rather than by a registration. Nothing stops one existing, and the
    registration lookup matches on the issuer."""
    return SecretResponseDTO(
        id=uuid4(),
        slug="someone-elses-oauth-provider",
        kind=SecretKind.OAUTH_PROVIDER,
        header=Header(name="Hand-made"),
        data=OAuthProviderDTO(
            provider=OAuthProviderSettingsDTO(
                client_id="hand-made",
                client_secret="placeholder-client-secret",
                issuer_url=issuer,
                scopes=[],
                extra=extra,
            )
        ),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"something_else": {"client_id": "x"}},
        {"client_info": "not-an-object"},
        {"client_info": {"redirect_uris": "not-a-list"}},
    ],
    ids=["absent", "other-keys", "not-an-object", "does-not-validate"],
)
async def test_a_provider_row_without_usable_registration_reads_as_unregistered(extra):
    """Reading the registration metadata as a required key turned a row somebody else
    created at the same issuer into a 500 on the connect path."""
    vault = _CountingVault(
        listed=[_foreign_provider_secret(issuer=_ISSUER, extra=extra)]
    )

    assert await _storage_over(vault).get_client_info() is None


@pytest.mark.asyncio
async def test_a_pinned_row_that_is_not_a_usable_registration_refuses_the_renewal():
    """Same unusable row, reached by the renewal path instead of the connect path.

    The connect path treats it as no registration and makes a fresh one. The renewal
    path cannot: this grant names that registration, so an unreadable one is the end of
    the road rather than a reason to present a different client (N3).
    """
    secret = _foreign_provider_secret(issuer=_ISSUER, extra={})
    vault = _CountingVault(by_slug={secret.slug: secret}, listed=[secret])

    with pytest.raises(MCPOAuthRegistrationUnresolvablePinError):
        await _storage_over(vault).get_client_info_for_grant(
            OAuthGrantSettingsDTO(
                server="https://mcp.example.com/",
                scopes=["read"],
                issuer=_ISSUER,
                client_registration_slug=secret.slug,
            )
        )


@pytest.mark.asyncio
async def test_a_real_registration_under_an_older_slug_is_still_found_by_the_scan():
    """The fallback has to keep working, or losing track of a registration means
    registering a fresh client at a server that may rate limit it."""
    legacy = _provider_secret(issuer=_ISSUER, slug="legacy-oauth-provider")
    vault = _CountingVault(listed=[legacy])

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "client-1"


@pytest.mark.asyncio
async def test_a_hand_made_row_does_not_hide_the_real_registration_beside_it():
    """Both rows name the issuer. The scan has to pick the one that is a registration."""
    vault = _CountingVault(
        listed=[
            _foreign_provider_secret(issuer=_ISSUER, extra={}),
            _provider_secret(issuer=_ISSUER, slug="legacy-oauth-provider"),
        ]
    )

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "client-1"


# ---------------------------------------------------------------------------
# M8: provenance, not shape
# ---------------------------------------------------------------------------


def _crafted_registration(*, issuer: str, slug: str) -> SecretResponseDTO:
    """A provider row shaped exactly like a registration, written by somebody else.

    The shape filter cannot tell this from one this module wrote: it carries a valid
    `client_info`, so it reads back as usable client information.
    """
    return SecretResponseDTO(
        id=uuid4(),
        slug=slug,
        kind=SecretKind.OAUTH_PROVIDER,
        header=Header(name="Looks official"),
        data=OAuthProviderDTO(
            provider=OAuthProviderSettingsDTO(
                client_id="theirs",
                client_secret="placeholder-client-secret",
                issuer_url=issuer,
                scopes=[],
                extra={
                    "client_info": {
                        "client_id": "theirs",
                        "redirect_uris": [_REDIRECT_URI],
                    }
                },
            )
        ),
    )


@pytest.mark.asyncio
async def test_a_crafted_row_at_the_issuer_slug_loses_to_a_genuine_registration():
    """The case the shape filter could not close. Both rows read back as usable client
    information, so only provenance separates them."""
    genuine = _provider_secret(issuer=_ISSUER, slug="agenta-written")
    crafted = _crafted_registration(issuer=_ISSUER, slug=issuer_slug_for_test(_ISSUER))
    vault = _CountingVault(by_slug={crafted.slug: crafted}, listed=[crafted, genuine])

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None
    assert client_info.client_id == "client-1", "the crafted row was preferred"


@pytest.mark.asyncio
async def test_a_registration_this_module_wrote_carries_its_mark():
    """The marker has to be written, or preferring it selects nothing."""
    vault = _CountingVault()
    storage = _storage_over(vault)

    await storage.set_client_info(
        OAuthClientInformationFull(
            redirect_uris=["https://api.example.com/cb"], client_id="ours"
        )
    )

    assert vault.written, "no registration was written"
    extra = vault.written[-1].secret.data.provider.extra
    assert extra["registered_by"] == "agenta-mcp-oauth"
    # And the registration itself is still there beside the mark.
    assert extra["client_info"]["client_id"] == "ours"


@pytest.mark.asyncio
async def test_a_registration_written_before_the_marker_is_still_used():
    """Requiring the mark would orphan every registration written before it existed, and
    orphaning one means registering a fresh client at a server that may rate limit it
    while the grants bound to the old one stop refreshing."""
    legacy = _provider_secret(issuer=_ISSUER, slug=issuer_slug_for_test(_ISSUER))
    legacy.data.provider.extra.pop("registered_by")
    vault = _CountingVault(by_slug={legacy.slug: legacy}, listed=[legacy])

    client_info = await _storage_over(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "client-1"


def _storage_at_an_address(vault) -> SecretsTokenStorage:
    """A storage that knows its callback, so the address slug is a candidate at all.

    Every other case here builds one without a redirect URI, which is why the address
    slug never appeared in them: `_registration_slugs` only offers it when the caller
    knows the address it would register under.
    """
    return SecretsTokenStorage(
        vault_service=vault,
        project_id=uuid4(),
        server_url="https://mcp.example.com/",
        authorization_server=_ISSUER,
        redirect_uri=_REDIRECT_URI,
    )


@pytest.mark.asyncio
async def test_a_crafted_row_at_the_address_slug_loses_to_a_genuine_registration():
    """The path this finding was actually reproduced on.

    The address slug is the first candidate a deployment that knows its callback tries,
    so a row placed there is reached before anything else and used to be returned
    outright. It is also the slug an attacker can compute: it is derived from the issuer
    and the deployment's own public callback, both of which are discoverable.
    """
    address_slug = registration_slug(issuer_url=_ISSUER, redirect_uri=_REDIRECT_URI)
    crafted = _crafted_registration(issuer=_ISSUER, slug=address_slug)
    genuine = _provider_secret(issuer=_ISSUER, slug=issuer_slug_for_test(_ISSUER))
    vault = _CountingVault(
        by_slug={crafted.slug: crafted, genuine.slug: genuine},
        listed=[crafted, genuine],
    )

    client_info = await _storage_at_an_address(vault).get_client_info()

    assert client_info is not None
    assert client_info.client_id == "client-1", "the crafted row was preferred"
    # Reached by the address slug first, so the preference had to look past it.
    assert address_slug in vault.slug_reads


@pytest.mark.asyncio
async def test_the_address_slug_still_wins_when_the_row_there_is_ours():
    """The preference must not invert the ordering it sits inside: a registration this
    module wrote at the current address is the one to present, not an older one at the
    issuer."""
    address_slug = registration_slug(issuer_url=_ISSUER, redirect_uri=_REDIRECT_URI)
    at_address = _provider_secret(issuer=_ISSUER, slug=address_slug)
    at_address.data.provider.extra["client_info"]["client_id"] = "current-address"
    at_address.data.provider.client_id = "current-address"
    older = _provider_secret(issuer=_ISSUER, slug=issuer_slug_for_test(_ISSUER))
    vault = _CountingVault(
        by_slug={at_address.slug: at_address, older.slug: older},
        listed=[older, at_address],
    )

    client_info = await _storage_at_an_address(vault).get_client_info()

    assert client_info is not None and client_info.client_id == "current-address"
    # And it answered from the address, without decrypting the project (D14).
    assert vault.listings == 0


# ---------------------------------------------------------------------------
# D66: a registration existing grants pin is never selected against, nor written over
# ---------------------------------------------------------------------------


_CALLBACK_X = "https://old.example.com/gateways/mcps/connect/callback"
_CALLBACK_Y = "https://new.example.com/gateways/mcps/connect/callback"


def _addressed_storage(*, dao, project_id, issuer, redirect_uri, endpoint_id=None):
    return SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=dao),
        project_id=project_id,
        server_url="https://mcp.acme.io/",
        endpoint_id=endpoint_id or uuid4(),
        authorization_server=issuer,
        redirect_uri=redirect_uri,
    )


async def _row(dao, *, slug, project_id) -> SecretResponseDTO:
    found = await dao.get_by_slug(secret_slug=slug, project_id=project_id)
    assert found is not None, f"nothing stored at {slug}"
    return found


@pytest.mark.asyncio
async def test_a_moved_callback_registers_beside_the_row_its_grants_pin():
    """The design this seam is built on, stated as a case.

    A registration is bound to the callback it was created with, and so are the tokens
    issued through it. When the deployment's public address moves, the new registration
    is a new row: the old one stays byte for byte where it is, and the connections that
    already consented keep renewing against it.
    """
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    endpoint_id = uuid4()
    issuer = "https://auth.acme.io/"

    at_x = _addressed_storage(
        dao=dao,
        project_id=project_id,
        issuer=issuer,
        redirect_uri=_CALLBACK_X,
        endpoint_id=endpoint_id,
    )
    await at_x.set_client_info(
        OAuthClientInformationFull(client_id="client-x", redirect_uris=[_CALLBACK_X])
    )
    slug_a = at_x.resolved_registration_slug
    await at_x.set_tokens(OAuthToken(access_token="t", refresh_token="r"))
    grant = await at_x.get_grant()
    assert grant is not None and grant.client_registration_slug == slug_a

    before = (await _row(dao, slug=slug_a, project_id=project_id)).model_dump_json()

    # The public address moves. Row A is for a callback this deployment no longer sends,
    # so it is not offered, and the registration written is a second row.
    at_y = _addressed_storage(
        dao=dao, project_id=project_id, issuer=issuer, redirect_uri=_CALLBACK_Y
    )
    assert await at_y.get_client_info() is None
    await at_y.set_client_info(
        OAuthClientInformationFull(client_id="client-y", redirect_uris=[_CALLBACK_Y])
    )
    slug_b = at_y.resolved_registration_slug
    assert slug_b != slug_a
    assert (await _row(dao, slug=slug_b, project_id=project_id)) is not None

    # Row A is untouched...
    after = (await _row(dao, slug=slug_a, project_id=project_id)).model_dump_json()
    assert after == before, "the row the grant pins was rewritten"

    # ...and the grant still renews by presenting the client it was issued against, even
    # though the deployment now answers at a different callback.
    renewing = _addressed_storage(
        dao=dao,
        project_id=project_id,
        issuer=issuer,
        redirect_uri=_CALLBACK_Y,
        endpoint_id=endpoint_id,
    )
    for_grant = await renewing.get_client_info_for_grant(grant)
    assert for_grant is not None and for_grant.client_id == "client-x"


@pytest.mark.asyncio
async def test_a_marked_registration_for_another_callback_does_not_displace_this_one():
    """The defect itself, which is the M8 preference reaching across callbacks.

    Row A is a registration for the callback this deployment sends and is what its grants
    pin, but it predates the provenance marker. Row B is marked and was written after the
    address moved, so it names a callback that is no longer in use. Preferring the marked
    row returned B, the connect path found B did not cover the callback it would send,
    and the re-registration that followed wrote over row A.
    """
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    endpoint_id = uuid4()
    issuer = "https://auth.acme.io/"

    at_x = _addressed_storage(
        dao=dao,
        project_id=project_id,
        issuer=issuer,
        redirect_uri=_CALLBACK_X,
        endpoint_id=endpoint_id,
    )
    await at_x.set_client_info(
        OAuthClientInformationFull(client_id="client-x", redirect_uris=[_CALLBACK_X])
    )
    slug_a = at_x.resolved_registration_slug
    await at_x.set_tokens(OAuthToken(access_token="t", refresh_token="r"))
    grant = await at_x.get_grant()
    assert grant is not None and grant.client_registration_slug == slug_a

    # Row A predates the marker. Row B is marked, and sits where a caller that knew no
    # callback address writes: the issuer's own slug.
    row_a = await _row(dao, slug=slug_a, project_id=project_id)
    row_a.data.provider.extra.pop("registered_by")
    at_no_address = SecretsTokenStorage(
        vault_service=VaultService(secrets_dao=dao),
        project_id=project_id,
        server_url="https://mcp.acme.io/",
        endpoint_id=uuid4(),
        authorization_server=issuer,
    )
    await at_no_address.set_client_info(
        OAuthClientInformationFull(client_id="client-y", redirect_uris=[_CALLBACK_Y])
    )
    assert at_no_address.resolved_registration_slug == issuer_slug_for_test(issuer)

    before = (await _row(dao, slug=slug_a, project_id=project_id)).model_dump_json()

    # What the connect path does, with the predicate it actually uses.
    connecting = _addressed_storage(
        dao=dao,
        project_id=project_id,
        issuer=issuer,
        redirect_uri=_CALLBACK_X,
        endpoint_id=endpoint_id,
    )
    stored = await connecting.get_client_info()
    assert stored is not None and stored.client_id == "client-x", (
        "a registration for another callback was preferred"
    )
    if not registration_covers(stored, redirect_uri=_CALLBACK_X):
        await connecting.set_client_info(
            OAuthClientInformationFull(
                client_id="client-fresh", redirect_uris=[_CALLBACK_X]
            )
        )

    after = (await _row(dao, slug=slug_a, project_id=project_id)).model_dump_json()
    assert after == before, "the row the grant pins was rewritten"

    for_grant = await connecting.get_client_info_for_grant(grant)
    assert for_grant is not None and for_grant.client_id == "client-x"


@pytest.mark.asyncio
async def test_a_grant_that_pins_nothing_still_resolves_across_callbacks():
    """The filter is tied to resolving for the current address, and a grant written
    before registrations were pinned has no address of its own: restricting its fallback
    to the callback in use today would orphan it."""
    dao = _FakeSecretsDAO()
    project_id = uuid4()
    issuer = "https://auth.acme.io/"

    at_x = _addressed_storage(
        dao=dao, project_id=project_id, issuer=issuer, redirect_uri=_CALLBACK_X
    )
    await at_x.set_client_info(
        OAuthClientInformationFull(client_id="client-x", redirect_uris=[_CALLBACK_X])
    )

    at_y = _addressed_storage(
        dao=dao, project_id=project_id, issuer=issuer, redirect_uri=_CALLBACK_Y
    )
    unpinned = OAuthGrantSettingsDTO(
        server="https://mcp.acme.io/",
        scopes=[],
        access_token="t",
        refresh_token="r",
        endpoint_id=uuid4(),
    )
    for_grant = await at_y.get_client_info_for_grant(unpinned)

    assert for_grant is not None and for_grant.client_id == "client-x"
