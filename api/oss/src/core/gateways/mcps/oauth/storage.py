"""Vault-backed OAuth token storage."""

import time
from typing import List, Optional, Tuple
from uuid import NAMESPACE_URL, UUID, uuid5

from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import ValidationError

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    OAuthGrantDTO,
    OAuthGrantSettingsDTO,
    OAuthProviderDTO,
    OAuthProviderSettingsDTO,
    SecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthRegistrationUnresolvablePinError,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import SecretSlugConflict
from oss.src.core.shared.dtos import Header
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# A grant this close to its expiry counts as expired. Long enough that a token cannot die
# between the check and the upstream call it authorizes, short enough that a healthy
# hour-long token is not renewed on every request. One definition, because the data plane
# decides whether to ask for a refresh and the OAuth service decides whether to perform
# one: were they to disagree, a call would bounce between them.
REFRESH_SKEW_SECONDS = 60


def grant_settings_expired(
    grant: Optional[OAuthGrantSettingsDTO], *, skew: int = REFRESH_SKEW_SECONDS
) -> bool:
    """Whether a stored grant needs renewing before it is used.

    A grant whose authorization server stated no lifetime is never treated as expired:
    nothing here knows when it dies, and guessing would renew a working token on every
    call. Such a grant still dies as a 401 from the upstream, which is the behaviour for
    every token whose end nobody can predict.
    """
    if grant is None or grant.expires_at is None:
        return False
    return grant.expires_at - skew <= time.time()


def grant_slug(endpoint_id: UUID) -> str:
    """The vault slug holding one connection's grant.

    Derived from the endpoint, never from the server URL. A URL is an address, and two
    accounts at one MCP server are two connections in one project, so a URL-derived slug
    made them collide: the second consent updated the first account's row in place, and
    the first connection went on working as the second account with nothing reported.

    Stable across reconnects of the same connection, and unique within the project
    because the endpoint id is, so the existing partial unique index on
    `(project_id, slug)` still arbitrates — now between two callbacks for the same
    connection, which is what it was written for.
    """
    return get_slug_from_name_and_id("oauth-grant", endpoint_id)


# Written on every registration this module creates, and preferred by both the lookup and
# the scan when more than one row could answer.
#
# A registration is addressed by a slug derived from the issuer and this deployment's
# callback, and an OAuth-provider secret is something a person can create through the
# vault's own surface. So "a provider row at this address naming this issuer" also
# describes a row nothing here wrote, and both paths took the first one they found: the
# lookup returned whatever sat at the slug, and the scan checked only that the row was
# shaped like a registration, which a crafted blob is too (M8).
#
# Provenance rather than shape, and preferred rather than required. Requiring it would
# orphan every registration written before this marker existed, and orphaning a
# registration means re-registering a client at a server that may rate limit it while the
# grants bound to the old one stop refreshing — the D6 harm, caused by the fix for a
# lesser one. A marked row wins wherever both exist, and an unmarked one is still used
# when it is all there is, gaining the marker the next time it is written.
_REGISTERED_BY_KEY = "registered_by"
_REGISTERED_BY = "agenta-mcp-oauth"


def _is_registration_we_wrote(provider: SecretResponseDTO) -> bool:
    settings = provider.data.provider
    return (settings.extra or {}).get(_REGISTERED_BY_KEY) == _REGISTERED_BY


def _issuer_slug(issuer_url: str) -> str:
    """Where a registration lived before it was addressed per callback address.

    Still read, and still written by a caller that knows no callback address. Every
    registration stored before this is here, and so is every grant that references none,
    so it is the fallback both resolve to.
    """
    return get_slug_from_name_and_id("oauth-provider", uuid5(NAMESPACE_URL, issuer_url))


def registration_slug(*, issuer_url: str, redirect_uri: str) -> str:
    """Where one client registration lives: one issuer, one callback address.

    A registration under RFC 7591 is bound to the redirect URIs it was created with, so a
    changed public address needs a new one. Keyed on the pair rather than on the issuer
    alone so that the new registration is a NEW ROW and the old one survives beside it:
    every grant already issued was bound to the old client, and an authorization server
    refuses a refresh presented by a client it never issued those tokens to. One mutable
    row per issuer meant that fixing an endpoint which could not connect silently stopped
    every endpoint that could (D6).
    """
    return get_slug_from_name_and_id(
        "oauth-provider", uuid5(NAMESPACE_URL, f"{issuer_url}\n{redirect_uri}")
    )


