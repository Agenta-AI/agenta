"""OAuth client for MCP endpoint authorization.

Discovery, RFC 7591 dynamic registration and authorization-code token exchange, built
from the SDK's own wire DTOs (`mcp.shared.auth`) and PKCE generator
(`mcp.client.auth.oauth2.PKCEParameters`) rather than from `OAuthClientProvider`, whose
`async_auth_flow` blocks one coroutine across the whole flow — a shape a web deployment's
two-separate-HTTP-requests callback cannot satisfy.
"""

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, urljoin, urlparse

import httpx
from mcp.client.auth.oauth2 import PKCEParameters
from mcp.shared.auth import (
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthToken,
    ProtectedResourceMetadata,
)
from pydantic import ValidationError

from oss.src.core.gateways.egress import (
    EgressRefusedError,
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthDiscovery
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthTokenExchangeError,
)
from oss.src.utils.env import env

_TIMEOUT_SECONDS = 15.0


def _authorization_base_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _origin(url: str) -> str:
    """Scheme plus authority, lowercased. The unit an operator can read in an error."""
    parsed = urlparse(url)
    return f"{(parsed.scheme or '').lower()}://{(parsed.netloc or '').lower()}"


def _same_origin(one: str, other: str) -> bool:
    origin = _origin(one)
    return origin != "://" and origin == _origin(other)


def _normalized(url: str) -> str:
    """An issuer identifier with its optional trailing slash removed.

    RFC 8414 s3.3 compares issuer identifiers as strings. The one difference real
    documents show is whether the value ends in `/`, because the well-known URL is built
    by inserting a path segment into it, so that is the only difference normalized away.
    """
    return url.rstrip("/")


def same_issuer(one: str, other: str) -> bool:
    """Whether two issuer identifiers name the same authorization server.

    RFC 8414 s3.3 compares issuers as strings; the trailing slash is the one difference
    real documents show, and `_normalized` is where that is decided for both this and
    the discovery-time check below.
    """
    return _normalized(one) == _normalized(other)


def _requires_https() -> bool:
    """The gateway's one egress switch, read per call so an operator's value is in force.

    `AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED` already decides whether `core/gateways/
    egress.py` enforces its address rules; a deployment that has turned that off is
    dialling a plaintext box on purpose, and a second switch here would only let the two
    answers drift apart.
    """
    return not env.gateway_egress.insecure_allowed


def _protected_resource_urls(
    server_url: str, *, resource_metadata_url: Optional[str] = None
) -> List[str]:
    urls = []
    if resource_metadata_url:
        urls.append(resource_metadata_url)
    parsed = urlparse(server_url)
    base = _authorization_base_url(server_url)
    if parsed.path and parsed.path != "/":
        urls.append(
            urljoin(base, f"/.well-known/oauth-protected-resource{parsed.path}")
        )
    urls.append(urljoin(base, "/.well-known/oauth-protected-resource"))
    return urls


_RESOURCE_METADATA_RE = re.compile(r'resource_metadata=(?:"([^"]+)"|([^\s,]+))')


def _resource_metadata_url_from_response(response: httpx.Response) -> Optional[str]:
    """RFC 9728 s3: a 401's `WWW-Authenticate` names the PRM location directly."""
    if response.status_code != 401:
        return None
    header = response.headers.get("WWW-Authenticate")
    if not header:
        return None
    match = _RESOURCE_METADATA_RE.search(header)
    if not match:
        return None
    return match.group(1) or match.group(2)


def _authorization_server_metadata_urls(authorization_server: str) -> List[str]:
    parsed = urlparse(authorization_server)
    base = _authorization_base_url(authorization_server)
    urls = []
    if parsed.path and parsed.path != "/":
        urls.append(
            urljoin(
                base,
                f"/.well-known/oauth-authorization-server{parsed.path.rstrip('/')}",
            )
        )
    urls.append(urljoin(base, "/.well-known/oauth-authorization-server"))
    if parsed.path and parsed.path != "/":
        urls.append(
            urljoin(base, f"/.well-known/openid-configuration{parsed.path.rstrip('/')}")
        )
    urls.append(f"{authorization_server.rstrip('/')}/.well-known/openid-configuration")
    return urls


