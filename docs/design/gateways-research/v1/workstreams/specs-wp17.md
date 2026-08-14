# WP17 — OAuth client

**Owns:** `core/gateways/mcps/oauth/` — the storage adapter, the discovery/registration/token
client, and the two-phase connect service. Nothing outside that package.
**Depends on:** WP16. **Blocks:** WP18, WP19, WP20.

This is the spine. WP18 (consent flow), WP19 (step-up) and WP20 (registration fallback) all
call into what this package exposes rather than building their own OAuth plumbing. Read this
whole document before touching those packages — the seams below are the contract.

**Target: the `custom` namespace only.** A `custom` MCP endpoint is a row the user typed a URL
into (`MCPEndpointCreate.data.route.base_url`); when its `auth_mode` is `oauth`, this package is
how it gets a token. `builtin` is Composio-brokered (D30) and never reaches this client — there
is no fallback path from one to the other, and this package imports nothing from
`core/gateway/connections/` (the Composio broker domain; note the singular/plural split between
`core/gateway/` and `core/gateways/` is an existing, deliberate domain boundary — entities.md §1).

---

## What already exists (WP16 + the wave-1/2 seed) and what this package adds

Already in the tree before this package:

- `SecretKind.OAUTH_PROVIDER` / `SecretKind.OAUTH_GRANT` (`core/secrets/enums.py`), their DTOs
  (`OAuthProviderDTO{provider: OAuthProviderSettingsDTO{client_id, client_secret, issuer_url,
  scopes, extra}}`, `OAuthGrantDTO{grant: OAuthGrantSettingsDTO{server, access_token,
  refresh_token?, expires_at?, scopes}}`) and the kind validator's two branches
  (`core/secrets/dtos.py`).
- `MCPEndpoint.secret_id` (one nullable FK to a `secrets` row) and `MCPEndpointData.oauth:
  Optional[MCPOAuthData]` — discovery metadata cached on the row (`resource`,
  `authorization_server`, `scopes_offered`), explicitly "written by the OAuth checkpoint (WP17)"
  (`core/gateways/mcps/dtos.py`).
- `MCPGatewayService._resolve_auth`'s `OAUTH` branch, which already resolves `endpoint.secret_id`
  via `SecretsResolverInterface.resolve(ref=BoundSecretRef(...), mode=PROJECT_ONLY)` and builds
  `MCPDirectAuth(secret=...)` (`core/gateways/mcps/service.py`). This package does not touch that
  method — it only makes sure a `secret_id` naming a live `oauth_grant` exists to resolve.
- `HttpMCPAdapter._authorization_header`, which already reads `auth.secret.secret.data.grant
  .access_token` defensively via `getattr` (`core/gateways/mcps/providers/http/adapter.py`) —
  built before `OAuthGrantSettingsDTO` existed, needs no change now that it does.
- `MCPAuthRequiredError` / `MCPScopeInsufficientError` (`core/gateways/mcps/types.py`) and
  `GatewayConnectionRequirement` / `GatewayConnectAffordance` (`core/gateways/dtos.py`) — typed,
  mapped to HTTP 409 in `apis/fastapi/gateways/exceptions.py` and
  `apis/fastapi/gateways/mcps/proxy.py`, but nothing raises them yet.
- The router seam: `apis/fastapi/gateways/mcps/router.py`'s docstring and entities.md §9 both
  name `POST /endpoints/{endpoint_id}/connect` and `GET /connect/callback` as **(WP18)**, not
  wired in WP9's router. "The callback writes the oauth_grant secret and PUTs `secret_id` through
  `edit_endpoint` — the same door every other field uses." **This package builds no route.** It
  builds the two calls WP18's route handlers will make.

What this package adds, and nothing else:

1. `SecretsTokenStorage` — a storage adapter over `VaultService`, structurally satisfying the
   official MCP Python SDK's `TokenStorage` protocol (`mcp.client.auth.oauth2.TokenStorage`).
