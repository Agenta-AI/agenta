# WP18 — tasks

Read [`specs-wp18.md`](specs-wp18.md) first. Branch from WP17 (`feat/gateways-wp17`).

## Phase 0 — backend: wire the two routes

- [ ] `apis/fastapi/gateways/exceptions.py`: map the OAuth exceptions
      (`MCPOAuthDiscoveryError`, `MCPOAuthRegistrationError`, `MCPOAuthTokenExchangeError`
      → 424; `MCPOAuthStateInvalidError` → 400; `MCPOAuthClientNotRegisteredError` → 409),
      each carrying the exception's own message, never a generic one.
- [ ] `apis/fastapi/gateways/mcps/models.py`: `MCPConnectRequest.scopes` becomes
      `Optional[List[str]] = None` (absent = discover step); `MCPConnectResponse` gains
      `scopes_offered: List[str] = []`.
- [ ] `apis/fastapi/gateways/mcps/router.py`: `MCPGatewayRouter.__init__` takes
      `oauth_connect_service: "MCPOAuthConnectService"` (TYPE_CHECKING import, matching
      the existing `mcp_gateway_service` forward-ref style). Register
      `POST /endpoints/{endpoint_id}/connect` → `connect_endpoint` and
      `GET /connect/callback` → `connect_callback`.
- [ ] `connect_endpoint`: fetch the endpoint, 404/400-guard (must be `custom` + `oauth`),
      branch on `body.scopes is None` (discover, cache onto `data.oauth` via
      `edit_endpoint`) vs. present (begin, return `redirect_url`).
- [ ] `connect_callback`: unauthenticated `HTMLResponse`. Decode `state` for `user_id`
      (read-only, second decode — `complete()` already validated it once); call
      `complete()`; resolve the endpoint by `query_endpoints` + `base_url` match;
      `edit_endpoint(secret_id=...)`; render the success/failure card with the
      `mcp:oauth:connected` postMessage payload, mirroring
      `tools/router.py::_oauth_card`/`callback_connection`.
- [ ] `entrypoints/routers.py`: construct `MCPOAuthClient()` and
      `MCPOAuthConnectService(vault_service=vault_service, client=..., api_url=env.agenta.api_url,
      secret_key=env.agenta.crypt_key)`; pass into `MCPGatewayRouter(...,
      oauth_connect_service=...)`.
- [ ] Update `test_gateways_mcp_router.py`: extend `EXPECTED_ROUTES` with the two new
      entries; replace the two "route is not registered (WP18)" tests (now false) with
      real coverage per specs-wp18.md's test list; give the fixture a mock
      `MCPOAuthConnectService`.
- [ ] Update `test_gateways_ssrf_registration_gate.py`'s `MCPGatewayRouter(...)`
      construction to pass a stub `oauth_connect_service` (unused by the SSRF-only
      tests in that file).
- [ ] Commit: "gateways(mcp): wire the connect and callback routes".

## Phase 1 — backend tests

- [ ] Router tests per specs-wp18.md's list (discover step, begin step, 404/400/403,
      discovery-failure message passthrough).
- [ ] Callback tests per specs-wp18.md's list (success, no-matching-endpoint,
      `error` query param, tampered/expired state).
- [ ] `ruff format` && `ruff check --fix` in `api/`.
- [ ] Commit: "gateways(mcp): connect and callback route tests".

## Phase 2 — frontend: the dashboard surface

- [ ] `web/oss/src/components/pages/settings/MCPEndpoints/api.ts`: raw-axios calls
      (list/create/edit/delete/connect) — see specs-wp18.md's "Deliberate, not an
      oversight" note on why not the Fern client yet.
- [ ] `MCPEndpoints.tsx`: list page, "Register server" → `MCPEndpointDrawer`, "Connect"
      on unconnected `oauth` rows → `MCPConnectDialog`.
- [ ] `MCPEndpointDrawer.tsx`: create/edit form (slug, name, `base_url`, `auth_mode`),
      `EnhancedModal`/`ModalContent`/`ModalFooter` from `@agenta/ui`.
- [ ] `MCPConnectDialog.tsx`: step 1 (discover, render scope checkboxes, all pre-checked)
      → step 2 (begin, popup via `window.open`, same-tab fallback when blocked) →
      `postMessage` listener for `mcp:oauth:connected` with origin check, `popup.closed`
      poll fallback — `ConnectDrawer.tsx`'s own pattern, reused not reinvented.
- [ ] Mount the page in the settings nav alongside `Tools`/`Webhooks`/`Triggers`.
- [ ] `pnpm lint-fix` in `web/`.
- [ ] Commit: "gateways(mcp): the consent-flow dashboard surface".

## Phase 3 — frontend tests

- [ ] vitest: `api.ts` call shapes; `MCPConnectDialog`'s two-step state machine with
      `window.open`/`postMessage` mocked, including the untrusted-origin-ignored case.
- [ ] Commit: "gateways(mcp): consent-flow frontend tests".

## Phase 4 — close out

- [ ] Re-read specs-wp18.md once more against the code as written; fix drift.
- [ ] Commit: "gateways(docs): close WP18 with the consent flow".

## Definition of done

- `POST /endpoints/{endpoint_id}/connect` and `GET /connect/callback` are wired,
  reachable, and covered by unit tests with no live network.
- A user can register a `custom` OAuth MCP server from the dashboard, pick scopes from
  the server's own discovered list, and complete the grant — the endpoint's `secret_id`
  ends up pointing at a live `oauth_grant` secret via `edit_endpoint`, never a direct
  write to the row from this package's OAuth code.
- WP26's stopgap has a precise, named target to repoint at (specs-wp18.md's "What WP26
  should repoint at").
