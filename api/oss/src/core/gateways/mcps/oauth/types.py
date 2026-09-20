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


class MCPOAuthRegistrationUnavailableError(MCPOAuthRegistrationError):
    """The authorization server offers no way for this deployment to name itself.

    It advertises no registration endpoint, and this deployment is not publicly
    resolvable, so it cannot serve a client-id metadata document either. Nothing is
    wrong with the request; there is simply no path, and the operator has to make the
    deployment reachable or register a client by hand.
    """

    def __init__(self, *, authorization_server: str):
        super().__init__(
            authorization_server=authorization_server,
            detail=(
                "it advertises no registration endpoint and this deployment is not "
                "publicly reachable, so no client identity can be established"
            ),
        )


class MCPOAuthTokenExchangeError(GatewaysError):
    """The token endpoint refused the authorization-code exchange."""

    def __init__(self, *, token_endpoint: str, detail: Optional[str] = None):
        self.token_endpoint = token_endpoint
        self.detail = detail
        super().__init__(f"Token exchange failed at {token_endpoint}: {detail}")


class MCPOAuthRefreshFailedError(GatewaysError):
    """The stored grant is expired and could not be renewed.

    Raised when there is no refresh token to present, or when the authorization server
    refused the one there is. Either way the grant is dead and only the person who
    granted it can replace it, so the data plane turns this into a reconnect refusal
    rather than relaying a call that would come back 401 forever.
    """

    def __init__(self, *, server_url: str, detail: Optional[str] = None):
        self.server_url = server_url
        self.detail = detail
        super().__init__(
            f"The stored authorization for {server_url} expired and could not be "
            f"renewed: {detail}"
            if detail
            else f"The stored authorization for {server_url} expired and could not be renewed"
        )


class MCPOAuthRegistrationUnresolvablePinError(MCPOAuthRefreshFailedError):
    """The grant names a client registration that is gone or no longer usable.

    A grant records which client the authorization server issued it to, so a renewal can
    present that one. When the row behind that reference cannot be read, there is nothing
    to fall back to: any other client at the same issuer was never issued these tokens,
    and the deployment's own identity document least of all, so presenting either gets
    the refresh refused with an error about a client rather than about a credential.

    A refresh failure rather than its own kind of problem, because the outcome for the
    person is the one a refresh failure already produces: the connection needs consenting
    to again, which mints a fresh registration along with fresh tokens (N3).
    """

    def __init__(self, *, server_url: str, registration_slug: str):
        self.registration_slug = registration_slug
        super().__init__(
            server_url=server_url,
            detail=(
                "the client registration this authorization was issued against is no "
                "longer available, so it cannot be renewed; connect again"
            ),
        )


class MCPOAuthIssuerChangedError(MCPOAuthRefreshFailedError):
    """The MCP server now names an authorization server other than the one that issued
    the stored grant, so the refresh token is not presented at all.

    The protected-resource document is published by the MCP server itself, so a server
    that was honest at connect time can later point at an authorization server it
    controls; every discovery check still passes, because they only ask whether that
    document is internally consistent. The grant records the issuer it was created
    against, and a renewal must still meet it.

    A `MCPOAuthRefreshFailedError` because that is exactly what it is for the caller:
    the relay marks the endpoint invalid and offers the reconnect it offers any dead
    grant. Reconnecting is also the legitimate way through a real issuer migration —
    the person consents at the new authorization server, and the new grant pins it.
    """

    def __init__(
        self,
        *,
        server_url: str,
        stored_issuer: Optional[str],
        named_issuer: Optional[str],
    ):
        self.stored_issuer = stored_issuer
        self.named_issuer = named_issuer
        detail = (
            f"the stored grant was issued by {stored_issuer}, and {server_url} now "
            f"names {named_issuer}"
            if stored_issuer
            else "the stored grant does not record which authorization server issued it"
        )
        super().__init__(server_url=server_url, detail=detail)


class MCPOAuthStateInvalidError(GatewaysError):
    """No authorization attempt answers the callback's `state` handle.

    Either it was never issued, or it has already been used: a handle is consumed by
    the first callback that presents it, so a replay lands here.
    """

    def __init__(self, message: Optional[str] = None):
        super().__init__(message or "OAuth state is invalid or expired")


class MCPOAuthStateExpiredError(MCPOAuthStateInvalidError):
    """The attempt exists but its window has closed. Consumed all the same, so an
    expired handle cannot be presented twice either."""

    def __init__(self):
        super().__init__("OAuth state has expired")


class MCPOAuthCallerMismatchError(GatewaysError):
    """The callback was presented by someone other than the user who started the
    attempt, or by nobody at all.

    The authorization server sees `state`, so a single-use record narrows the window
    but does not by itself prove who is at the other end of the redirect. The session
    behind the callback does. The attempt is left intact: refusing costs the rightful
    browser nothing, and nothing is written on this path.
    """

    def __init__(self):
        super().__init__(
            "This connection was started by a different Agenta user, or by a "
            "browser with no Agenta session"
        )


class MCPOAuthClientNotRegisteredError(GatewaysError):
    """The state verified, but no client registration is on file for its
    authorization server — `begin()` always registers first, so this means the
    registration was deleted between the redirect and the callback."""

    def __init__(self, *, server_url: str):
        self.server_url = server_url
        super().__init__(f"No OAuth client registration on file for {server_url}")
