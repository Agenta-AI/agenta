# WP19 — Step-up interaction

**Owns:** the scope-challenge detection in `core/gateways/mcps/service.py::relay`, the
connect affordance `apis/fastapi/gateways/mcps/proxy.py` attaches to a step-up refusal, and
the repoint of WP26's `useGatewayConnectFlow` MCP branch onto WP18's real connect surface.
**Depends on:** WP17, WP18, WP25, WP26. **Blocks:** nothing (last package of wave 3).

D17: "at step-up the gateway raises an interaction... the same situation as a tool needing
a connection that does not exist yet, and that path already exists." This package makes
that literally true — nothing before it ever raised a scope-challenge exception, and the
interaction it raises reuses WP18's connect route and WP26's `request_connection` tool
rather than building a third mechanism.

---

## Three inherited constraints, and how this package is shaped around them

1. **Codex keeps only `error.message`.** WP25 built a code marker (`⟦agenta_code:<code>⟧`)
   that survives inside `message` on every harness; a marker-only recovery never carries
   `retryable`/`next_step`/`details`. This package's own new cause, `scope_insufficient`, is
   NOT added to the runner's `NEXT_STEPS` table (`services/runner/src/gateway-error.ts`) —
   there is nothing generic to say ("grant more access" is the whole of it), and the MCP
   plane never reaches the body path anyway (constraint 2), so a `NEXT_STEPS` entry would be
   dead code for this cause specifically.
2. **The MCP plane's marker is the only recovery channel, for every harness, always** — not
   a fallback. `error.data.cause` sits under a numeric JSON-RPC `error.code`, which the
   runner's body scan (`typeof body.code === "string"`) never matches. Consequence: the
   `connect` affordance this package attaches to the JSON-RPC error's `error.data` (see
   below) is real and tested at the boundary, but no harness's SDK ever hands it to the
   runner — only `code` survives, always. The design does not pretend otherwise: nothing
   downstream (the client-tool widget) reads `scopes` or `connect` off a recovered
   `AgentErrorDetail`, because they are never there to read.
3. **Discovery can fail on a server we cannot reach (OD21).** WP17 discovers an
   authorization server by guessing well-known URIs only. WP18 already surfaces a discovery
   failure as `MCPOAuthDiscoveryError`'s own message, verbatim, at
   `POST /endpoints/{id}/connect` step 1 — never a generic "connect failed". Step-up reuses
   that exact route unmodified, so it inherits the distinction for free; this package adds no
   new discovery-failure handling and no new test for it (WP18's
   `test_connect_discovery_failure_surfaces_its_own_message` already covers the only code
   path step-up runs through).

## The step-up prompt degrades to a generic form by construction, not by branching

