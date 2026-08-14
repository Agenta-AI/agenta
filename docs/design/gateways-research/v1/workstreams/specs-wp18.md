# WP18 — Consent flow

**Owns:** the two routes entities.md §9 reserved for this package on
`MCPGatewayRouter` (`POST /endpoints/{endpoint_id}/connect`, `GET /connect/callback`),
and the dashboard surface that drives them. Consumes WP17's `MCPOAuthConnectService`
(`discover()` / `begin()` / `complete()`) without modification.

**Target: the `custom` namespace only**, same as WP17. `builtin` is Composio-brokered
(D30) and never reaches this flow — the router rejects a connect attempt on any
endpoint whose `namespace` is not `custom` or whose `auth_mode` is not `oauth`.

**Inherited constraint (OD21, landed on `feat/gateways-wp17` after this branch's
branch point — not this package's code to fix).** WP17's `discover()` finds an
authorization server by guessing well-known URIs only; it does not read the
`WWW-Authenticate` header of a 401 the way RFC 9728 additionally allows, so a server
that publishes its protected-resource metadata somewhere else cannot be discovered
today. This package does not build header-first discovery. What it does: a discovery
failure surfaces to the dashboard as "we could not discover this server's OAuth
configuration at `<server_url>`" (the `MCPOAuthDiscoveryError` message, passed through
verbatim) rather than a generic "connect failed" — so a user hitting this gap is told
what actually happened instead of guessing.

---

## The two routes

### `POST /gateways/mcps/endpoints/{endpoint_id}/connect`

One route, two steps, disambiguated by whether `scopes` is present — because
`begin()` needs a scope list the user has not chosen yet the first time this route is
called, and entities.md §9 reserves exactly one route here, not two.

**Step 1 — discover (no `scopes` in the body, or `scopes: null`).**

```
POST /endpoints/{endpoint_id}/connect
{}
```

