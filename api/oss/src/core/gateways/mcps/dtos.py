"""MCP gateway DTOs."""

from urllib.parse import parse_qs, quote, urlsplit

from typing import Annotated, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from oss.src.core.gateway.connections.dtos import Connection
from oss.src.core.gateways.dtos import (
    GatewayAuthScheme,
    GatewayEndpointFilter,
    GatewayEndpointNamespace,
    GatewayEndpointRoute,
    GatewayEndpointSettings,
)
from oss.src.core.gateways.policy.dtos import ResolvedSecret
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
    Status,
)


MCPAuthScheme = GatewayAuthScheme


# Builtin MCP providers.
AGENTA_PROVIDER = "agenta"
COMPOSIO_PROVIDER = "composio"
MOCK_PROVIDER = "mock"
# Paid actions on provider accounts Agenta holds (`core/managed_tools`).
MANAGED_PROVIDER = "managed"


# Stands in for the secret in a stored `base_url` whose server takes its key in the path
# (Firecrawl `/{secret}/v2/mcp`). The relay puts the vault value there at request time.
URL_SECRET_PLACEHOLDER = "{secret}"


def with_url_secret(url: str, value: str) -> str:
    """`url` with the placeholder replaced by `value`, encoded as one path segment.

    Encoded with nothing kept safe, so a `/` or a `?` in a key stays inside the segment it
    replaces and cannot change where the request goes.
    """
    return url.replace(URL_SECRET_PLACEHOLDER, quote(value, safe=""), 1)


class MCPCredentialBinding(BaseModel):
    """Where an API-key endpoint's credential goes when the relay sends it.

    Configuration only: the value stays in the vault behind the endpoint's `secret_id`, so
    this is as readable as `base_url` is. `kind` and `name` match the SDK's
    `HeaderCredentialBinding`. A `header` binding sends `<name>: <prefix> <value>`, or
    `<name>: <value>` with no prefix; a `query` binding adds `<name>=<value>` to the
    upstream URL at request time; a `url` binding puts the value where `base_url` holds
    `{secret}`. The stored URL never holds the value. The prefix is the scheme word
    (`Bearer`, `Basic`) a server expects in front of the value, because a raw key under
    `Authorization` is refused by every server that names a scheme.
    """

    kind: Literal["header", "query", "url"] = "header"
    name: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    ] = None
    prefix: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    ] = None

    @model_validator(mode="after")
    def _fits_its_kind(self) -> "MCPCredentialBinding":
        if self.kind == "url":
            # The placeholder says where the value goes, so there is nothing to name.
            if self.name is not None or self.prefix is not None:
                raise ValueError("a url credential binding takes no name and no prefix")
            return self
        if self.name is None:
            raise ValueError(f"a {self.kind} credential binding needs a name")
        # A scheme word belongs in a header. In a query value it would be sent as part of
        # the key, and the echo scanner would look for the prefixed form only.
        if self.kind == "query" and self.prefix is not None:
            raise ValueError("a query credential binding takes no prefix")
        return self


def check_url_secret_placeholder(
    base_url: Optional[str], binding: Optional[MCPCredentialBinding]
) -> None:
    """Refuse a `base_url` and a binding that disagree about `{secret}`. Raises `ValueError`.

    A `url` binding with no placeholder would send nothing, and a placeholder with no `url`
    binding would be sent to the server as the literal text. The placeholder must sit in the
    path, where the encoded value cannot change the host the egress check approved.
    """
    url = base_url or ""
    count = url.count(URL_SECRET_PLACEHOLDER)
    if binding is not None and binding.kind == "url":
        if count != 1 or URL_SECRET_PLACEHOLDER not in urlsplit(url).path:
            raise ValueError(
                f"The URL needs exactly one {URL_SECRET_PLACEHOLDER} in its path for the "
                "secret to replace."
            )
    elif count:
        raise ValueError(
            f"The URL contains {URL_SECRET_PLACEHOLDER}, which only a secret sent in the "
            "URL can replace. Send the secret in the URL, or remove "
            f"{URL_SECRET_PLACEHOLDER} from the URL."
        )


