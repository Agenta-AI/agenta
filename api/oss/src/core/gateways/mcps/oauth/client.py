"""OAuth client for MCP endpoint authorization.

Discovery, RFC 7591 dynamic registration and authorization-code token exchange, built
from the SDK's own wire DTOs (`mcp.shared.auth`) and PKCE generator
(`mcp.client.auth.oauth2.PKCEParameters`) rather than from `OAuthClientProvider`, whose
`async_auth_flow` blocks one coroutine across the whole flow — a shape a web deployment's
two-separate-HTTP-requests callback cannot satisfy.
"""

import base64
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlencode, urljoin, urlparse

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
    classify_transport_error,
    decoded_response,
    egress_client,
    exempt_hosts,
    open_egress,
)
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthDiscovery
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthTokenExchangeError,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_TIMEOUT_SECONDS = 15.0

# A metadata document is a small JSON object: RFC 8414's authorization-server metadata and
# RFC 9728's protected-resource metadata are both a handful of fields. Generous against
# that, and small enough that a candidate URL cannot spend the process's memory.
_MAX_METADATA_BYTES = 256 * 1024


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


def _authorization_server_metadata_urls(issuer: str) -> List[str]:
    """The issuer's own well-known URLs, derived from the issuer identifier alone.

    This function is the whole security property of discovery: the authorization server's
    metadata is fetched from a location the ISSUER controls, never from a document or a
    URL the MCP server supplies. Everything the metadata then names — the authorization,
    token and registration endpoints — is therefore named by the issuer itself, which is
    why those endpoints need no origin check of their own.

    Three forms, tried in this order (the order the MCP authorization spec states, and
    the order the MCP Python SDK's own
    `build_oauth_authorization_server_metadata_discovery_urls` uses):

    1. RFC 8414 s3.1 — the well-known segment is INSERTED between the authority and the
       issuer's path, so `https://auth.example/tenant` is described at
       `https://auth.example/.well-known/oauth-authorization-server/tenant`. OAuth's own
       document comes first because it is the one this client parses as `OAuthMetadata`.
    2. RFC 8414 s5 — the same insertion with the `openid-configuration` suffix, for an
       OpenID provider that only publishes the OIDC document.
    3. OpenID Connect Discovery 1.0 s4.1 — the suffix APPENDED to the issuer, which is
       the older and still common OIDC layout.

    An issuer with no path component (`https://auth.example`, the ordinary case, and what
    Google publishes) collapses forms 1 and 2 to the root well-known URLs, and form 3 to
    the same URL as form 2, so two candidates remain.
    """
    parsed = urlparse(issuer)
    base = _authorization_base_url(issuer)
    urls = []
    if parsed.path and parsed.path != "/":
        path = parsed.path.rstrip("/")
        urls.append(urljoin(base, f"/.well-known/oauth-authorization-server{path}"))
        urls.append(urljoin(base, f"/.well-known/openid-configuration{path}"))
        urls.append(urljoin(base, f"{path}/.well-known/openid-configuration"))
        return urls
    urls.append(urljoin(base, "/.well-known/oauth-authorization-server"))
    urls.append(urljoin(base, "/.well-known/openid-configuration"))
    return urls


def _check_https(url: str, *, label: str, server_url: str) -> None:
    if not _requires_https():
        return
    # The same hosts `core/gateways/egress.py` already lets through: an operator's
    # `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST` entry, and the development mock upstreams while
    # `AGENTA_GATEWAYS_MOCKS_ENABLED` is on. Both are operator environment that no tenant
    # can reach. Without this, the exemption that module documents as *the* way a dev
    # stack reaches its own containers ("not by disabling the guard") did not exist on
    # this path: discovery admitted the plaintext mock at the socket and then refused it
    # here, so an http authorization server on the private Docker network was
    # unreachable and the consent flow could not be run end to end at all.
    if (urlparse(url).hostname or "").lower() in exempt_hosts():
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

    **Issuer identity** (RFC 8414 s3.3, and RFC 9728 s3.3 for how the issuer was reached).
    The metadata's `issuer` must be the authorization server the protected resource named,
    which is the issuer whose well-known URL this document was fetched from. A document
    that answers at one issuer's well-known URL while claiming to be another issuer is
    refused; without the check, a shared host could substitute a document.

    **Endpoint provenance, not endpoint origin.** The authorization, token and
    registration endpoints are taken exactly as this document publishes them, whatever
    their origin. The attack OR42 named is trusting endpoints the MCP SERVER names; the
    answer is that this document never comes from the MCP server. It is fetched from the
    issuer's own well-known URL (`_authorization_server_metadata_urls`) and is refused
    unless it claims that issuer, so an endpoint here is named by the authorization server
    about itself. Requiring the three to be same-origin with the issuer on top of that
    bought nothing and ruled out a real and common shape: Google publishes its issuer as
    `accounts.google.com` and its token endpoint as `oauth2.googleapis.com`, and split
    origins of that kind are what MCP deployments meet.

    HTTPS is still required on the issuer and on every endpoint, gated on the gateway's
    one egress switch, and an endpoint the issuer does not publish is still refused: a
    document without `authorization_endpoint` or `token_endpoint` does not parse as
    `OAuthMetadata`, so the candidate is skipped and discovery ends in a refusal rather
    than in an endpoint guessed from somewhere else.

    What this does NOT stop, unchanged: a hostile MCP server naming an authorization
    server it owns outright. That flow is self-consistent, and the person consenting sees
    the attacker's own login page and grants the attacker access to the attacker. Pinning
    answers "does this issuer say the token endpoint is here", never "is this issuer
    honest".
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


