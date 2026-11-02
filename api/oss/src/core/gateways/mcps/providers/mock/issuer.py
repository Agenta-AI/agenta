"""A mock OAuth authorization server, served by the mock MCP container itself.

The MCP OAuth client (`core/gateways/mcps/oauth/client.py`) had never been run against a
real socket: the acceptance suite seeded an `oauth_grant` secret by hand and relayed with
it, and the integration suite drove the client through an in-process httpx transport. Both
skip the two things a consent flow is made of — a browser redirect and a token endpoint —
so nothing exercised discovery, the authorization redirect, or the PKCE check over HTTP.

This module is the missing counterpart. It is one authorization server and one
OAuth-protected MCP surface, both on the mock MCP container, so the whole flow runs over
the same Docker network the gateway already dials:

    GET  /oauth/mcp                                       401 + WWW-Authenticate
    POST /oauth/mcp                                       the MCP server, bearer required
    GET  /.well-known/oauth-protected-resource            RFC 9728
    GET  /.well-known/oauth-protected-resource/oauth/mcp  RFC 9728, path-inserted form
    GET  /.well-known/oauth-authorization-server          RFC 8414
    GET  /oauth/authorize                                 redirects back with a code
    POST /oauth/token                                     code (or refresh) -> bearer
    POST /oauth/register                                  RFC 7591 -> a client_id

It serves a SECOND issuer under `/noreg` that advertises no registration endpoint, so
both branches of client identity stay testable: registration, which every real server
this gateway has met uses, and the client-id metadata document, which is the fallback for
a server that cannot be registered with. The `/noreg` issuer has a path, so it also
covers the RFC 8414 s3.1 path-inserted metadata location.

There is no consent screen and no login. The authorize endpoint redirects straight back,
because what has to be testable is the *shape* of the flow — a redirect a browser and a
test can both follow — not a human pressing a button.

**PKCE is enforced, and that is the point.** The authorize step refuses a request with no
`S256` challenge and records the challenge it was given; the token step recomputes
`BASE64URL(SHA256(code_verifier))` and refuses any mismatch with `invalid_grant`. A mock
that accepted any verifier would let a broken PKCE implementation pass as working, which
is exactly the failure this module exists to catch.

Everything is process-local and in memory: codes, bearers and refresh tokens die with the
container, which is what a fixture should do. The whole router is wired only while
`AGENTA_GATEWAYS_MOCKS_ENABLED` is on (`app.py`), the same gate the mock adapters are
registered behind in `api/entrypoints/routers.py`.
"""

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from oss.src.utils.env import env

# The OAuth-protected MCP surface. A separate path from `/`, deliberately: `/` is the
# unauthenticated mock every existing contract and matrix test speaks to, and turning it
# into a 401 would break all of them. An MCP deployment routinely serves one server
# authenticated and another not, so two paths is the honest shape as well as the safe one.
MCP_PATH = "/oauth/mcp"
AUTHORIZE_PATH = "/oauth/authorize"
TOKEN_PATH = "/oauth/token"
REGISTER_PATH = "/oauth/register"
PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"
AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server"

# A SECOND issuer identity, serving the same authorize and token endpoints but
# advertising no registration endpoint. It exists so the identity-document branch of
# `_resolve_client_info` stays reachable now that the default issuer registers.
#
# It is a path under the same origin, which makes it the RFC 8414 s3.1 path-inserted
# case: its metadata is fetched from `/.well-known/oauth-authorization-server/noreg`,
# not from a well-known URL under the path. That is a second thing worth testing, since
# every real issuer this gateway has met so far has been path-less.
UNREGISTERED_PREFIX = "/noreg"

SCOPES_SUPPORTED = ["tools:list", "tools:call"]

_CODE_TTL_SECONDS = 300
_ACCESS_TOKEN_TTL_SECONDS = 3600


def base_url() -> str:
    """The origin this issuer publishes itself under.

    Read from the same `AGENTA_MOCK_MCP_GATEWAY_URL` the API reads, so the issuer
    identifier in the metadata is byte-identical to the URL the gateway dialled — RFC 8414
    s3.3 compares issuers as strings, and `_check_authorization_server` enforces it.

    `AGENTA_MOCK_MCP_GATEWAY_PUBLIC_URL` overrides it for a stack whose consent flow runs in
    a real browser, which cannot resolve a Docker name. It replaces the base in EVERY
    document rather than only in `authorization_endpoint`: the issuer identifier and the
    `resource` are compared against the address discovery reached, so publishing two bases
    would make the issuer refuse its own metadata. Configure the MCP server under the same
    public address.
    """
    return (env.mock_gateways.mcp_public_url or env.mock_gateways.mcp_url).rstrip("/")