2. `MCPOAuthClient` — discovery (protected-resource metadata → authorization-server metadata),
   dynamic client registration, PKCE, and authorization-code token exchange, built from the SDK's
   own DTOs (`mcp.shared.auth`) rather than its `OAuthClientProvider` (see "Why not
   `OAuthClientProvider`" below).
3. `MCPOAuthConnectService` — the two-phase `begin()` / `complete()` orchestration WP18's two
   routes call, plus `discover()` for the scope-selection screen.
4. The state-token shape that survives the round trip through the user's browser and the
   authorization server, and the exact callback URL.
5. `mcp` added to `api/pyproject.toml` as a pinned dependency (it was not one before this
   package — verified against `pyproject.toml`/`uv.lock`).

---

## Why not `OAuthClientProvider`

The SDK ships one client class, `mcp.client.auth.oauth2.OAuthClientProvider(httpx.Auth)`. It is
built for a CLI: `async_auth_flow()` is a single generator that, on a 401, runs discovery,
registration, redirect and token exchange **inline in one coroutine**, blocking on
`redirect_handler` (open a local browser) and `callback_handler` (await a local HTTP listener)
before it can `yield` the retried request. That shape cannot survive a web deployment: the
"redirect" and the "callback" are two different HTTP requests, arbitrarily far apart in time (the
user is on the authorization server's own pages in between), so nothing here can hold one
coroutine open across them — there is no request handler alive to resume.

So this package does not instantiate `OAuthClientProvider`. It reuses the SDK's public, stateless
**pieces** — the Pydantic DTOs in `mcp.shared.auth` (`OAuthClientMetadata`,
`OAuthClientInformationFull`, `OAuthToken`, `OAuthMetadata`, `ProtectedResourceMetadata`) and
`PKCEParameters` from `mcp.client.auth.oauth2` — and drives discovery, registration and token
exchange itself, split across the two calls a web flow actually has. This is still "the official
SDK's client provider" in the sense the launch doc means: the wire types, the RFC-shaped
validation and the PKCE generation are the SDK's, not reinvented. What is reinvented is the
control flow, because the SDK's is CLI-shaped and D26 already ruled out anything CLI-shaped.

`TokenStorage` is a `Protocol` (structural typing) — `SecretsTokenStorage` implements its four
methods without subclassing anything from the SDK.

---

## The storage adapter

```python
class SecretsTokenStorage:  # structurally satisfies mcp.client.auth.oauth2.TokenStorage
    def __init__(self, *, vault_service: VaultService, project_id: UUID, server_url: str): ...

    async def get_tokens(self) -> Optional[OAuthToken]: ...
    async def set_tokens(self, tokens: OAuthToken) -> None: ...
    async def get_client_info(self) -> Optional[OAuthClientInformationFull]: ...
    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None: ...
```

**Scope: one instance per `(project_id, server_url)`.** `OAuthClientProvider` is constructed once
per MCP server in the SDK's own model (`server_url` is a constructor argument, not a per-call
one), and this package keeps that shape: `MCPOAuthConnectService` builds one `SecretsTokenStorage`
per connect attempt, scoped to the endpoint's `data.route.base_url`.

**Ownership: project, not person, for this wave — corrects WP16's spec prose.** WP16's own spec
doc describes `oauth_grant` as "owned by a person"; entities.md, the design's source of record,
is explicit that this is wrong for what ships now: "not gaining an owner column — every gateway
secret is project-owned, full stop" (entities.md §1, the `secrets` table row), and
`SecretsResolver._resolve_bound_secret` already degrades every `SecretMode` to the same
project-only fetch because there is no owner column to filter on. `_resolve_auth`'s own comment
calls this "one consent per server". This package follows entities.md: **one `oauth_grant` per
project per server**, matching the single `MCPEndpoint.secret_id` column exactly (no per-user
fan-out, because there is nowhere to record a user on a secret row today). A future user-owned-
secrets wave is the place `SecretOwnerKind.USER` gets a real lookup; this package does not
simulate it by encoding a user id into a slug.

**No new DAO surface.** `SecretsDAOInterface` has five methods and none of them is "find by kind
+ field" (only `get_by_id`, `get_by_slug`, `list`). This package does not add one. It follows the
exact precedent `SecretsResolver._match_provider_secret` already set for `ProviderKeyRef`: call
`VaultService.list_secrets(project_id=...)`, filter in Python for the right `kind` and the right
identifying field, and get-or-create against the result — `update_secret` on a match,
`create_secret` when there is none. The `secrets.slug` column carries no unique constraint
(`dbs/postgres/secrets/dbas.py`), so idempotency is this scan, not a database guarantee — same as
every other kind in this domain today.

**Keys.**
- `oauth_provider` (client registration) is looked up by `data.provider.issuer_url == <the MCP
  server's authorization server, once discovered>`. Before discovery completes there is no issuer
  to key on, so the first connect attempt for a server always registers fresh; a second `custom`
  endpoint on the same authorization server reuses the row once discovery has run for it too. No
  attempt is made to key provisionally on `server_url` and migrate the row later — that is an
  optimization, not a correctness requirement (worst case: one client registration per server
  instead of one per authorization server, which is exactly today's default before this package
  existed).
- `oauth_grant` (tokens) is looked up by `data.grant.server == <the MCP server's URL>` — matching
  WP16's own framing ("identified by the upstream server rather than by the provider, because
  tokens are audience-bound") and the single `secret_id` column on the endpoint row.
- Both kinds get a deterministic slug via the existing `get_slug_from_name_and_id` helper
  (`utils/helpers.py`), named from the server/issuer host and a stable UUID derived from the
  URL — readable in the CRUD UI, never parsed back.

**`get_tokens()` / `get_client_info()` return `None` on no match** (not an exception) — that is
what the `TokenStorage` protocol signature promises and what lets this package's `begin()` decide
"register" vs. "reuse" and "authorize" vs. "already have a live grant" without a control-flow
exception for the ordinary case.

---

## The two-phase connect service

```python
class MCPOAuthConnectService:
    def __init__(self, *, vault_service: VaultService, client: MCPOAuthClient): ...

    async def discover(self, *, server_url: str) -> MCPOAuthDiscovery:
        """Unauthenticated probe -> protected-resource metadata -> authorization-server
        metadata. Feeds MCPEndpointData.oauth (resource, authorization_server,
        scopes_offered) and the scope checklist WP18's consent screen renders. No
        secret involved — this is discovery, callable before there is anything to
        connect (entities.md §2.3: "fetched at configuration time with no secret at
        all")."""

    async def begin(
        self, *, project_id: UUID, user_id: UUID, server_url: str, scopes: List[str]
    ) -> MCPOAuthAuthorizationStart:
        """Ensures client registration (reuse via storage, else dynamic registration
        RFC 7591), generates PKCE + state, returns {authorization_url, state}. WP18's
        POST /endpoints/{endpoint_id}/connect wraps this: it resolves endpoint_id ->
        server_url first, then calls this with the caller's scope."""

    async def complete(
        self, *, code: str, state: str
    ) -> MCPOAuthCompletion:
        """Decodes+verifies state, re-discovers the token endpoint, exchanges code+
        verifier for tokens, writes the oauth_grant secret via VaultService. Returns
        {project_id, server_url, secret_id} for WP18's GET /connect/callback to PUT
        onto the endpoint's secret_id through edit_endpoint — this package never calls
        edit_endpoint itself, staying inside its own package boundary."""
```

`MCPOAuthClient` (the SDK-DTO-driven HTTP piece both methods above call into) takes an injectable
`httpx.BaseTransport`, matching `HttpMCPAdapter`'s and `ComposioConnectionsAdapter`'s existing
seam for tests.

### The callback URL, precisely

**Fixed redirect URI, registered once, disambiguated by `state` — not by a per-flow URL.**

```
redirect_uri (sent to the authorization server, and what gets registered/matches on file):
    {AGENTA_API_URL}/gateways/mcps/connect/callback

the browser lands on, after the authorization server redirects it:
    {AGENTA_API_URL}/gateways/mcps/connect/callback?code=<auth code>&state=<signed state>
```

This deliberately differs from the precedent in `core/gateway/connections/service.py`
(`callback_url = f"{env.agenta.api_url}{_CALLBACK_PATH}?state={state}"`), which bakes the state
into the registered callback URL. That works for Composio, whose broker does not enforce exact
`redirect_uri` matching the way RFC 6749 authorization servers commonly do. A generic `custom`
MCP server's authorization server is exactly the kind of RFC 6749 implementation that can reject
a redirect URI carrying an unregistered query string. `state` is the mechanism the spec provides
for this — an opaque value that round-trips as its own top-level parameter — so this package uses
it as intended rather than overloading the URL. The full path matches the route entities.md §9
already reserved for WP18: `GET /connect/callback`, mounted under the plane's `/gateways/mcps`
prefix (`api/entrypoints/routers.py`'s mount table).

### The state token

An HMAC-SHA256-signed, base64url payload — the same shape as
`core/gateway/connections/utils.py::make_oauth_state`/`decode_oauth_state`, reimplemented locally
in `core/gateways/mcps/oauth/state.py` rather than imported, to keep this package independent of
the Composio/connections domain (see "target: `custom` only" above). Signed with
`env.agenta.crypt_key`, 1-hour TTL, carrying:

```json
{
  "project_id": "...", "user_id": "...",
  "server_url": "https://mcp.acme.io/",
  "code_verifier": "<43-128 char PKCE verifier>",
  "scopes": ["read", "write"],
  "nonce": "...", "ts": 1234567890
}
```

`code_verifier` travels in the signed state rather than in server-side session storage: there is
no server-side session to put it in (no sticky worker assumption — any replica can serve the
callback), and the state's own HMAC is exactly the tamper protection PKCE's verifier needs in
transit. This is a deliberate, stated choice, not an oversight — flag it for review if a
deployment's threat model wants the verifier off the wire entirely.

---

## Contracts

- **No code path in this package parses or reaches a `builtin` target.** `SecretsTokenStorage`,
  `MCPOAuthClient` and `MCPOAuthConnectService` take a `server_url`, never a `provider`/
  `integration` pair — the builtin two-segment address space (D30) cannot even be expressed as an
  argument here.
- **This package writes secrets; it never writes an `MCPEndpoint` row.** `complete()` returns a
  `secret_id`; wiring it onto `endpoint.secret_id` is `edit_endpoint`, called by WP18's router,
  never by this package. Keeps the "one door" rule entities.md states for that column intact.
- **`get_tokens`/`get_client_info` never raise for "not found".** `None` is the correct answer and
  the caller (this package's own `begin()`) branches on it; only a genuine adapter failure (vault
  unreachable, decrypt failure) raises.
- **Discovery makes no assumption about the target being reachable from here at connect time
  beyond an ordinary outbound HTTP call** — the SSRF guard already gating `custom` endpoint URLs
  at registration (`_guard_custom_endpoint_url`, D28) is not re-applied inside this package,
  because discovery only runs against a URL the CRUD router already validated when the row was
  created or edited. `MCPOAuthClient` still goes through the same resolving-IP connect helper
  (`core/webhooks/utils.py`) used by `HttpMCPAdapter`, for defense in depth against a URL that was
  valid at registration and repoints since.
- **Every state token is single-use in effect, not by a stored nonce ledger.** `complete()`
  consumes the signed state and immediately performs the token exchange; a replayed state still
  passes signature/TTL checks but the second token exchange either fails at the authorization
  server (auth codes are single-use per RFC 6749 §4.1.2) or, in the mock authorization server this
  package's tests use, is asserted against directly. A stored-nonce replay guard is not built —
  flagged as a gap for the mock's threat model, not assumed away.

---

## What WP18, WP19 and WP20 each consume

**WP18 — Consent flow.** Calls `discover()` to render the scope checklist, `begin()` from
`POST /endpoints/{endpoint_id}/connect` (resolving `endpoint_id` to `server_url` itself — this
package takes a bare URL, never an endpoint id, keeping it ignorant of the `mcps_endpoints`
table), and `complete()` from `GET /connect/callback`, then calls `edit_endpoint` with the
returned `secret_id`. WP18 also owns turning a discovery/registration failure into whatever the
dashboard shows — this package's exceptions (below) are typed for that, not swallowed here.

**WP19 — Step-up interaction.** `MCPScopeInsufficientError` (already declared,
`core/gateways/mcps/types.py`) is raised by the relay path, not by this package — WP19's job is
wiring a 403/`invalid_scope` response from the upstream into that exception. What WP19 consumes
from WP17 is `begin()` with a **narrower** `scopes` argument than "everything the server offers":
step-up re-runs `begin()` for the specific missing scope(s) against the same `server_url`, and
`SecretsTokenStorage` finding an existing `oauth_grant` for that server means `complete()`'s token
write is an `update_secret` (rotate in place) rather than a fresh `create_secret` — the storage
adapter does not need to know "this is a step-up" as a distinct case; it is the same get-or-create
path with a different requested-scope list.

**WP20 — Client registration fallback.** Consumes `MCPOAuthClient`'s registration call as the
seam to swap: today it always does RFC 7591 dynamic client registration outbound (`POST` to the
authorization server's `registration_endpoint`, discovered or defaulted to `/register`) — the
"older mechanism" D26 names as the one with no inbound direction. WP20's job (the "prefer the
document, fall back to registering outbound" rule) is entirely about the *other* mechanism — a
client-identifier-as-HTTPS-URL that the authorization server fetches from us — which this package
does not implement at all, by design: D26 says that mechanism is the one that can fail on an
internal-only domain, and WP17 ships only the always-safe outbound path. WP20 adds the preferred
mechanism in front of it, keeping this package's registration call as the fallback branch
unchanged.

---

## Tests

Unit only, no live network, no real authorization server, no real MCP server — an
`httpx.MockTransport` standing in for the authorization server's well-known endpoints,
registration endpoint and token endpoint, and a fake `SecretsDAOInterface` (in-memory dict)
backing a real `VaultService` for the storage-adapter tests, matching
`test_gateways_http_mcp_adapter.py`'s and `test_provider_probe.py`'s existing pattern.

- `SecretsTokenStorage`: `get_tokens`/`get_client_info` return `None` on first call for a fresh
  `(project_id, server_url)`; `set_client_info` then `get_client_info` round-trips; `set_tokens`
  then `get_tokens` round-trips; a second `set_tokens` call updates the same row (`update_secret`
  called, not a second `create_secret` — assert via the fake DAO's call log); two different
  `server_url`s under the same project never collide.
- `state.py`: sign/verify round-trip carries `server_url`, `code_verifier`, `scopes`; a tampered
  byte is rejected; an expired token is rejected — same three cases as
  `test_oauth_state_identity.py`'s existing precedent for the sibling domain.
- `MCPOAuthClient.discover()`: a mock AS answers protected-resource metadata then
  authorization-server metadata; the parsed result carries `authorization_server` and
  `scopes_supported`; a 404 at every well-known URL raises a typed discovery error.
- `MCPOAuthClient` registration: no stored `client_info` -> a registration POST fires and the
  response is stored; a stored `client_info` -> no registration POST fires.
- `MCPOAuthConnectService.begin()`: returns an `authorization_url` containing the fixed
  `redirect_uri`, a `code_challenge`, and the requested `scope`; the returned `state` decodes to
  the right `project_id`/`server_url`/`code_verifier`.
- `MCPOAuthConnectService.complete()`: valid code+state against the mock token endpoint writes an
  `oauth_grant` secret and returns its id; a tampered or expired state raises before any HTTP call
  is made; a token-endpoint error response raises a typed exception rather than propagating an
  `httpx` exception.
- Guard: no test in this package's suite ever constructs `mcp.client.auth.oauth2.OAuthClientProvider`
  — a regression test asserting that class is unused would be redundant with "count the
  imports", so this is enforced by review rather than a grep guard (unlike WP24's
  `json.loads`-guard precedent, there is no single string this package could regress into).

## Out of scope

- The dashboard consent UI and its two routes (`POST /endpoints/{endpoint_id}/connect`,
  `GET /connect/callback`) — WP18 builds them against `MCPOAuthConnectService`.
- The step-up interaction itself (raising `MCPScopeInsufficientError` from a live 403) — WP19.
- The client-identity-document registration mechanism and the internal-only-domain fallback
  ordering — WP20. This package always uses outbound dynamic registration.
- Any `builtin`/Composio path — out of this package's target namespace entirely, not merely
  unimplemented.
- A stored-nonce replay ledger for the state token — flagged above, not built.
