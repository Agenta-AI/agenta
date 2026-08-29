# WP17 — tasks

Read [`specs-wp17.md`](specs-wp17.md) first. Branch from WP16 (`feat/gateways-wp16`).

## Phase 0 — dependency

- [ ] Add `mcp` (official Model Context Protocol Python SDK) to `api/pyproject.toml`, pinned;
      regenerate `uv.lock`. Verify `mcp.client.auth.oauth2.TokenStorage` and `mcp.shared.auth`'s
      DTOs import cleanly under `uv run python -c "..."`.
- [ ] Commit: "gateways(mcp): add the mcp SDK dependency".

## Phase 1 — the storage adapter

- [ ] `core/gateways/mcps/oauth/storage.py`: `SecretsTokenStorage`, constructed with
      `vault_service`, `project_id`, `server_url`. Implements `get_tokens`/`set_tokens`/
      `get_client_info`/`set_client_info` per specs-wp17.md's "Keys" section — list+filter,
      get-or-create against `VaultService`, no new DAO method.
- [ ] Unit: fresh scope returns `None` from both getters; set-then-get round-trips both kinds; a
      second `set_tokens` updates in place; two `server_url`s under one project never collide.
- [ ] Commit: "gateways(mcp): oauth storage adapter over the secrets vault".

## Phase 2 — the state token

- [ ] `core/gateways/mcps/oauth/state.py`: `make_state`/`decode_state`, HMAC-signed, 1-hour TTL,
      carrying `project_id`, `user_id`, `server_url`, `code_verifier`, `scopes`, `nonce`, `ts`.
      Deliberately not imported from `core/gateway/connections/utils.py` — see specs-wp17.md's
      "target: custom only" note.
- [ ] Unit: round-trip carries every field; a tampered byte is rejected; an expired token is
      rejected.
- [ ] Commit: "gateways(mcp): oauth state token".

## Phase 3 — the discovery + registration + token-exchange client

- [ ] `core/gateways/mcps/oauth/client.py`: `MCPOAuthClient(transport: Optional[httpx.BaseTransport]
      = None)`. Three methods: `discover(server_url) -> MCPOAuthDiscovery` (protected-resource
      metadata, falling back through the well-known URIs per SEP-985/RFC 9728, then
      authorization-server metadata per RFC 8414/OIDC discovery); `register(*, authorization_server,
      redirect_uri) -> OAuthClientInformationFull` (RFC 7591 dynamic registration, skipped when
      storage already has `client_info`); `exchange_token(*, token_endpoint, code, code_verifier,
      redirect_uri, client_info) -> OAuthToken`.
- [ ] Built from `mcp.shared.auth`'s DTOs and `mcp.client.auth.oauth2.PKCEParameters` for parsing
      and PKCE generation — never from `OAuthClientProvider.async_auth_flow` (specs-wp17.md's "Why
      not OAuthClientProvider").
- [ ] `core/gateways/mcps/oauth/types.py`: typed exceptions — discovery failure, registration
      failure, token-exchange failure — each wrapping the underlying `httpx`/validation error
      rather than letting it escape raw.
- [ ] Unit, `httpx.MockTransport` throughout: discovery success and 404-everywhere failure;
      registration fires when no client_info stored, skipped when it is; token exchange success
      and an error response from the mock token endpoint.
- [ ] Commit: "gateways(mcp): oauth discovery, registration and token exchange".

## Phase 4 — the two-phase connect service

- [ ] `core/gateways/mcps/oauth/dtos.py`: `MCPOAuthDiscovery`, `MCPOAuthAuthorizationStart
      {authorization_url, state}`, `MCPOAuthCompletion {project_id, server_url, secret_id}`.
- [ ] `core/gateways/mcps/oauth/service.py`: `MCPOAuthConnectService(vault_service, client)` with
      `discover`, `begin`, `complete` exactly as specs-wp17.md's "The two-phase connect service"
      signatures. Fixed redirect URI built from `env.agenta.api_url` +
      `/gateways/mcps/connect/callback`. `complete()` never calls `edit_endpoint` — returns the
      `secret_id` for the caller to wire.
- [ ] Unit: `begin()`'s authorization_url contains the fixed redirect_uri, a code_challenge, and
      the requested scopes; its state decodes to the right project/server/verifier. `complete()`
      with a valid code+state against the mock token endpoint writes an `oauth_grant` secret and
      returns its id; a tampered/expired state raises before any HTTP call; a token-endpoint error
      raises a typed exception.
- [ ] Unit: step-up shape — calling `begin()` a second time for the same `server_url` with a
      narrower `scopes` list, then `complete()`, updates the existing `oauth_grant` row rather than
      creating a second one (proves the WP19 seam works without WP19 existing).
- [ ] Commit: "gateways(mcp): the oauth connect service".

## Phase 5 — close out

- [ ] `ruff format` && `ruff check --fix` in `api/`.
- [ ] Run the full API unit test suite; confirm no regression outside this package.
- [ ] Re-read specs-wp17.md's "What WP18, WP19 and WP20 each consume" section once more against
      the code as written — fix drift between prose and signatures before committing.
- [ ] Commit: "gateways(docs): close WP17 with the storage adapter and connect service".

## Definition of done

- `SecretsTokenStorage` satisfies `mcp.client.auth.oauth2.TokenStorage` structurally, backed by
  `VaultService`, with no new `SecretsDAOInterface` method.
- `MCPOAuthConnectService.begin()`/`complete()` are the only entry points WP18's two routes need;
  neither touches `MCPEndpoint` rows.
- The callback URL is the fixed `{AGENTA_API_URL}/gateways/mcps/connect/callback`, disambiguated
  by `state`, never by a per-flow query string baked into the redirect URI.
- No test reaches a real authorization server, a real MCP server, or the network.