def _check_https(url: str, *, label: str, server_url: str) -> None:
    if not _requires_https():
        return
    if urlparse(url).scheme.lower() != "https":
        raise MCPOAuthDiscoveryError(
            server_url=server_url,
            detail=f"{label} is not https: {_origin(url)}",
        )


def _check_protected_resource(
    prm: ProtectedResourceMetadata, *, server_url: str
) -> None:
    """RFC 9728 s3.3: the document must describe the resource that was asked about.

    Compared by origin rather than by the string identity the RFC states, because a
    tenant registers a server by the URL it is called on (`https://host/mcp`) while the
    document names the resource identifier (`https://host/`). Origin equality is what
    the security property needs: it is the hop from "the tenant registered this host" to
    "this host's document may name an authorization server" that must not be crossable by
    a third party.
    """
    if not _same_origin(str(prm.resource), server_url):
        raise MCPOAuthDiscoveryError(
            server_url=server_url,
            detail=(
                "protected-resource metadata describes a different resource: "
                f"{_origin(str(prm.resource))}"
            ),
        )
    if not prm.authorization_servers:
        raise MCPOAuthDiscoveryError(
            server_url=server_url,
            detail="protected-resource metadata names no authorization server",
        )
    _check_https(
        str(prm.authorization_servers[0]),
        label="authorization server",
        server_url=server_url,
    )


def _check_authorization_server(
    metadata: OAuthMetadata, *, authorization_server: str
) -> None:
    """Pin the authorization server before its endpoints are used.

    Two rules, and they are different in kind.

    **Issuer identity** (RFC 8414 s3.3, and RFC 9728 s3.3 for how the issuer was reached).
    The metadata's `issuer` must be the authorization server the protected resource named,
    which is the URL whose well-known path this document was fetched from. A document that
    answers at one issuer's well-known URL while claiming to be another issuer is refused;
    without the check, a redirect or a shared host could substitute a document.

    **Endpoint origin.** `authorization_endpoint`, `token_endpoint` and
    `registration_endpoint` must be same-origin with that issuer. RFC 8414 does not
    require this, and a few OpenID providers do split (Google authorizes at
    `accounts.google.com` and takes tokens at `oauth2.googleapis.com`). The rule is
    enforced anyway because the split is what the attack needs: the honest authorization
    server mints the code and holds the client secret, and a metadata document that names
    someone else's token endpoint sends both to that someone. A provider that genuinely
    splits its endpoints cannot be used as an MCP authorization server here, and is
    refused with the origin named rather than failing obscurely later; no authorization
    server an MCP deployment meets today (Auth0, WorkOS, Stytch, Descope, Keycloak, Okta,
    Entra, GitHub, and MCP vendors' own) splits them.

    What this does NOT stop: a hostile MCP server naming an authorization server it owns
    outright. That flow is self-consistent, and the person consenting sees the attacker's
    own login page and grants the attacker access to the attacker. Pinning answers "is the
    token endpoint where this issuer lives", never "is this issuer honest".
    """
    issuer = str(metadata.issuer)
    if _normalized(issuer) != _normalized(authorization_server):
        raise MCPOAuthDiscoveryError(
            server_url=authorization_server,
            detail=f"authorization-server metadata names a different issuer: {issuer}",
        )
    _check_https(issuer, label="issuer", server_url=authorization_server)

    endpoints = [
        ("authorization endpoint", str(metadata.authorization_endpoint)),
        ("token endpoint", str(metadata.token_endpoint)),
    ]
    if metadata.registration_endpoint:
        endpoints.append(("registration endpoint", str(metadata.registration_endpoint)))

    for label, url in endpoints:
        _check_https(url, label=label, server_url=authorization_server)
        if not _same_origin(url, issuer):
            raise MCPOAuthDiscoveryError(
                server_url=authorization_server,
                detail=(
                    f"{label} is not on the issuer's origin: "
                    f"{_origin(url)} is not {_origin(issuer)}"
                ),
            )