Constraint 2 means there is no "full envelope" shape for a step-up refusal to ever reach the
agent runtime in — every MCP-plane recovery is code-only. So "the step-up prompt" cannot be
built as something that reads `next_step`/`details` and falls back when they're absent (there
is nothing to read either way). Instead: the surface the agent asks the user through
(`request_connection`'s `target: {plane: "mcp", name: <slug>}`, WP26) never carried
scope-specific fields to begin with, and this package does not add any. The dialog it opens
(`MCPConnectDialog`, WP18) always re-runs `discover()` and re-renders the FULL current scope
checklist — it does not need to know which scopes were missing, because the interaction is
"pick what to grant", not "grant exactly X". A model that sees only `code: scope_insufficient`
has everything it needs to call `request_connection`; a model that somehow saw more (it never
will, on this plane) would still get the same dialog. Generic by construction beats generic by
an `if (!details)` branch with nothing on the other side of it.

This is proven two ways:
- **What the gateway itself constructs** (`_map_gateway_exception`'s `scope_insufficient`
  branch, `apis/fastapi/gateways/mcps/proxy.py`): the JSON-RPC error's `data.connect`, when
  `endpoint_id` is known, is `{endpoint: "/gateways/mcps/endpoints/{id}/connect", body: {}}`
  — pointing at WP18's discover step, never at a computed scope list. Tested directly.
- **What actually reaches a harness** (`services/runner/tests/unit/gateway-error-harness-formats.test.ts`):
  `scope_insufficient` added to `MCP_REFUSALS`, run through both existing MCP fixtures (full
  JSON-RPC body embedded verbatim, and Codex's stripped-to-`message` shape) — both recover
  `code` only, `next_step`/`details` asserted absent, same as the four pre-existing MCP
  causes. No new runner source change; this proves the existing generic mechanism already
  covers the new cause without modification.

## Backend: detecting the challenge

`MCPGatewayService.relay` (`core/gateways/mcps/service.py`), after the upstream call returns
(step 5, before step 6's recording/filtering): for a `custom` OAuth endpoint whose result is
`403`, `_parse_scope_challenge(result.headers)` reads `WWW-Authenticate` for an RFC 6750
`Bearer error="insufficient_scope"[, scope="..."]` challenge.

- `None` (no challenge, or a different `error=`) → the result passes through untouched (D16:
  the upstream's own protocol-level answer, e.g. a plain `invalid_token` rejection, is not a
  gateway-authored refusal).
- A challenge with no `scope` param → `[]`. WP18's dialog re-discovers the offered set either
  way, so an upstream that names no specific scope still gets the same reopened checklist,
  not a dead end.
- A challenge with `scope="a b"` → `["a", "b"]`, carried on `MCPScopeInsufficientError` for
  whoever reads the JSON-RPC body directly (constraint 2: nobody downstream of the marker
  does, but the data is honestly there for a caller that can).

Only `auth_mode == OAUTH` on `custom` is checked — a `none`-scheme endpoint has nothing to
step up (nothing was ever granted), so its 403s (however shaped) are never reinterpreted.
The outcome is recorded via `policy.record` before the exception leaves, matching the
existing `MCPUpstreamError` precedent one branch up.

`MCPScopeInsufficientError` (declared by the seed, unraised until this package) gained one
optional field, `endpoint_id`, so the boundary can build a connect affordance without
widening WP17's own construction of it (`target="t", scopes=["a"]` stays valid — proven by
the untouched seed test).

## Backend: the connect affordance

`apis/fastapi/gateways/mcps/proxy.py::_map_gateway_exception`'s `scope_insufficient` branch
now attaches `data.connect = {endpoint, body: {}}` when `endpoint_id` is present — the exact
route WP18 built (`POST /endpoints/{id}/connect`), pointed at its discover step (empty body),
never at a guessed scope list. This is additive: the existing `data.scopes`/`data.target`
fields, the 409 status, and the code marker on `message` are unchanged.

## Frontend: the repoint (secondary task, folded in because it IS the interaction path)

WP26 pointed `useGatewayConnectFlow`'s `plane: "mcp"` branch at the Composio tool-catalog
drawer as a stopgap, because no `custom` registration surface existed yet. WP18 built one
(`MCPEndpointDrawer`, `MCPConnectDialog`, `web/oss/src/components/pages/settings/MCPEndpoints/`).
This is the first branch where both exist, so the repoint lands here rather than being
deferred again.

**What changed** (`useGatewayConnectFlow.ts`, `GatewayConnectToolWidget.tsx`):
- `resolveCustomMcpEndpoint(endpoints, target)` — a `target.name` that matches a registered
  `custom` endpoint's slug resolves to that `MCPEndpoint`; otherwise `null`.
- `runConnect`: `plane: "mcp"` with a resolved `custom` endpoint opens `MCPConnectDialog` for
  it. No match (a `builtin`/Composio target — still a legitimate case per specs-wp26.md, not
  the stopgap) falls back to the shared catalog drawer, unchanged from WP26.
- Settle semantics for the `custom` path are now REAL, not optimistic: `onSuccess` (the
  dialog's own postMessage-verified completion, `mcp:oauth:connected`) settles
  `{connected: true}`; closing without success (discovery failure or an in-dialog cancel)
  settles `{connected: false, reason: "cancelled"}`. An explicit "Not now" before the dialog
  opens still settles `{connected: false, reason: "declined"}` — distinct from "cancelled",
  so a user who saw the dialog and backed out reads differently from one who never engaged.
- The `builtin` fallback path is untouched: still optimistic-on-close, still documented as
  such in the module doc, because the shared globally-mounted catalog drawer still has no
  per-call completion signal to read. The stopgap is dropped only where a real signal now
  exists (`custom`), not universally — dropping it for `builtin` too would require a signal
  that does not exist yet, which is a different package's job (see specs-wp26.md's own "not
  built speculatively here").

**Why this is the correct home for step-up's frontend half.** D17 says step-up reuses the
existing missing-connection interaction, and WP26's `request_connection` tool IS that
interaction for a gateway target. Nothing about step-up needs a distinct widget: the same
"Connect {name}" chip, opened for the same slug, drives the same dialog — which happens to
re-offer a wider scope set than last time because that's what `discover()` returns after a
prior grant exists. No new render kind, no new client tool, no new wire field.

## Grant rotation, not duplication

Already proven at WP17's own layer:
`test_gateways_mcp_oauth_service.py::test_step_up_reuses_the_same_grant_row_rather_than_creating_a_second_one`
calls `begin()`/`complete()` twice for the same `server_url` with a widening scope list and
asserts one `oauth_grant` row, `update_secret` not a second `create_secret`. This package
does not re-derive that test — the connect affordance above points at the exact same
`begin()`/`complete()` pair, so the proof already carries over.

## Discovery failure vs. decline vs. code-only refusal — three distinct reads

- **Decline** (`reason: "declined"`): the user never opened the dialog. Chip: "Connection not
  completed" territory, distinguishable in the settled output.
- **Discovery failure**: the dialog opens, `MCPConnectDialog` shows
  `MCPOAuthDiscoveryError`'s own message inline (unchanged WP18 behavior — this package
  reuses the component verbatim), and closing after it settles `{reason: "cancelled"}`. The
  specific wording was already shown to the user before the settle; the settled reason does
  not need to repeat it (mirrors WP18's own choice not to thread it further).
- **Code-only step-up refusal reaching the agent**: no wording is ever invented — the model
  gets `code: scope_insufficient` and nothing else, and the widget it can open never claims
  to know more than "this needs a connection".

## Tests

- `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_service.py`: scope challenge with a
  `scope=` param raises `MCPScopeInsufficientError` carrying the parsed list and
  `endpoint_id`; without `scope=` raises with `[]`; a 403 with a different `error=` (or none)
  passes through untouched (D16); a `none`-scheme endpoint's 403 is never reinterpreted.
- `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_proxy.py`: `scope_insufficient` with
  no `endpoint_id` carries no `connect` key (WP17's construction stays valid); with
  `endpoint_id` carries `data.connect = {endpoint, body: {}}`.
- `services/runner/tests/unit/gateway-error-harness-formats.test.ts`: `scope_insufficient`
  added to the MCP fixture table, both shapes (full JSON-RPC body, Codex-stripped) — proves
  the existing generic marker mechanism covers this new cause with no runner source change.
- `web/oss/src/components/AgentChatSlice/components/clientTools/useGatewayConnectFlow.test.ts`:
  `resolveCustomMcpEndpoint` — matches a `custom` endpoint by slug; `null` for a namespace
  mismatch, an llm-plane target, or no match at all (the `builtin` fallback case).
- Grant rotation: not re-derived — see above; referenced, not duplicated.
- Discovery failure distinctness: not re-derived — `test_connect_discovery_failure_surfaces_its_own_message`
  (`test_gateways_mcp_router.py`, WP18) already covers the only code path step-up runs
  through.

## Out of scope

- Header-first (`WWW-Authenticate`) authorization-server *discovery* (OD21) — different
  mechanism from the scope-challenge header this package reads; still not built.
- `MCPAuthRequiredError` (a token that is entirely absent or rejected, not merely
  under-scoped) — still declared, still unraised; the "no grant at all" case is already
  caught pre-flight by `SecretNotFoundError` in `_resolve_auth` before any upstream call, so
  there is no live path to this exception yet, and wiring one is not this package's stated
  scope ("a scope challenge from an MCP server").
- A new `AgentErrorDetail` consumer in the web app (a generic "run failed, here's why" panel)
  — nothing in the codebase builds this today for any cause, gateway or otherwise; WP19 does
  not introduce the first one under cover of step-up. The channel WP25 built and the tool
  WP26 built are sufficient for the interaction this package needs.
- Any LLM-plane equivalent — models have no OAuth scope concept in this design; step-up is
  MCP-only, matching WP17/WP18's own `custom`-namespace scope.