class SecretsTokenStorage:
    """Store one connection's OAuth grant, and a client registration per authorization
    server.

    The two records are keyed on different things on purpose. A grant authorizes an
    account, so it belongs to the connection that consented: `grant_slug(endpoint_id)`.
    A client registration under RFC 7591 names this *deployment* to an authorization
    server; it is not an account, two connections at one authorization server
    legitimately share one, and registering per connection would mint a fresh client on
    every connect, which authorization servers rate limit. So it is keyed on the issuer
    and on the callback address it was created with, never on the connection.

    The callback address is part of that key because a registration is bound to it. A
    changed public address therefore writes a NEW registration row rather than
    overwriting the one in use, and a grant records which registration issued it so a
    renewal presents the client its tokens were bound to.

    Both slugs are deterministic, so two callbacks completing at once compute the same
    slug and both find nothing to update. The write is therefore create-first, and the
    loser of the unique index on `(project_id, slug)` converts its refusal into the
    update it would have made had it read a moment later (OR61). Postgres arbitrates;
    nothing serializes these writers in Python, which would only work inside one worker
    anyway.
    """

    def __init__(
        self,
        *,
        vault_service: VaultService,
        project_id: UUID,
        server_url: str,
        endpoint_id: Optional[UUID] = None,
        authorization_server: Optional[str] = None,
        redirect_uri: Optional[str] = None,
    ) -> None:
        self.vault_service = vault_service
        self.project_id = project_id
        self.server_url = server_url
        self.endpoint_id = endpoint_id
        self.authorization_server = authorization_server
        # The callback address this storage speaks for. Absent on the paths that never
        # resolve a registration for the current address, which then read the issuer's.
        self.redirect_uri = redirect_uri
        # The registration slug the last `get_client_info`/`set_client_info` resolved, so
        # `write_tokens` can record on the grant which client issued it.
        self.resolved_registration_slug: Optional[str] = None

    # Tokens

    def _require_endpoint_id(self) -> UUID:
        """The connection this storage speaks for.

        Every grant read and write needs it. Only the client-registration half of this
        class is endpoint-independent, which is why the constructor accepts `None`
        rather than making a registration-only caller invent an id.
        """
        if self.endpoint_id is None:
            raise ValueError(
                "an MCP OAuth grant belongs to one connection: endpoint_id is required"
            )
        return self.endpoint_id

    async def _find_grant(self) -> Optional[SecretResponseDTO]:
        """The grant row for this connection, addressed by slug.

        A lookup, not a scan. The previous implementation listed every secret in the
        project and matched on the grant's `server` field, so it fetched one connection's
        row for another connection whenever two accounts shared a server — which is the
        defect this addresses.

        Reached on refresh, write and delete, not on the relay path: a relayed call reads
        its credential through the endpoint's own `secret_id`, never through here.
        """
        secret = await self.vault_service.get_secret_by_slug(
            secret_slug=grant_slug(self._require_endpoint_id()),
            project_id=self.project_id,
        )
        if secret is None or secret.kind != SecretKind.OAUTH_GRANT:
            return None
        return secret

    async def get_grant(self) -> Optional[OAuthGrantSettingsDTO]:
        """The stored grant as it is recorded, issuer included.

        `get_tokens` below answers the same question in the OAuth client's vocabulary,
        which has no room for the issuer. A renewal needs the issuer, so it reads this.
        """
        grant = await self._find_grant()
        return grant.data.grant if grant is not None else None

    async def get_tokens(self) -> Optional[OAuthToken]:
        grant = await self._find_grant()
        if grant is None:
            return None
        data = grant.data.grant
        expires_in = (
            int(data.expires_at - time.time()) if data.expires_at is not None else None
        )
        return OAuthToken(
            access_token=data.access_token,
            # MCP authorization uses bearer tokens.
            token_type="Bearer",
            expires_in=expires_in,
            scope=" ".join(data.scopes) if data.scopes else None,
            refresh_token=data.refresh_token,
        )

    async def set_tokens(self, tokens: OAuthToken) -> None:
        await self.write_tokens(tokens)

    async def write_tokens(self, tokens: OAuthToken) -> SecretResponseDTO:
        """Write this connection's tokens and return the persisted secret."""
        endpoint_id = self._require_endpoint_id()
        expires_at = (
            int(time.time()) + tokens.expires_in
            if tokens.expires_in is not None
            else None
        )
        grant_settings = OAuthGrantSettingsDTO(
            server=self.server_url,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=expires_at,
            scopes=tokens.scope.split() if tokens.scope else [],
            # Pinned at the moment of the write. A renewal refuses to present these
            # tokens to any other authorization server, however the resource's own
            # metadata document may read by then.
            issuer=self.authorization_server,
            endpoint_id=endpoint_id,
            # Which client these tokens were issued against, so a renewal presents that
            # one rather than whatever registration the issuer holds by then.
            client_registration_slug=self.resolved_registration_slug,
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_GRANT,
            data=OAuthGrantDTO(grant=grant_settings),
        )

        slug = grant_slug(endpoint_id)
        existing = await self._find_grant()
        if existing is not None:
            return await self._update(existing=existing, secret=secret)

        try:
            return await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth grant — {self.server_url}"),
                    secret=secret,
                ),
            )
        except SecretSlugConflict:
            return await self._update_by_slug(slug=slug, secret=secret)

    async def delete_grant(self) -> bool:
        """Drop this connection's grant. Returns whether there was one to drop.

        One row, named by one slug, so disconnecting one account cannot take another
        account's credentials with it. This is safe only because the key moved off the
        server URL: under the old key it would have disconnected every connection at
        that server.

        Local only. Nothing is revoked at the authorization server, so the token stays
        live upstream until it expires. Recorded as debt (CU20) rather than left
        unsaid: revocation needs an endpoint this deployment does not discover yet.
        """
        existing = await self._find_grant()
        if existing is None:
            return False
        await self.vault_service.delete_secret(
            secret_id=existing.id,
            project_id=self.project_id,
        )
        return True

    # Client registration

    @property
    def _issuer(self) -> str:
        return self.authorization_server or self.server_url

    async def _provider_by_slug(self, slug: str) -> Optional[SecretResponseDTO]:
        """One registration row, accepted only if it names this issuer.

        The issuer check is D14's, and it is what stops a slug collision handing one
        authorization server another's client.
        """
        secret = await self.vault_service.get_secret_by_slug(
            secret_slug=slug,
            project_id=self.project_id,
        )
        if (
            secret is not None
            and secret.kind == SecretKind.OAUTH_PROVIDER
            and secret.data.provider.issuer_url == self._issuer
        ):
            return secret
        return None

    def _registration_slugs(self, *, current_address: bool) -> List[str]:
        """Where to look for a registration, best first.

        The per-address slug is what a registration is written under when the caller
        knows its callback address. The issuer slug follows, because every registration
        written before the address joined the key is there. `current_address=False` skips
        the first, which is what a grant that references no registration wants: it
        predates per-address registrations, so the issuer's row is its own and a newer
        one at this address was never the client it was issued against.
        """
        slugs: List[str] = []
        if current_address and self.redirect_uri:
            slugs.append(
                registration_slug(
                    issuer_url=self._issuer, redirect_uri=self.redirect_uri
                )
            )
        slugs.append(_issuer_slug(self._issuer))
        return slugs

    async def _find_provider(
        self, *, current_address: bool = True
    ) -> Optional[Tuple[Optional[str], SecretResponseDTO]]:
        """This deployment's registration, with the slug it was found under.

        Lookups first, for the same reason the grant half is addressed: a project listing
        decrypts every secret the project holds (D14).

        The scan stays as a fallback, and is not dead code. A row written under an older
        naming, or one whose slug is absent, is still reachable by its `issuer_url`, and
        losing track of a registration means re-registering a client at a server that may
        rate limit it. Such a row is returned with whatever slug it actually carries,
        which may be none, so a grant referencing it either addresses it or falls back to
        this same search rather than to a slug nothing is stored under.

        The scan matches on more than the issuer. An OAuth-provider secret is something a
        person can create through the vault's own surface, so "any provider row naming
        this issuer" also describes a row this class never wrote, and picking one up made
        a hand-made secret decide how this deployment authenticates: it was presented as
        the client, and re-registration was skipped because a registration appeared to
        exist (M8). A row only counts if it actually carries a registration this client
        could present, which a hand-made one does not.
        """
        # One pass over every candidate, taking the first this module wrote and keeping
        # the best unmarked one in case there is nothing better. Both paths used to take
        # the first row they found, so a row placed at the address slug beat a genuine
        # registration that the scan would have found below it.
        unmarked: Optional[Tuple[Optional[str], SecretResponseDTO]] = None

        for slug in self._registration_slugs(current_address=current_address):
            provider = await self._provider_by_slug(slug)
            if provider is None or self._as_client_info(provider) is None:
                continue
            if _is_registration_we_wrote(provider):
                return slug, provider
            if unmarked is None:
                unmarked = (slug, provider)

        # An unmarked row does NOT answer yet: a row placed at the address slug is
        # exactly how a crafted one shadows a genuine registration, so the rest has to be
        # looked at before preferring it. That costs the project listing D14 removed, and
        # only in this case: a marked row returned above, and every write marks, so this
        # is the deployment registered before the marker existed and only until its
        # registration is next written. D14's read was on the relay path; this one is on
        # connect and on a renewal that predates the grant's own pin.
        target = self._issuer
        secrets = await self.vault_service.list_secrets(project_id=self.project_id)
        for candidate in secrets:
            if (
                candidate.kind != SecretKind.OAUTH_PROVIDER
                or candidate.data.provider.issuer_url != target
                or self._as_client_info(candidate) is None
            ):
                continue
            if _is_registration_we_wrote(candidate):
                return candidate.slug, candidate
            if unmarked is None:
                unmarked = (candidate.slug, candidate)

        return unmarked

    @staticmethod
    def _as_client_info(
        provider: SecretResponseDTO,
    ) -> Optional[OAuthClientInformationFull]:
        """A stored registration as the OAuth client wants it, or None if it is not one.

        Every field here is read back out of a row this class did not necessarily write.
        A registration is matched by issuer, and nothing stops a person creating an
        OAuth-provider secret of their own at the same issuer through the vault's public
        surface, so `extra` may hold anything or nothing. Reading the registration
        metadata as a required key turned that row into a 500 on the connect path (M8).

        Absent or unusable metadata reads as no registration, which is the answer every
        caller here already handles: it registers a fresh client rather than presenting
        one the authorization server never issued.
        """
        settings = provider.data.provider
        client_info = (settings.extra or {}).get("client_info")
        if not isinstance(client_info, dict):
            log.warning(
                "[gateways] an OAuth provider secret carries no usable client "
                "registration; treating it as unregistered",
                secret_id=str(provider.id),
            )
            return None

        # The secret lives in the settings field the vault knows how to redact, never in
        # the registration metadata beside it; put it back only here, where the caller is
        # the OAuth client itself.
        try:
            return OAuthClientInformationFull.model_validate(
                {
                    **client_info,
                    "client_secret": settings.client_secret or None,
                }
            )
        except ValidationError:
            log.warning(
                "[gateways] an OAuth provider secret's client registration did not "
                "validate; treating it as unregistered",
                secret_id=str(provider.id),
            )
            return None

    async def get_client_info(self) -> Optional[OAuthClientInformationFull]:
        """The registration this deployment would present at its current address."""
        found = await self._find_provider()
        if found is None:
            return None
        slug, provider = found
        self.resolved_registration_slug = slug
        return self._as_client_info(provider)

    async def get_client_info_for_grant(
        self, grant: OAuthGrantSettingsDTO
    ) -> Optional[OAuthClientInformationFull]:
        """The registration a stored grant was issued against, not the current one.

        A renewal must present the client the authorization server bound these tokens to.
        Presenting a newer registration for the same issuer gets the refresh refused,
        because that client was never issued these tokens — which is what made a changed
        public address quietly stop every connection that was working (D6).

        A grant referencing none predates the reference, so it resolves the issuer's
        registration, which is exactly where it was already being resolved.
        """
        slug = grant.client_registration_slug
        if slug:
            # Carried forward even when the row behind it is gone. `write_tokens` persists
            # whatever this holds, so leaving it unset made the renewal rewrite the grant
            # with no registration reference at all: the pin survived the first consent
            # and died on the first refresh, and every refresh after that resolved
            # "whatever registration this issuer has now" — which is the failure D6 closed
            # (D24). A slug naming a registration that has been deleted still records
            # which client these tokens belong to, and is the honest thing to keep.
            self.resolved_registration_slug = slug
            provider = await self._provider_by_slug(slug)
            client_info = (
                self._as_client_info(provider) if provider is not None else None
            )
            if client_info is None:
                # Refused rather than answered `None`. Nothing else can stand in for a
                # registration that is gone — any other client at this issuer was never
                # issued these tokens — but answering `None` said exactly what a grant
                # with no pin at all says, and the renewal then substituted the
                # deployment's identity document, which is the substitution the line
                # above forbids (N3).
                raise MCPOAuthRegistrationUnresolvablePinError(
                    server_url=self.server_url, registration_slug=slug
                )
            return client_info
        found = await self._find_provider(current_address=False)
        if found is None:
            return None
        # A grant written before the reference existed gains one here, so the next
        # renewal is pinned even though this one had to resolve by issuer.
        self.resolved_registration_slug = found[0]
        return self._as_client_info(found[1])

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        issuer = self.authorization_server or self.server_url
        provider_settings = OAuthProviderSettingsDTO(
            client_id=client_info.client_id or "",
            client_secret=client_info.client_secret or "",
            issuer_url=issuer,
            scopes=(client_info.scope or "").split(),
            # The rest of the dynamic-client-registration response is kept because the MCP
            # client needs it back verbatim (redirect URIs, grant and auth methods, token
            # endpoint auth). The client secret is excluded: a second copy in a free-form
            # map is a copy nothing redacts, and the outer field above already holds it.
            extra={
                "client_info": client_info.model_dump(
                    mode="json", exclude={"client_secret"}
                ),
                _REGISTERED_BY_KEY: _REGISTERED_BY,
            },
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_PROVIDER,
            data=OAuthProviderDTO(provider=provider_settings),
        )

        # One row per callback address. A registration for a DIFFERENT address is left
        # exactly where it is, because the grants issued against it still need it; only
        # the row for this address is written. A caller with no callback address keeps
        # writing the issuer row, which is where it always wrote.
        slug = (
            registration_slug(issuer_url=issuer, redirect_uri=self.redirect_uri)
            if self.redirect_uri
            else _issuer_slug(issuer)
        )
        self.resolved_registration_slug = slug

        existing = await self._provider_by_slug(slug)
        if existing is not None:
            # Re-registering at the same address, so this replaces a client the
            # authorization server has already forgotten us under, not one in use.
            await self._update(existing=existing, secret=secret)
            return

        try:
            await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth client — {issuer}"),
                    secret=secret,
                ),
            )
        except SecretSlugConflict:
            await self._update_by_slug(slug=slug, secret=secret)

    # Writes

    async def _update(
        self, *, existing: SecretResponseDTO, secret: SecretDTO
    ) -> SecretResponseDTO:
        updated = await self.vault_service.update_secret(
            secret_id=existing.id,
            update_secret_dto=UpdateSecretDTO(secret=secret),
            project_id=self.project_id,
        )
        return updated or existing

    async def _update_by_slug(
        self, *, slug: str, secret: SecretDTO
    ) -> SecretResponseDTO:
        """Apply the write the create lost, to the row that won the slug.

        The winner is read back by the same slug this call tried to claim, so there is no
        window in which the row could be a different one: the index that refused the
        create is the index this read goes through.
        """
        winner = await self.vault_service.get_secret_by_slug(
            secret_slug=slug,
            project_id=self.project_id,
        )
        if winner is None:
            # The winner was deleted between the refusal and this read. Nothing holds
            # the slug now, so the original create is the right call again.
            return await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth record — {self.server_url}"),
                    secret=secret,
                ),
            )
        return await self._update(existing=winner, secret=secret)
