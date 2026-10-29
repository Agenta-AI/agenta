# WP26 — An agent can request a gateway connection

**Owns:** `core/workflows/static_catalog.py`'s `request_connection` client tool, and the
playground's client-tool widget that renders it
(`web/oss/src/components/AgentChatSlice/components/clientTools/`).
**Depends on:** C2. **Blocks:** WP19.

D35 requires a target to be registered before an agent can reach it. The affordance that
already exists — the reserved `request_connection` client tool — only lets an agent ask for
an external integration. This package widens it to also cover a gateway target on either
plane, per the wave-3 launch doc's instruction to extend rather than duplicate: the pause,
the render hint (`render: {kind: "connect"}`) and the resume path are already built and
tested for this tool, and none of that changes.

---

## The widened contract

One new optional field, `target`, alongside the existing `integration`:

```jsonc
{
  "integration": "slack",              // existing path, unchanged
  // — or —
  "target": {                          // new path
    "plane": "llm",                    // "llm" | "mcp"
    "name": "openai"                   // provider name (llm) or server slug (mcp)
  },
  "slug": "my-connection",             // existing, ignored for a gateway target
  "mode": "oauth"                      // existing, ignored for a gateway target
}
```

`input_schema.required` drops from `["integration"]` to `[]`; the tool description states
that exactly one of `integration` or `target` must be given. Both are plain strings/objects
in an already-untyped `Dict[str, Any]` schema — nothing downstream parses this schema
strictly (the LLM decides which fields to fill from the description; no JSON-schema
validator gates the call), so relaxing `required` and documenting the exclusivity in prose
is consistent with how `mode`'s "defaults to oauth" is already documented rather than
enforced.

**Why a `target` object with a `plane` discriminant, and not the alternatives:**

- **A second top-level field per plane (`llm_provider`, `mcp_server`) was rejected.** It
  would need a third field the day a third plane exists (or a fourth for `agenta`-namespace
  targets), and every consumer would need to check three fields instead of branching on one.
  A single `target.plane` enum scales by adding an enum value, not a field.