def _token_endpoint_auth_method(client_info: OAuthClientInformationFull) -> str:
    """How the client authenticates at the token endpoint, exactly as registered.

    A registration that names no method takes RFC 7591's default, `client_secret_basic`,
    or `none` for a client issued no secret. A method this client does not implement, or
    one that disagrees with whether there is a secret, is refused rather than replaced:
    sending a secret the client was not registered to send, or sending none where one is
    required, both fail at the provider with an error about something else.
    """
    method = client_info.token_endpoint_auth_method
    has_secret = bool(client_info.client_secret)
    if method is None:
        return "client_secret_basic" if has_secret else "none"
    if method not in ("client_secret_basic", "client_secret_post", "none"):
        raise ValueError(
            f"the client is registered for the token endpoint auth method {method}, "
            "which Agenta does not support"
        )
    if (method == "none") == has_secret:
        raise ValueError(
            "the client is registered for the token endpoint auth method none, but has "
            "a client secret"
            if has_secret
            else f"the client is registered for {method}, but has no client secret"
        )
    return method


def client_authentication(
    client_info: OAuthClientInformationFull, data: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """The token request's form fields and headers for the client's auth method.

    RFC 6749 s2.3.1: `client_secret_basic` sends the id and the secret, each form-encoded,
    as HTTP Basic credentials, and nothing about the client in the body. The other two
    name the client in the body, `client_secret_post` with its secret beside it.
    """
    method = _token_endpoint_auth_method(client_info)
    client_id = client_info.client_id
    if method == "client_secret_basic":
        credentials = (
            f"{quote_plus(client_id)}:{quote_plus(client_info.client_secret or '')}"
        )
        encoded = base64.b64encode(credentials.encode()).decode()
        return data, {"Authorization": f"Basic {encoded}"}
    data = {**data, "client_id": client_id}
    if method == "client_secret_post":
        data["client_secret"] = client_info.client_secret
    return data, {}


class MCPOAuthClient:
    def __init__(self, *, transport: Optional[httpx.BaseTransport] = None) -> None:
        # Injectable seam for tests, matching HttpMCPAdapter / ComposioConnectionsAdapter.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return egress_client(timeout=_TIMEOUT_SECONDS, transport=self._transport)

    # Every URL below is attacker-influenced: `server_url` is tenant data, the
    # `resource_metadata` location arrives in the upstream's own `WWW-Authenticate`
    # challenge, and the authorization and token endpoints are read out of the issuer's
    # own metadata document. All of them go through the shared egress boundary,
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
            response = await client.send(
                client.build_request(
                    "GET",
                    target.url,
                    headers=target.headers,
                    extensions=target.extensions,
                ),
                stream=True,
            )
        except httpx.RequestError:
            return None

        # Read with a cap rather than buffering whatever arrives. Every URL reaching here
        # is attacker-influenced, and a metadata document is a small JSON object, so a
        # response that exceeds this is not one however it is framed. Skipped like any
        # other unusable candidate, which the walk above already knows how to do (D46).
        try:
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > _MAX_METADATA_BYTES:
                    log.warning(
                        "[gateways] discovery candidate exceeded the metadata size cap",
                        url=target.original_url,
                    )
                    return None
        except httpx.RequestError:
            return None
        finally:
            await response.aclose()

        # Rebuilt without the headers that describe the encoded body: what was read is
        # decoded, and saying otherwise made every compressed metadata document a
        # `DecodingError` at the first `.content`.
        return decoded_response(response, bytes(body))

    async def discover(
        self,
        *,
        server_url: str,
        challenge: Optional[httpx.Response] = None,
    ) -> MCPOAuthDiscovery:
        """Discover how `server_url` is authorized.

        `challenge` is the refusal the caller already received from `server_url`. When it
        is given, its `WWW-Authenticate` names the protected-resource document, and no
        second anonymous request is sent to recover it.
        """
        async with self._client() as client:
            prm = await self._discover_protected_resource(
                client, server_url=server_url, challenge=challenge
            )
            if prm is not None:
                authorization_server = str(prm.authorization_servers[0])
                resource = str(prm.resource)
                resource_scopes = prm.scopes_supported
            else:
                # A server with no protected-resource document is its own authorization
                # server, at its origin, as the MCP authorization specification read
                # before it adopted RFC 9728. Only an absent document gets here: one that
                # was found and refused has already raised.
                authorization_server = _authorization_base_url(server_url)
                _check_https(
                    authorization_server,
                    label="authorization server",
                    server_url=server_url,
                )
                resource = None
                resource_scopes = None
            metadata = await self._discover_authorization_server(
                client, authorization_server=authorization_server
            )

        return MCPOAuthDiscovery(
            resource=resource,
            authorization_server=authorization_server,
            scopes_offered=resource_scopes or metadata.scopes_supported or [],
            authorization_endpoint=str(metadata.authorization_endpoint),
            token_endpoint=str(metadata.token_endpoint),
            registration_endpoint=(
                str(metadata.registration_endpoint)
                if metadata.registration_endpoint
                else None
            ),
            client_id_metadata_document_supported=bool(
                metadata.client_id_metadata_document_supported
            ),
        )

    async def _discover_protected_resource(
        self,
        client: httpx.AsyncClient,
        *,
        server_url: str,
        challenge: Optional[httpx.Response] = None,
    ) -> Optional[ProtectedResourceMetadata]:
        """The server's protected-resource document, or `None` when it publishes none.

        `None` only on a confirmed absence: every candidate answered 404 or 410. Anything
        else that yields no usable document is a discovery error and never the fallback
        to the origin: a candidate that answered 200 with something unusable, a 5xx, a
        timeout, a refused address, or a body over the size cap. A server whose document
        is merely unreachable must not have its authorization server guessed.
        """
        if challenge is None:
            challenge = await self._get(client, server_url)
        resource_metadata_url = (
            _resource_metadata_url_from_response(challenge) if challenge else None
        )
        unreadable = False
        for url in _protected_resource_urls(
            server_url, resource_metadata_url=resource_metadata_url
        ):
            response = await self._get(client, url)
            if response is not None and response.status_code in (404, 410):
                continue
            if response is None or response.status_code != 200:
                unreadable = True
                continue
            try:
                prm = ProtectedResourceMetadata.model_validate_json(response.content)
            except ValidationError:
                unreadable = True
                continue
            # Refuse rather than walk on. A document that parses but describes another
            # resource is the upstream answering a question nobody asked; trying the
            # next candidate would let a server publish one good document and one bad
            # one and have the bad one taken when the good one is momentarily absent.
            _check_protected_resource(prm, server_url=server_url)
            return prm
        if unreadable:
            raise MCPOAuthDiscoveryError(
                server_url=server_url,
                detail="the protected-resource metadata could not be read",
            )
        return None

    async def _discover_authorization_server(
        self, client: httpx.AsyncClient, *, authorization_server: str
    ) -> OAuthMetadata:
        """Fetch the authorization server's metadata from the ISSUER's well-known URL.

        `authorization_server` is the issuer identifier the protected-resource document
        named, and it is the only input to the URLs walked here. No metadata document and
        no metadata URL the MCP server supplies is ever read: that is what lets the
        endpoints this document publishes be accepted on any origin.
        """
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
            # The callback is a web page on Agenta's address. The SDK's default, native,
            # is for clients that redirect to a loopback address or an app scheme.
            application_type="web",
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
                failure = classify_transport_error(e)
                raise MCPOAuthRegistrationError(
                    authorization_server=authorization_server, detail=failure.detail
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
            "code_verifier": code_verifier,
        }
        if resource:
            data["resource"] = resource

        return await self._post_token_request(
            token_endpoint=token_endpoint, data=data, client_info=client_info
        )

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
        }
        if scopes:
            data["scope"] = " ".join(scopes)
        if resource:
            data["resource"] = resource

        return await self._post_token_request(
            token_endpoint=token_endpoint, data=data, client_info=client_info
        )

    async def _post_token_request(
        self,
        *,
        token_endpoint: str,
        data: Dict[str, Any],
        client_info: OAuthClientInformationFull,
    ) -> OAuthToken:
        try:
            data, authorization = client_authentication(client_info, data)
        except ValueError as e:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint, detail=str(e)
            ) from e
        try:
            target = await open_egress(
                token_endpoint,
                above_caller={
                    "Content-Type": "application/x-www-form-urlencoded",
                    **authorization,
                },
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
                # This request carries the client secret and the authorization code
                # (OR86).
                failure = classify_transport_error(e)
                raise MCPOAuthTokenExchangeError(
                    token_endpoint=token_endpoint,
                    detail=failure.detail,
                    temporary=True,
                ) from e

        # Status and origin only; see `register` above for why the body stays here.
        if response.status_code != 200:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint,
                detail=f"{response.status_code} from {_origin(token_endpoint)}",
                temporary=response.status_code == 429 or response.status_code >= 500,
            )
        try:
            return OAuthToken.model_validate_json(response.content)
        except ValidationError as e:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint,
                detail=f"malformed token response from {_origin(token_endpoint)}",
            ) from e
