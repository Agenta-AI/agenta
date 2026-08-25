"""Domain exceptions for the MCP OAuth client."""

from typing import Optional

from oss.src.core.gateways.types import GatewaysError


class MCPOAuthDiscoveryError(GatewaysError):
    """No protected-resource or authorization-server metadata could be found."""

    def __init__(self, *, server_url: str, detail: Optional[str] = None):
        self.server_url = server_url
        self.detail = detail
        super().__init__(f"OAuth discovery failed for {server_url}: {detail}")


class MCPOAuthRegistrationError(GatewaysError):
    """RFC 7591 dynamic client registration failed."""

    def __init__(self, *, authorization_server: str, detail: Optional[str] = None):
        self.authorization_server = authorization_server
        self.detail = detail
        super().__init__(
            f"Client registration failed at {authorization_server}: {detail}"
        )


class MCPOAuthTokenExchangeError(GatewaysError):
    """The token endpoint refused the authorization-code exchange."""

    def __init__(self, *, token_endpoint: str, detail: Optional[str] = None):
        self.token_endpoint = token_endpoint
        self.detail = detail
        super().__init__(f"Token exchange failed at {token_endpoint}: {detail}")


class MCPOAuthStateInvalidError(GatewaysError):
    """The callback's `state` parameter did not verify — tampered or expired."""

    def __init__(self):
        super().__init__("OAuth state is invalid or expired")


class MCPOAuthClientNotRegisteredError(GatewaysError):
    """The state verified, but no client registration is on file for its
    authorization server — `begin()` always registers first, so this means the
    registration was deleted between the redirect and the callback."""

    def __init__(self, *, server_url: str):
        self.server_url = server_url
        super().__init__(f"No OAuth client registration on file for {server_url}")