- **Overloading `integration` to also carry a provider/server name was rejected.** `slug`
  and `mode` already read as integration-specific in the existing schema (`slug` defaults to
  the *integration* key; `mode` is "oauth or api_key", which does not describe how a
  gateway target's registration works — see below). Reusing one field for two concepts
  forces every reader (the widget, a future harness-side validator, anyone grepping the
  schema) to first decide which concept a given call is in, from context alone. A named
  `target` object makes that decision explicit in the payload itself.

- **A `kind` discriminant on the whole payload (`kind: "integration" | "gateway"`) was
  considered and rejected as one field too many.** `target`'s mere presence already
  discriminates — there is no state where both `integration` and `target` are meaningfully
  set at once, so a wrapping switch adds nothing the presence check doesn't already give,
  and it would need its own validation ("kind says gateway but integration is set").

- **A second reserved client tool (`request_gateway_connection`) was rejected outright**,
  per the wave-3 launch doc's explicit instruction: it would duplicate the pause/render/
  resume machinery this tool already has, for no behavioral difference the machinery cares
  about — the runner parks on any unsettled client tool regardless of its argument shape.

**Why `plane`, not `namespace` (`builtin`/`standard`/`custom`, D30).** The agent asking for a
connection does not know or care which namespace ultimately resolves the name — that is a
gateway registry concern, not a request concern. `plane` is the one fact the agent actually
has: which gateway refused it. The frontend resolves the rest (a provider name matches
`standard`; a server slug not in the `builtin` Composio catalog is `custom`) the same way the
existing settings surfaces already do, without the agent needing to know the split.

**Why `mode` is left alone rather than widened.** `mode: oauth | api_key` describes how an
*external integration* authenticates. A gateway target's registration story is different per
plane and is not a request-time choice the agent makes: an LLM `standard` provider is always
"bring a secret" (there is no OAuth mode for a provider API key); an MCP `custom` server's
OAuth flow (WP17/WP18) is a property of the server, discovered when it is added, not
something the agent selects up front. Overloading `mode` to mean two different things on two
different paths was rejected for the same reason `integration` reuse was: it forces a reader
to know which path they're on before the field means anything. `mode` simply does not apply
to `target` calls, and the schema says so.

---

## What "lands the user on the right registration surface for that plane" means today

No dedicated dashboard page exists yet for registering a `custom` gateway endpoint on either
plane (checked: no frontend references `llms_endpoints` or `mcps_endpoints` CRUD). What
*does* already exist, and is what this package wires the widget to:

- **LLM plane → the model-providers drawer.** `ProviderDrawer`
  (`@agenta/entity-ui/secretProvider`) is the exact surface a project's own "connect a model
  provider" flow already opens (`ConnectModelBanner.tsx`, `useLLMProviderConfig.tsx`). It
  covers `standard` (D30): the user picks a provider, brings a key, and the connection lands
  in the vault. This is a complete, accurate landing for the LLM-plane case.

- **MCP plane → the tool catalog drawer.** `CatalogDrawer`
  (`@agenta/entity-ui/gatewayTool`) is already mounted once, globally, inside
  `Playground.tsx` (the same tree the agent chat panel renders in), driven by the shared
  `toolCatalogDrawerOpenAtom`. It covers `builtin` (Composio-backed servers). It does **not**
  yet cover registering a `custom` server by URL — that surface does not exist anywhere in
  the app today, gateway-specific or not. This package does not add it; that is a dashboard
  feature outside "extend a client tool's contract." Opening the catalog drawer is still the
  right move: it is the closest existing surface, and a `custom` registration UI can start
  routing through the same `target: {plane: "mcp", ...}` request shape once it exists,
  without a second protocol change.

## Settle semantics, and why they differ by plane

The existing integration flow settles on an explicit signal: `ProviderDrawer`'s `onSaved`
callback (LLM) fires only when a secret was actually persisted; the OAuth popup settles only
on the `tools:oauth:complete` postMessage (external integration). Both are decisive.

The MCP catalog drawer has no equivalent per-call completion signal available at the point
this widget opens it — it is a shared, globally-mounted drawer with a global
`onConnectionCreated` prop already wired to a different caller (`GatewayToolsPanel`), and
attaching a second, call-scoped listener would mean either mounting a second instance of a
drawer keyed off the *same* shared atom (two components racing one boolean — rejected as a
correctness risk for no clear benefit) or threading a per-call callback through a
globally-mounted singleton (a prop-drilling change to `Playground.tsx` out of proportion to
this package). So:

- **LLM (`target.plane === "llm"`):** settle `{connected: true, target}` from
  `ProviderDrawer.onSaved` — a real, verified signal, exactly like the existing flow's
  `onSuccess`. Closing without saving settles `{connected: false, reason: "cancelled"}`.

- **MCP (`target.plane === "mcp"`):** settle `{connected: true, target}` when the shared
  catalog drawer transitions from open back to closed. This is optimistic, not verified —
  documented as such rather than silently assumed. **This is safe because the gateway
  remains the authority.** If the user closed the drawer without actually registering the
  server, the agent's next call to that server reproduces the exact same typed refusal
  (WP25's `AgentErrorDetail`), and the agent can request the connection again. A false
  "connected" here costs one extra round trip through the same refusal-and-request loop it
  would have taken anyway; it does not let anything unregistered through, because nothing
  downstream trusts this widget's belief — the gateway re-checks registration on every call,
  independent of what the client tool settled with.

Both cases keep the existing "Not now" affordance, settling `{connected: false, reason:
"declined"}` before anything opens — unchanged from the integration path.

## Contracts

- **The existing external-integration case is untouched.** `integration`-only calls parse
  and render exactly as before; `useConnectFlow` and `ConnectToolWidget`'s existing branches
  are not modified, only extended with a sibling path.
- **Dispatch stays on `render.kind` / `toolName`**, unchanged (`registry.tsx`). The `target`
  vs `integration` distinction is read from `meta.input`, one level below dispatch, matching
  how the existing widget already reads `input.mode` and `input.slug`.
- **No new client tool, no new render kind, no runner change.** The runner parks on any
  unsettled client-tool part regardless of its input shape; this package changes only what
  the input can contain and how the browser widget reacts to it.

## Out of scope

- Building a `custom` MCP server registration UI (by URL). Tracked as a gap this package
  inherits, not one it closes; the widened contract already anticipates it (see above).
- WP19's step-up interaction, which depends on this package rather than extending it.
- Any change to the runner, the harness adapters, or `AgentErrorDetail` (WP25's scope).