class MCPEndpointRoute(GatewayEndpointRoute):
    """Route for one MCP server.

    `credential_binding` says how an API-key endpoint's credential travels. None sends
    `Authorization: Bearer <key>`, and an OAuth endpoint ignores it because a grant
    travels under the scheme its authorization server issued it with.
    """

    credential_binding: Optional[MCPCredentialBinding] = None

    @model_validator(mode="after")
    def _no_credential_in_base_url(self) -> "MCPEndpointRoute":
        binding = self.credential_binding
        check_url_secret_placeholder(self.base_url, binding)
        # The relay adds the bound parameter at request time. A stored URL that already
        # carries it would keep the key in plain text on the row.
        if binding is None or binding.kind != "query" or not self.base_url:
            return self
        query = parse_qs(urlsplit(self.base_url).query, keep_blank_values=True)
        if binding.name in query:
            raise ValueError(
                f"base_url carries the query parameter {binding.name!r}, which the "
                "credential binding fills from the vault; remove it from the URL"
            )
        return self


# The MCP plane's name for the shared filter. Same shape, same storage.
MCPToolFilter = GatewayEndpointFilter


class MCPEndpointSettings(GatewayEndpointSettings):
    """MCP endpoint settings."""


class MCPOAuthData(BaseModel):
    """Non-secret OAuth discovery metadata."""

    resource: Optional[str] = None
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)


MCPTokenEndpointAuthMethod = Literal[
    "client_secret_basic", "client_secret_post", "none"
]


class MCPOAuthConfig(BaseModel):
    """What the person chose for an OAuth connection, apart from what discovery found.

    `client_id` is an OAuth app the person registered with the provider in advance, for a
    server that registers no clients on its own (GitHub, HubSpot, Asana). It is used before
    any registration Agenta would make. `client_secret_id` names the project secret that
    holds the app's secret; the value stays in the vault. `token_endpoint_auth_method` is
    how that secret is sent, and defaults to the request body when a secret is set.

    The scopes are not here: the connect request carries the person's selection.
    """

    client_id: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    ] = None
    client_secret_id: Optional[UUID] = None
    token_endpoint_auth_method: Optional[MCPTokenEndpointAuthMethod] = None

    @model_validator(mode="after")
    def _client_fields_need_a_client(self) -> "MCPOAuthConfig":
        if self.client_id is None and (
            self.client_secret_id is not None
            or self.token_endpoint_auth_method is not None
        ):
            raise ValueError("A client secret or auth method needs a client ID.")
        method = self.token_endpoint_auth_method
        if method is not None and (method == "none") != (self.client_secret_id is None):
            raise ValueError(
                "Use the auth method none without a client secret, and a "
                "client_secret method with one."
            )
        return self


class MCPEndpointData(BaseModel):
    route: MCPEndpointRoute = Field(default_factory=MCPEndpointRoute)
    tools: MCPToolFilter = Field(default_factory=MCPToolFilter)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
    # What discovery found. Rewritten by every discovery, so nothing the person chose
    # lives here.
    oauth: Optional[MCPOAuthData] = None
    oauth_config: Optional[MCPOAuthConfig] = None


class MCPEndpointFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True


class MCPEndpoint(Identifier, Slug, Header, Lifecycle, Metadata):
    auth_mode: MCPAuthScheme
    namespace: GatewayEndpointNamespace = GatewayEndpointNamespace.CUSTOM
    secret_id: Optional[UUID] = None
    connection_id: Optional[UUID] = None
    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)
    status: Optional[Status] = None


def is_oauth_connection_at(
    endpoint: Optional[Union[MCPEndpoint, "MCPEndpointEdit"]], server_url: str
) -> bool:
    """Whether a connection is still OAuth at this address, so a grant issued for that
    address may be bound to it."""
    return (
        endpoint is not None
        and endpoint.auth_mode == MCPAuthScheme.OAUTH
        and endpoint.data.route.base_url == server_url
    )


