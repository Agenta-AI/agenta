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

from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthDiscovery
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthTokenExchangeError,
)

_TIMEOUT_SECONDS = 15.0


def _authorization_base_url(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


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


class MCPOAuthClient:
    def __init__(self, *, transport: Optional[httpx.BaseTransport] = None) -> None:
        # Injectable seam for tests, matching HttpMCPAdapter / ComposioConnectionsAdapter.
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, transport=self._transport)

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
            try:
                response = await client.get(url)
            except httpx.RequestError:
                continue
            if response.status_code != 200:
                continue
            try:
                return ProtectedResourceMetadata.model_validate_json(response.content)
            except ValidationError:
                continue
        raise MCPOAuthDiscoveryError(
            server_url=server_url, detail="no protected-resource metadata found"
        )

    async def _probe_resource_metadata_url(
        self, client: httpx.AsyncClient, *, server_url: str
    ) -> Optional[str]:
        try:
            response = await client.get(server_url)
        except httpx.RequestError:
            return None
        return _resource_metadata_url_from_response(response)

    async def _discover_authorization_server(
        self, client: httpx.AsyncClient, *, authorization_server: str
    ) -> OAuthMetadata:
        for url in _authorization_server_metadata_urls(authorization_server):
            try:
                response = await client.get(url)
            except httpx.RequestError:
                continue
            if response.status_code != 200:
                continue
            try:
                return OAuthMetadata.model_validate_json(response.content)
            except ValidationError:
                continue
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

        async with self._client() as client:
            try:
                response = await client.post(endpoint, json=body)
            except httpx.RequestError as e:
                raise MCPOAuthRegistrationError(
                    authorization_server=authorization_server, detail=str(e)
                ) from e

        if response.status_code not in (200, 201):
            raise MCPOAuthRegistrationError(
                authorization_server=authorization_server,
                detail=f"{response.status_code} {response.text}",
            )
        try:
            return OAuthClientInformationFull.model_validate_json(response.content)
        except ValidationError as e:
            raise MCPOAuthRegistrationError(
                authorization_server=authorization_server, detail=str(e)
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

        async with self._client() as client:
            try:
                response = await client.post(
                    token_endpoint,
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            except httpx.RequestError as e:
                raise MCPOAuthTokenExchangeError(
                    token_endpoint=token_endpoint, detail=str(e)
                ) from e

        if response.status_code != 200:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint,
                detail=f"{response.status_code} {response.text}",
            )
        try:
            return OAuthToken.model_validate_json(response.content)
        except ValidationError as e:
            raise MCPOAuthTokenExchangeError(
                token_endpoint=token_endpoint, detail=str(e)
            ) from e