class MCPOAuthClient:
    def __init__(self, *, transport: Optional[httpx.BaseTransport] = None) -> None:
        # Injectable seam for tests, matching HttpMCPAdapter / ComposioConnectionsAdapter.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return egress_client(timeout=_TIMEOUT_SECONDS, transport=self._transport)

    # Every URL below is attacker-influenced: `server_url` is tenant data, the
    # `resource_metadata` location arrives in the upstream's own `WWW-Authenticate`
    # challenge, and the authorization and token endpoints are read out of a metadata
    # document the upstream published. All of them go through the shared egress boundary,
    # which resolves the name, refuses a blocked address and pins the connection (OD26).

    @staticmethod
    async def _get(client: httpx.AsyncClient, url: str) -> Optional[httpx.Response]:
        """One guarded GET. `None` when the target was refused or unreachable.

        Discovery walks a list of candidate URLs and moves on when one does not answer, so
        a refused candidate is skipped the same way; the walk ends in the discovery error
        the caller already raises when nothing usable was found. The point is that the
        blocked address is never dialled.
        """
        try:
            target = await open_egress(url)
        except EgressRefusedError:
            return None
        try:
            return await client.get(
                target.url, headers=target.headers, extensions=target.extensions
            )
        except httpx.RequestError:
            return None

    async def discover(self, *, server_url: str) -> MCPOAuthDiscovery:
        async with self._client() as client:
            prm = await self._discover_protected_resource(client, server_url=server_url)
            authorization_server = str(prm.authorization_servers[0])
            metadata = await self._discover_authorization_server(
                client, authorization_server=authorization_server
            )

        return MCPOAuthDiscovery(
            resource=str(prm.resource),
            authorization_server=authorization_server,
            scopes_offered=prm.scopes_supported or metadata.scopes_supported or [],
            authorization_endpoint=str(metadata.authorization_endpoint),
            token_endpoint=str(metadata.token_endpoint),
            registration_endpoint=(
                str(metadata.registration_endpoint)
                if metadata.registration_endpoint
                else None
            ),
        )

    async def _discover_protected_resource(
        self, client: httpx.AsyncClient, *, server_url: str
    ) -> ProtectedResourceMetadata:
        resource_metadata_url = await self._probe_resource_metadata_url(
            client, server_url=server_url
        )
        for url in _protected_resource_urls(
            server_url, resource_metadata_url=resource_metadata_url
        ):
            response = await self._get(client, url)
            if response is None:
                continue
            if response.status_code != 200:
                continue
            try:
                prm = ProtectedResourceMetadata.model_validate_json(response.content)
            except ValidationError:
                continue
            # Refuse rather than walk on. A document that parses but describes another
            # resource is the upstream answering a question nobody asked; trying the
            # next candidate would let a server publish one good document and one bad
            # one and have the bad one taken when the good one is momentarily absent.
            _check_protected_resource(prm, server_url=server_url)
            return prm
        raise MCPOAuthDiscoveryError(
            server_url=server_url, detail="no protected-resource metadata found"
        )

    async def _probe_resource_metadata_url(
        self, client: httpx.AsyncClient, *, server_url: str
    ) -> Optional[str]:
        response = await self._get(client, server_url)
        if response is None:
            return None
        return _resource_metadata_url_from_response(response)

    async def _discover_authorization_server(
        self, client: httpx.AsyncClient, *, authorization_server: str
    ) -> OAuthMetadata:
        for url in _authorization_server_metadata_urls(authorization_server):
            response = await self._get(client, url)
            if response is None:
                continue
            if response.status_code != 200:
                continue
            try:
                metadata = OAuthMetadata.model_validate_json(response.content)
            except ValidationError:
                continue
            _check_authorization_server(
                metadata, authorization_server=authorization_server
            )
            return metadata
        raise MCPOAuthDiscoveryError(
            server_url=authorization_server,
            detail="no authorization-server metadata found",
        )

    async def register(
        self,
        *,
        authorization_server: str,
        registration_endpoint: Optional[str],
        redirect_uri: str,
        scopes: List[str],
    ) -> OAuthClientInformationFull:
        endpoint = registration_endpoint or urljoin(
            _authorization_base_url(authorization_server), "/register"
        )
        metadata = OAuthClientMetadata(
            redirect_uris=[redirect_uri],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            scope=" ".join(scopes) if scopes else None,
            client_name="Agenta",
        )
        body = metadata.model_dump(by_alias=True, mode="json", exclude_none=True)

        try:
            target = await open_egress(endpoint)
        except EgressRefusedError as e:
            raise MCPOAuthRegistrationError(
                authorization_server=authorization_server, detail=e.relay_detail
            ) from e

        async with self._client() as client:
            try:
                response = await client.post(
                    target.url,
                    json=body,
                    headers=target.headers,
                    extensions=target.extensions,
                )
            except httpx.RequestError as e:
                raise MCPOAuthRegistrationError(
                    authorization_server=authorization_server, detail=str(e)
                ) from e

        # Status and origin, never the body. The body is written by the upstream this
        # call was pointed at, and this message travels to the browser and into agent
        # transcripts; echoing it turns any discovery weakness into a read primitive
        # (OR42). An operator still learns which host refused and how.
        if response.status_code not in (200, 201):
            raise MCPOAuthRegistrationError(
                authorization_server=authorization_server,
                detail=f"{response.status_code} from {_origin(endpoint)}",
            )
        try:
            return OAuthClientInformationFull.model_validate_json(response.content)
        except ValidationError as e:
            raise MCPOAuthRegistrationError(
                authorization_server=authorization_server,
                detail=f"malformed registration response from {_origin(endpoint)}",
            ) from e

    def build_pkce(self) -> PKCEParameters:
        return PKCEParameters.generate()

    def authorization_url(
        self,
        *,
        authorization_endpoint: str,
        client_id: str,
        redirect_uri: str,
        code_challenge: str,
        state: str,
        scopes: List[str],
        resource: Optional[str] = None,
    ) -> str:
        params: Dict[str, Any] = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if scopes:
            params["scope"] = " ".join(scopes)
        if resource:
            params["resource"] = resource
        return f"{authorization_endpoint}?{urlencode(params)}"

    async def exchange_token(
        self,
        *,
        token_endpoint: str,
        code: str,
        code_verifier: str,
        redirect_uri: str,
        client_info: OAuthClientInformationFull,
        resource: Optional[str] = None,
    ) -> OAuthToken:
        data: Dict[str, Any] = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_info.client_id,
            "code_verifier": code_verifier,
        }
        if client_info.client_secret:
            data["client_secret"] = client_info.client_secret
        if resource:
            data["resource"] = resource

        return await self._post_token_request(token_endpoint=token_endpoint, data=data)

    async def refresh_token(
        self,
        *,
        token_endpoint: str,
        refresh_token: str,
        client_info: OAuthClientInformationFull,
        scopes: Optional[List[str]] = None,
        resource: Optional[str] = None,
    ) -> OAuthToken:
        """RFC 6749 s6. Same endpoint, same client credentials, same egress boundary.

        `scope` is sent only when the caller states one: omitting it asks for the scopes
        the original grant already carries, while naming a narrower set would silently
        shrink them on every refresh.
        """
        data: Dict[str, Any] = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_info.client_id,
        }
        if client_info.client_secret:
            data["client_secret"] = client_info.client_secret
        if scopes:
            data["scope"] = " ".join(scopes)
        if resource:
            data["resource"] = resource

        return await self._post_token_request(token_endpoint=token_endpoint, data=data)

    async def _post_token_request(
        self, *, token_endpoint: str, data: Dict[str, Any]
    ) -> OAuthToken:
        try:
            target = await open_egress(
                token_endpoint,
                above_caller={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except EgressRefusedError as e:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint, detail=e.relay_detail
            ) from e

        async with self._client() as client:
            try:
                response = await client.post(
                    target.url,
                    data=data,
                    headers=target.headers,
                    extensions=target.extensions,
                )
            except httpx.RequestError as e:
                raise MCPOAuthTokenExchangeError(
                    token_endpoint=token_endpoint, detail=str(e)
                ) from e

        # Status and origin only; see `register` above for why the body stays here.
        if response.status_code != 200:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint,
                detail=f"{response.status_code} from {_origin(token_endpoint)}",
            )
        try:
            return OAuthToken.model_validate_json(response.content)
        except ValidationError as e:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint,
                detail=f"malformed token response from {_origin(token_endpoint)}",
            ) from e