def configured_oauth_client(
    endpoint: Optional[Union[MCPEndpoint, "MCPEndpointEdit"]],
) -> Optional[str]:
    """The OAuth client a person entered for this connection, or `None` for none."""
    config = endpoint.data.oauth_config if endpoint is not None else None
    return config.client_id if config is not None else None


def is_oauth_connection_for(
    endpoint: Optional[Union[MCPEndpoint, "MCPEndpointEdit"]],
    server_url: str,
    client_id: Optional[str],
) -> bool:
    """Whether a grant issued at this address, to this entered client (`None` for a
    client Agenta chose), may still be bound to the connection."""
    return is_oauth_connection_at(endpoint, server_url) and (
        configured_oauth_client(endpoint) == client_id
    )


def _check_url_binding_mode(auth_mode: MCPAuthScheme, data: MCPEndpointData) -> None:
    """Refuse a `url` binding on a row that sends no API key. Raises `ValueError`.

    Only an API key fills `{secret}`, so any other mode would send the placeholder to the
    server as the literal text.
    """
    binding = data.route.credential_binding
    if (
        binding is not None
        and binding.kind == "url"
        and auth_mode != MCPAuthScheme.API_KEY
    ):
        raise ValueError(
            f"Only an API key can replace {URL_SECRET_PLACEHOLDER} in the URL. Choose API "
            f"key, or remove {URL_SECRET_PLACEHOLDER} from the URL."
        )


class MCPEndpointCreate(Slug, Header, Metadata):
    auth_mode: MCPAuthScheme
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)

    @model_validator(mode="after")
    def _url_binding_needs_a_key(self) -> "MCPEndpointCreate":
        _check_url_binding_mode(self.auth_mode, self.data)
        return self


class MCPEndpointEdit(Identifier, Header, Metadata):
    auth_mode: MCPAuthScheme  # editable: none -> oauth; service revalidates secret_id
    secret_id: Optional[UUID] = None
    #
    data: MCPEndpointData
    flags: MCPEndpointFlags = Field(default_factory=MCPEndpointFlags)

    @model_validator(mode="after")
    def _url_binding_needs_a_key(self) -> "MCPEndpointEdit":
        _check_url_binding_mode(self.auth_mode, self.data)
        return self


class MCPEndpointQuery(BaseModel):
    auth_mode: Optional[MCPAuthScheme] = None
    slug: Optional[str] = None


class MCPCallContext(BaseModel):
    """MCP method and target extracted from the JSON-RPC request."""

    method: str
    target: Optional[str] = None


class MCPResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
    # Carried from the endpoint's `MCPEndpointRoute`. Never the value: the adapter reads
    # that from the resolved secret it is handed alongside this route.
    credential_binding: Optional[MCPCredentialBinding] = None
    # Standard Composio sessions bind external accounts to this project scope.
    project_id: Optional[UUID] = None


def api_key_value(data: object) -> Optional[str]:
    """The key inside an API-key secret, whichever vault shape holds it.

    Two shapes reach an MCP endpoint. A project-named secret (`custom_secret`), which is
    what the agent config's `header_secret_refs` picks and therefore what registration
    binds, keeps its value in `secret.content`; a provider-key record keeps it in
    `provider.key`. A JSON-format named secret is a map with no single credential in it,
    so it yields nothing rather than a guess at which entry is the key.
    """
    provider = getattr(data, "provider", None)
    key = getattr(provider, "key", None) if provider is not None else None
    if isinstance(key, str) and key:
        return key

    stored = getattr(data, "secret", None)
    content = getattr(stored, "content", None) if stored is not None else None
    return content if isinstance(content, str) and content else None


class MCPDirectAuth(BaseModel):
    """Credentials resolved directly by the gateway."""

    secret: Optional[ResolvedSecret] = None


class MCPBrokeredAuth(BaseModel):
    """A brokered integration connection."""

    connection: Connection


MCPRelayAuth = Union[MCPDirectAuth, MCPBrokeredAuth]