def unregistered_base_url() -> str:
    """The issuer identity that advertises no registration endpoint."""
    return f"{base_url()}{UNREGISTERED_PREFIX}"


def resource_metadata_url(*, base: Optional[str] = None) -> str:
    """The RFC 9728 s3.1 location for `MCP_PATH`: the path is INSERTED after the segment."""
    return f"{base or base_url()}{PROTECTED_RESOURCE_PATH}{MCP_PATH}"


def _s256(verifier: str) -> str:
    """RFC 7636 s4.6: BASE64URL(SHA256(ASCII(code_verifier))), unpadded."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


@dataclass
class _AuthorizationCode:
    code_challenge: str
    redirect_uri: str
    client_id: str
    scopes: List[str]
    expires_at: float


@dataclass
class _RegisteredClient:
    """What RFC 7591 registration binds a `client_id` to.

    `redirect_uris` is the load-bearing member: a registration is bound to the callbacks
    it was created with, and an authorization server that took any redirect URI would let
    a broken re-registration path pass as working. That is the defect `registration_covers`
    exists to catch, so this mock has to be strict about it for the test to mean anything.
    """

    redirect_uris: List[str]
    scope: Optional[str]


@dataclass
class _Grant:
    scopes: List[str]
    client_id: str
    expires_at: float


@dataclass
class _Store:
    """Process-local issuer state. A fixture keeps nothing across a restart."""

    codes: Dict[str, _AuthorizationCode] = field(default_factory=dict)
    clients: Dict[str, _RegisteredClient] = field(default_factory=dict)
    access_tokens: Dict[str, _Grant] = field(default_factory=dict)
    refresh_tokens: Dict[str, _Grant] = field(default_factory=dict)


_store = _Store()


def _error(status_code: int, error: str, description: str) -> JSONResponse:
    """RFC 6749 s5.2 error body."""
    return JSONResponse(
        status_code=status_code,
        content={"error": error, "error_description": description},
    )


def bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("Authorization") or ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def is_authorized(token: Optional[str]) -> bool:
    if not token:
        return False
    grant = _store.access_tokens.get(token)
    if grant is None:
        return False
    if grant.expires_at <= time.time():
        del _store.access_tokens[token]
        return False
    return True


def challenge(*, base: Optional[str] = None) -> Response:
    """RFC 9728 s5.1: the 401 that tells a client where to start discovery."""
    return JSONResponse(
        status_code=401,
        content={
            "error": "invalid_token",
            "error_description": "bearer token required",
        },
        headers={
            "WWW-Authenticate": (
                'Bearer realm="agenta-mock-mcp", '
                f'resource_metadata="{resource_metadata_url(base=base)}"'
            )
        },
    )


Relay = Callable[[Request], Awaitable[Response]]


def build_oauth_router(*, relay: Relay) -> APIRouter:
    """The issuer and the MCP surface it protects, as one router.

    `relay` is the mock MCP server's own request handler, reused verbatim so the
    authenticated surface answers the same bytes as `/` once the bearer is accepted. A
    second implementation here would be a second protocol to debug.
    """
    router = APIRouter()

    # Protected resource

    @router.get(MCP_PATH)
    async def challenge_on_probe() -> Response:
        """The client's first move is a GET at the server URL, whose 401 names the
        protected-resource document (RFC 9728 s3). `/` answers 405 to a GET, which is
        correct for a Streamable HTTP server with no SSE leg but tells a client nothing."""
        return challenge()

    @router.post(MCP_PATH)
    async def protected_relay(request: Request) -> Response:
        if not is_authorized(bearer_token(request)):
            return challenge()
        return await relay(request)

    # Discovery

    @router.get(PROTECTED_RESOURCE_PATH)
    @router.get(f"{PROTECTED_RESOURCE_PATH}{MCP_PATH}")
    async def protected_resource_metadata() -> Response:
        return JSONResponse(
            content={
                "resource": f"{base_url()}{MCP_PATH}",
                "authorization_servers": [base_url()],
                "scopes_supported": SCOPES_SUPPORTED,
                "bearer_methods_supported": ["header"],
                "resource_name": "Agenta mock MCP server",
            }
        )

    @router.get(AUTHORIZATION_SERVER_PATH)
    async def authorization_server_metadata() -> Response:
        return JSONResponse(
            content={
                "issuer": base_url(),
                "authorization_endpoint": f"{base_url()}{AUTHORIZE_PATH}",
                "token_endpoint": f"{base_url()}{TOKEN_PATH}",
                "scopes_supported": SCOPES_SUPPORTED,
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
                # RFC 7591 registration, which is what the real servers this gateway has
                # met do: Linear and Axiom both advertise one, and a client-id metadata
                # document is a draft almost nothing implements. It is advertised by
                # default so the mock exercises the branch `_resolve_client_info` takes
                # against a real provider. The identity-document branch keeps its own
                # issuer at `UNREGISTERED_PREFIX`, which advertises no registration.
                "registration_endpoint": f"{base_url()}{REGISTER_PATH}",
            }
        )

    @router.post(REGISTER_PATH)
    async def register(request: Request) -> Response:
        """RFC 7591 s3.1: take client metadata, answer with a `client_id`.

        The registration is bound to the `redirect_uris` it was given, and `authorize`
        refuses any other callback for this client. A mock that took whatever redirect URI
        arrived would let a stale or mis-scoped registration pass as working, which is the
        failure `registration_covers` was written for.
        """
        try:
            body = await request.json()
        except Exception:  # pylint: disable=broad-except
            body = None
        if not isinstance(body, dict):
            return _error(400, "invalid_client_metadata", "a JSON object is required")

        redirect_uris = body.get("redirect_uris")
        if not isinstance(redirect_uris, list) or not redirect_uris:
            return _error(
                400, "invalid_redirect_uri", "at least one redirect_uri is required"
            )

        scope = body.get("scope")
        client_id = f"mock-client-{secrets.token_urlsafe(12)}"
        _store.clients[client_id] = _RegisteredClient(
            redirect_uris=[str(uri) for uri in redirect_uris],
            scope=scope if isinstance(scope, str) else None,
        )

        registered = {
            "client_id": client_id,
            "client_id_issued_at": int(time.time()),
            "redirect_uris": [str(uri) for uri in redirect_uris],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            # No secret is issued: the token endpoint authenticates nobody, which is what
            # `token_endpoint_auth_methods_supported` already advertises.
            "token_endpoint_auth_method": "none",
            "client_name": body.get("client_name") or "Agenta",
        }
        if isinstance(scope, str) and scope:
            registered["scope"] = scope
        return JSONResponse(status_code=201, content=registered)

    # The second issuer: no registration endpoint, so a client must name itself with an
    # identity document. Same authorize and token endpoints — an authorization server is
    # free to place those on another origin, and `_check_authorization_server` checks only
    # that the issuer identifier matches, never where the endpoints live.

    @router.get(f"{UNREGISTERED_PREFIX}{MCP_PATH}")
    async def unregistered_challenge_on_probe() -> Response:
        return challenge(base=unregistered_base_url())

    @router.post(f"{UNREGISTERED_PREFIX}{MCP_PATH}")
    async def unregistered_protected_relay(request: Request) -> Response:
        if not is_authorized(bearer_token(request)):
            return challenge(base=unregistered_base_url())
        return await relay(request)

    @router.get(f"{UNREGISTERED_PREFIX}{PROTECTED_RESOURCE_PATH}{MCP_PATH}")
    async def unregistered_protected_resource_metadata() -> Response:
        return JSONResponse(
            content={
                "resource": f"{unregistered_base_url()}{MCP_PATH}",
                "authorization_servers": [unregistered_base_url()],
                "scopes_supported": SCOPES_SUPPORTED,
                "bearer_methods_supported": ["header"],
                "resource_name": "Agenta mock MCP server, unregistered clients",
            }
        )

    @router.get(f"{AUTHORIZATION_SERVER_PATH}{UNREGISTERED_PREFIX}")
    async def unregistered_authorization_server_metadata() -> Response:
        """RFC 8414 s3.1: for an issuer WITH a path, the well-known segment is inserted
        between the authority and that path, so this issuer is described here rather than
        under its own path."""
        return JSONResponse(
            content={
                "issuer": unregistered_base_url(),
                "authorization_endpoint": f"{base_url()}{AUTHORIZE_PATH}",
                "token_endpoint": f"{base_url()}{TOKEN_PATH}",
                "scopes_supported": SCOPES_SUPPORTED,
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
                # No `registration_endpoint`, deliberately: this is the issuer that forces
                # the identity-document branch.
                "client_id_metadata_document_supported": True,
            }
        )

    # Authorization

    @router.get(AUTHORIZE_PATH)
    async def authorize(request: Request) -> Response:
        """Consent without a consent screen: straight back to the redirect URI with a code.

        Only the parameters a flow can be wrong about are checked. PKCE is one of them,
        so a request with no `S256` challenge is refused here rather than at the token
        endpoint, which is where a real OAuth 2.1 server refuses it too.
        """
        params = request.query_params
        if params.get("response_type") != "code":
            return _error(
                400, "unsupported_response_type", "response_type must be code"
            )

        redirect_uri = params.get("redirect_uri")
        if not redirect_uri:
            return _error(400, "invalid_request", "redirect_uri is required")

        # A registered client may only come back to a callback it registered. An
        # unregistered `client_id` — the identity-document strategy sends a URL — is left
        # alone, because there is no registration to check it against.
        registered = _store.clients.get(params.get("client_id") or "")
        if registered is not None and redirect_uri not in registered.redirect_uris:
            return _error(
                400,
                "invalid_request",
                "redirect_uri is not registered for this client",
            )

        code_challenge = params.get("code_challenge")
        if not code_challenge:
            return _error(400, "invalid_request", "code_challenge is required")
        if params.get("code_challenge_method") != "S256":
            return _error(400, "invalid_request", "code_challenge_method must be S256")

        code = secrets.token_urlsafe(32)
        _store.codes[code] = _AuthorizationCode(
            code_challenge=code_challenge,
            redirect_uri=redirect_uri,
            client_id=params.get("client_id") or "",
            scopes=(params.get("scope") or "").split(),
            expires_at=time.time() + _CODE_TTL_SECONDS,
        )

        returned = {"code": code}
        state = params.get("state")
        if state:
            returned["state"] = state
        separator = "&" if "?" in redirect_uri else "?"

        # 302, not 307: the browser follows this as a GET, which is what the callback is.
        return RedirectResponse(
            url=f"{redirect_uri}{separator}{urlencode(returned)}", status_code=302
        )

    # Token

    @router.post(TOKEN_PATH)
    async def token(request: Request) -> Response:
        form = await request.form()
        grant_type = form.get("grant_type")

        if grant_type == "refresh_token":
            return _refresh(str(form.get("refresh_token") or ""))
        if grant_type != "authorization_code":
            return _error(
                400, "unsupported_grant_type", f"unsupported grant_type: {grant_type}"
            )

        code = str(form.get("code") or "")
        # Single-use: popped before anything can go wrong with it, so a refused exchange
        # burns the code exactly as a successful one does.
        recorded = _store.codes.pop(code, None)
        if recorded is None:
            return _error(400, "invalid_grant", "unknown or already-used code")
        if recorded.expires_at <= time.time():
            return _error(400, "invalid_grant", "code has expired")
        if str(form.get("redirect_uri") or "") != recorded.redirect_uri:
            return _error(400, "invalid_grant", "redirect_uri does not match")

        verifier = str(form.get("code_verifier") or "")
        if not verifier:
            return _error(400, "invalid_request", "code_verifier is required")
        # The whole reason this mock exists over a socket: a verifier that does not hash
        # to the recorded challenge buys nothing, however well-formed the rest is.
        if not secrets.compare_digest(_s256(verifier), recorded.code_challenge):
            return _error(400, "invalid_grant", "code_verifier does not match")

        return _issue(scopes=recorded.scopes, client_id=recorded.client_id)

    def _refresh(refresh_token: str) -> Response:
        recorded = _store.refresh_tokens.pop(refresh_token, None)
        if recorded is None:
            return _error(400, "invalid_grant", "unknown or already-used refresh token")
        return _issue(scopes=recorded.scopes, client_id=recorded.client_id)

    def _issue(*, scopes: List[str], client_id: str) -> Response:
        access_token = f"mock-oauth-{secrets.token_urlsafe(24)}"
        refresh_token = f"mock-refresh-{secrets.token_urlsafe(24)}"
        grant = _Grant(
            scopes=list(scopes),
            client_id=client_id,
            expires_at=time.time() + _ACCESS_TOKEN_TTL_SECONDS,
        )
        _store.access_tokens[access_token] = grant
        # Rotating, as a real OAuth 2.1 server does, so the refresh path the gateway
        # takes is the one that has to carry the new token forward.
        _store.refresh_tokens[refresh_token] = grant

        return JSONResponse(
            content={
                "access_token": access_token,
                "token_type": "Bearer",
                "expires_in": _ACCESS_TOKEN_TTL_SECONDS,
                "refresh_token": refresh_token,
                "scope": " ".join(scopes),
            }
        )

    return router