Resolves `endpoint_id` → the endpoint row → `server_url =
endpoint.data.route.base_url`, calls `MCPOAuthConnectService.discover(server_url)`,
caches the result onto `endpoint.data.oauth` via `edit_endpoint` (the same door every
other field uses — WP17's own rule, extended to this field), and returns the scope
checklist:

```json
{"count": 1, "scopes_offered": ["read", "write", "admin"]}
```

No `redirect_url` in this response — nothing has started yet. This is the call the
dashboard's scope-selection dialog makes when it opens, to render the checkboxes.

**Step 2 — begin (`scopes` present, a list — empty is a legal choice: "connect with no
scopes").**

```
POST /endpoints/{endpoint_id}/connect
{"scopes": ["read", "write"]}
```

Calls `MCPOAuthConnectService.begin(project_id, user_id, server_url, scopes)` and
returns the authorization URL to send the browser to:

```json
{"count": 1, "redirect_url": "https://auth.acme.io/authorize?..."}
```

Both steps require `EDIT_MCP_ENDPOINTS` (this mutates the endpoint's cached OAuth
metadata and, in step 2, kicks off a grant). Both 404 when the endpoint does not exist,
and 400 when it exists but is not a `custom` `oauth` endpoint — a `none`/`api_key`
target has nothing for this route to do, and `builtin` cannot appear here (D30).

### `GET /gateways/mcps/connect/callback`

The fixed redirect URI WP17's `callback_redirect_uri()` builds and registers with every
authorization server (`{AGENTA_API_URL}/gateways/mcps/connect/callback`), disambiguated
by `state`, never by a per-flow query string (WP17's "The callback URL, precisely").
**Unauthenticated** — the browser lands here straight from the authorization server, not
from an Agenta API call, so there is no `AuthScope` to read. Every fact this handler
needs — `project_id`, `user_id`, `server_url` — comes out of the signed `state` the
authorization server echoes back untouched, the same shape
`apis/fastapi/tools/router.py::callback_connection` already uses for the Composio
callback (this package's design leans on that precedent directly).

Query params: `code`, `state` on success; `error`/`error_description` when the user
denies consent or the authorization server refuses (RFC 6749 §4.1.2.1).

On success:

1. `MCPOAuthConnectService.complete(code, state)` → `{project_id, server_url,
   secret_id}` (WP17's contract — it writes the `oauth_grant` secret and stops there;
   it deliberately never touches an `MCPEndpoint` row and takes no `endpoint_id`,
   "keeping it ignorant of the `mcps_endpoints` table").
2. This package decodes the same `state` a second time (`oauth/state.py::decode_state`,
   already validated once inside `complete()` — the second decode is read-only, to
   recover `user_id`, which `MCPOAuthCompletion` does not carry and `edit_endpoint`
   requires for its audit column) to get `user_id`.
3. Resolves `endpoint_id`: lists this project's `custom` endpoints
   (`MCPGatewayService.query_endpoints`, not the builtin-merged `list_endpoints`) and
   matches `data.route.base_url == server_url` — the same list-and-filter idiom WP17's
   `SecretsTokenStorage` uses for the vault, because there is no second way to look up
   "the endpoint for this server" and nothing in this design adds a DAO method for it.
4. `edit_endpoint(secret_id=secret_id)` — the one door.
5. Answers a small self-contained HTML page (`text/html`), not JSON: a browser lands
   here directly, not a JSON client. Modelled on the Composio callback's own card
   (`apis/fastapi/tools/router.py::_oauth_card`), trimmed to what this flow needs: a
   success/failure message, and a `postMessage({type: "mcp:oauth:connected", ...},
   agentaOrigin)` to `window.opener` so a dashboard that opened this in a popup can
   react without polling — the same signal shape as `tools:oauth:complete`, one string
   different, so the frontend idiom this package reuses (see below) transfers exactly.

On failure (bad/expired state, no client registration on file, discovery or token
exchange failure, or `error` present in the query) the same card renders with
`success: false` and the underlying exception's own message — never a generic string —
per the OD21 note above.

---

## Scope selection

Selection happens client-side, between the two `POST /connect` calls, not on the
server. The dashboard:

1. Opens a connect dialog for an OAuth `custom` endpoint whose `secret_id` is not yet
   set (or is set but the endpoint is in `NEEDS_AUTH` — same dialog, same two calls).
2. Calls step 1 (empty body) to get `scopes_offered`.
3. Renders one checkbox per offered scope (all pre-checked — "offer the set and let
   them choose", D17 — unchecking is the deliberate action, not the default).
4. On confirm, calls step 2 with the checked subset and opens `redirect_url` in a popup
   window (falling back to a same-tab redirect when the popup is blocked — the existing
   `ConnectDrawer.tsx` pattern for the Composio tool-catalog flow, reused verbatim
   rather than reinvented).
5. Listens for `postMessage({type: "mcp:oauth:connected"})` from the popup (falling back
   to polling `popup.closed`, same as `ConnectDrawer.tsx`), then refetches the endpoint
   list so the row shows connected.

An empty selection is allowed through to step 2 unchanged — the dashboard does not
force at least one scope, because a server that only needs identity (no scoped access)
is a legitimate case and the gateway does not know better than the user what they need.

---

## The dashboard surface — genuinely new, named for WP26 to repoint at

No page anywhere in the app registered a `custom` MCP server by URL before this
package (verified: no reference to `MCPEndpoint`, `mcp_gateway`, or `gateways/mcps`
existed under `web/` on this branch). This package adds one:

- **Page:** `web/oss/src/components/pages/settings/MCPEndpoints/MCPEndpoints.tsx` —
  list of the project's `custom` MCP endpoints (`GET /endpoints/`, filtered to
  `namespace: custom` client-side — the same merged list the CRUD `GET` already
  returns), a "Register server" action opening a create/edit drawer
  (`MCPEndpointDrawer.tsx`, same folder: slug, name, `base_url`, `auth_mode`), and, on
  a row whose `auth_mode` is `oauth` and `secret_id` is unset, a "Connect" action.
- **Connect dialog:** `MCPConnectDialog.tsx` (same folder) — the two-step flow above.
- **API calls:** `api.ts` (same folder), raw `axios` against
  `oss/src/lib/api/assets/axiosConfig.ts`'s shared instance. **Deliberate, not an
  oversight:** the Fern-generated client
  (`web/packages/agenta-api-client/src/generated`) carries no MCP-gateway types at
  all yet — this whole domain (WP6–WP20's routes) has not been through a Fern
  regeneration pass on this branch. `agenta-package-practices`'s "never raw axios for
  a new endpoint" rule assumes the generated client has the endpoint to call; here it
  does not, so the fallback it names for exactly that gap applies. Swapping `api.ts`
  for generated client calls is mechanical once that pass runs, and does not change
  this package's route contracts or dialog logic.

This is app-layer code, not a package: **placement follows the stated heuristic** in
`agenta-package-practices` ("used by 2+ features, or could be?" → package; otherwise
app layer). Nothing else in the app registers a custom MCP server today, so this stays
in `web/oss/src/components/pages/settings/MCPEndpoints/` until a second consumer
appears — mirroring where `Tools/`, `Webhooks/`, `Triggers/` already live, not
`@agenta/entity-ui`'s `gatewayTool/` drawers (which earned package placement by having
three real mount points: the playground, the playground's tool panel, and the Tools
settings page).

**What WP26 should repoint at.** WP26's `request_connection` tool extension found "no
dashboard surface exists anywhere in the app for registering a custom MCP server by
URL" and pointed its MCP landing affordance at the existing Composio tool-catalog
drawer (`@agenta/entity-ui`'s `gatewayTool/drawers/CatalogDrawer.tsx`, opened via the
`toolCatalogDrawerOpenAtom` atom) as a stopgap — the wrong catalog for a `custom`
target, since that drawer browses Composio-brokered `builtin` integrations, not
user-typed URLs. The real surface now exists:

- **Route:** the settings page above, mounted wherever the settings nav registers
  sibling pages (`Tools`, `Webhooks`, `Triggers`) — same nav entry pattern.
- **Component to open for "register a server and connect it":**
  `MCPEndpointDrawer` (create) chained into `MCPConnectDialog` (connect) — both
  exported from `MCPEndpoints.tsx`'s folder. There is no shared atom to pop them open
  from arbitrary call sites yet (this package's only consumer is the settings page
  itself); WP26 either navigates to the settings page directly, or a follow-up promotes
  these two components to `@agenta/entity-ui` with an open-state atom once WP26 is the
  second consumer — the same promotion criterion `gatewayTool/` already met. That
  promotion is WP26's call to make, not built speculatively here.

---

## What this package does not do

- Does not modify `core/gateways/mcps/oauth/*` (WP17's files) — `MCPOAuthCompletion`
  stays `{project_id, server_url, secret_id}`; the missing `user_id` is recovered by a
  second, read-only `decode_state` call in this package's own router, not by widening
  WP17's return type.
- Does not add a `MCPEndpointsDAOInterface` method to look up an endpoint by
  `base_url` — the callback's list-and-filter is the same "no new DAO method, scan in
  Python" precedent `SecretsTokenStorage` already set (specs-wp17.md's "Keys").
- Does not build header-first (`WWW-Authenticate`) discovery — OD21, explicitly out of
  scope, inherited as a named limitation instead.
- Does not touch the step-up interaction (WP19) or the client-registration fallback
  (WP20) — both consume this package's routes/service unchanged.
- Does not regenerate the Fern-generated web API client — `api.ts`'s raw-axios calls
  are the stated, temporary stand-in until that pass runs.

## Tests

**Backend, unit only** — `httpx.MockTransport` standing in for the authorization
server (WP17's own precedent, reused), a hand-written mock `MCPOAuthConnectService`
and a hand-written mock `MCPGatewayService` for the router tests (matching
`test_gateways_mcp_router.py`'s existing `MockMCPGatewayService` pattern) — no real
network, no real MCP server, no real authorization server, no database.

- Router, step 1 (discover): reaches `discover()`, writes `data.oauth` via
  `edit_endpoint`, returns `scopes_offered`, no `redirect_url`.
- Router, step 2 (begin): reaches `begin()` with the posted `scopes`, returns
  `redirect_url` from `authorization_url`, no discovery-caching call this time.
- Router: 404 on an unknown `endpoint_id`; 400 on a `none`/`api_key` or non-`custom`
  endpoint; 403 when `EDIT_MCP_ENDPOINTS` is denied, before the service is touched.
- Router: a `MCPOAuthDiscoveryError` from step 1 maps to the exception's own message
  in the error body, not a generic string (the OD21-inherited-limitation contract).
- Callback: valid code+state completes, resolves the right endpoint by `base_url`,
  calls `edit_endpoint(secret_id=...)`, renders the success card with the
  `mcp:oauth:connected` postMessage payload.
- Callback: no endpoint matches the completed `server_url` → failure card, no
  `edit_endpoint` call (nothing to PUT onto).
- Callback: `error` query param present → failure card, `complete()` never called.
- Callback: tampered/expired `state` → failure card carrying `MCPOAuthStateInvalidError`'s
  message, `complete()` raises before any HTTP call (WP17's own guarantee, exercised
  from this package's boundary).

**Frontend, vitest.** `api.ts`'s axios calls (mock axios, assert method/path/body per
step); `MCPConnectDialog`'s two-step state machine (discover → render checkboxes →
begin → popup opens with the returned `redirect_url`) with `window.open` mocked;
the `postMessage` listener resolving the dialog on `mcp:oauth:connected`, ignoring a
message from an untrusted origin (mirrors `ConnectDrawer.tsx`'s own origin check).
