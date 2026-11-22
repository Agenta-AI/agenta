# Design: MCP server catalog

Status: proposal, not implemented. The layer-1 direction is an open decision for the team: Direction A or Direction B. This design specifies both and does not choose.

## Context

### What exists today (read in code)

- **Gateway.** `api/oss/src/core/gateways/mcps/service.py` holds `MCPGatewayService`. `create_endpoint` derives the slug (`derive_endpoint_slug`), checks the display name (`_check_name_is_free`), and writes the row through `MCPEndpointsDAOInterface.create_endpoint`. Its only caller in `api/oss/src` is the router (`router.py:409`). Other methods include `edit_endpoint`, `delete_endpoint`, `list_endpoints`, `query_endpoints`, `bind_endpoint_secret`, `cache_endpoint_discovery` and `record_endpoint_check`.
- **Rows.** `mcps_endpoints` (`api/oss/src/dbs/postgres/gateways/mcps/dbes.py`, `dbas.py`) has the primary key `(project_id, id)`, a unique `(project_id, slug)`, the columns `auth_mode` and `secret_id`, and the JSON `data`. `MCPEndpointData` (`core/gateways/mcps/dtos.py`) holds `route` (`base_url`, `headers`, `credential_binding`), `tools`, `settings`, `oauth`, `oauth_config` and `check`. `base_url` is optional (`core/gateways/dtos.py:493`).
- **Namespace.** A stored row is in the namespace `custom` (`GatewayEndpointNamespace.CUSTOM`, `core/gateways/dtos.py:485`). The namespace `standard` means an endpoint that the service generates for a provider and that is never a row (`dtos.py:484`; `MCPStandardProviderKind` in `core/secrets/enums.py:289` has `mock` and `composio`).
- **Auth kinds.** `GatewayAuthScheme` (`core/gateways/dtos.py:448`) has `oauth`, `api_key` and `none`. `MCPCredentialBinding` (`core/gateways/mcps/dtos.py:55`) says where an API key goes: `header` (with `name` and optional `prefix`), `query`, or `url` (the `{secret}` placeholder in the path). `MCPOAuthConfig` holds a pre-registered OAuth client, for "a server that registers no clients on its own (GitHub, HubSpot, Asana)" (`dtos.py:172-174`).
- **A key in the URL.** A row with a `url` binding stores `base_url` with the `{secret}` placeholder. The stored URL never holds the key (`core/gateways/mcps/dtos.py:41-67`). The relay puts the key in at send time (`with_url_secret`, called in `core/gateways/mcps/providers/http/adapter.py:77`).
- **Model validators.** `MCPCredentialBinding._fits_its_kind` (`dtos.py:81`), `MCPEndpointRoute._no_credential_in_base_url` (`dtos.py:132`, which calls `check_url_secret_placeholder`, `dtos.py:96`) and `MCPEndpointCreate._url_binding_needs_a_key` (`dtos.py:303`) run when a model is validated. They do not run on `model_copy(update=...)`. `MCPEndpointCreate` needs only `auth_mode` and `data`; its other fields are optional.
- **OAuth client choice.** `MCPOAuthConnectService._resolve_client_info` (`core/gateways/mcps/oauth/service.py`) picks, in order: the client the person entered, a stored registration, a client ID metadata document (CIMD) when the authorization server supports it, then a new dynamic registration (DCR). The OAuth callback writes the grant onto the row with the DAO method `endpoints_dao.bind_endpoint_secret` (`oauth/service.py:570`).
- **Probe.** `MCPServerProbe.probe` (`core/gateways/mcps/probe.py`) reports `reachable`, `server_name`, `auth.mode` (`none`, `oauth`, `unknown`), `auth.registration`, `auth.scopes_offered` and `auth.redirect_uri`. `MCPProbeRegistration` (`probe.py:125-130`) says "how this deployment would register itself": `_registration` (`probe.py:756-770`) reads the deployment's own public address. It is a fact about a deployment, not about a vendor.
- **Routes.** `api/oss/src/apis/fastapi/gateways/mcps/router.py` (`MCPGatewayRouter`), mounted at `/gateways/mcps` in `api/entrypoints/routers.py`, which builds it once (`routers.py:1622`). Unit and integration tests also build it (for example `api/oss/tests/pytest/unit/gateways/test_gateways_mcp_router.py:290`). Its operation ids include `create_mcp_endpoint`, `list_mcp_endpoints`, `query_mcp_endpoints`, `probe_mcp_endpoint`, `fetch_mcp_endpoint`, `edit_mcp_endpoint`, `delete_mcp_endpoint`, `record_mcp_endpoint_check`, `connect_mcp_endpoint` and `disconnect_mcp_endpoint`; there are also attempt, callback and sweep operations. `connect` takes `owner_kind` (`project` or `user`). The permissions include `VIEW_MCP_ENDPOINTS`, `EDIT_MCP_ENDPOINTS` and `USE_MCP_ENDPOINTS` (`core/access/permissions/types.py:197-199`). The dependency `MCP_GATEWAY_ENABLED` gates the plane.
- **Create route order.** `MCPGatewayRouter.create_endpoint` checks the permission, runs `_guard_custom_endpoint_url` on `body.endpoint.data.route.base_url` (`router.py:407`), and then calls the service (`router.py:409`).
- **Answers.** `_endpoint_json` dumps a row with `exclude_none=True` (`router.py:118`), so a null field is absent from the JSON. The query route answers through it (`router.py:468`).
- **Errors.** `apis/fastapi/gateways/exceptions.py` maps gateway domain errors to an HTTP `detail` built by `gateway_error_envelope` (`{code, message, retryable, next_step?, details?}`, `exceptions.py:56-85`). MCP codes have the prefix `mcp_`, for example `mcp_connection_name_taken` (`exceptions.py:282`).
- **URL guard.** `_guard_custom_endpoint_url` calls `validate_egress_url_format` (`core/gateways/egress.py`). Each outbound call goes through `open_egress`, which resolves the host, refuses blocked address ranges and pins the address.
- **Probe and `{secret}`.** The probe route calls `check_url_secret_placeholder(body.url, binding)`, and `binding` is null without a `secret_id` (`router.py:590-600`). So a URL with `{secret}` and no `secret_id` gets `400`.
- **Edit.** An edit is a full `PUT`. `map_mcp_endpoint_edit_to_dbe` (`dbs/postgres/gateways/mcps/mappings.py:80-99`) assigns only the fields of `MCPEndpointEdit`. The DAO `edit_endpoint` reads the row under its lock, keeps the old address in `old_url` (`dbs/postgres/gateways/mcps/dao.py:196`), and clears an OAuth secret when the edit is no longer OAuth at that address (`dao.py:197-202`, through `is_oauth_connection_at`, `dtos.py:245-254`). `_retire_for_edit` (`service.py:460`) compares the addresses too.
- **Who changes `base_url`.** The web reconnect starts past the URL screen (`startReconnect`, `connectJourney.ts:398-424`) and does not offer to change the address (`McpConnectJourney.tsx:859-863`). A rename sends the stored row back with its URL (`McpConnectionDetail.tsx:145-158`, `McpServersSection.tsx:374-386`). So for a saved row, only a direct API `PUT` changes `base_url` today.
- **Agent templates.** A template matches a project's MCP server by exact equality: `route.base_url == declaration.url` (`core/agent_templates/bindings.py:166-182`). The only bundled MCP URL is `https://mcp.example.com/mail` (`api/oss/src/resources/agent_templates/packages/outbound-prospecting/*/mcp.json`).
- **Web, journey.** The connect flow is a reducer in `web/packages/agenta-entities/src/mcpEndpoint/core/connectJourney.ts` (`startJourney`, `startReconnect`, `journeyReducer`). The reducer does no I/O. On `probe_succeeded` it can replace the auth mode with `detectedAuthMode(probe)` (`connectJourney.ts:35-39`, `:528-543`), which gives `api_key` for a probe mode of `unknown`. It replaces the name only when `nameTouched` is false (`:521`, `:539`). On `probe_failed` it goes to `check_failed` (`:548-556`). `needsOwnOauthApp(probe)` (`:49-50`) decides whether the OAuth screen asks for the person's own app. The hook `useMcpConnectJourney.ts` runs the probe in `submitUrl` (`:368-385`). `submitUrl` already handles a URL with `{secret}`: it sends no probe and goes to `naming` with the mode `api_key`. The hook runs the create in `submitName`. `submitManualCredential` (`:874`) saves a key with a full `PUT` that sends the URL and the binding on screen (`:927-948`).
- **Web, screens.** `McpConnectJourney.tsx` draws the journey; `useMcpConnectScreens` gives the screens to a view. It latches its consent effects once with a ref (`consentSteps`, `McpConnectJourney.tsx:505`, `:614-615`).
- **Web, views.** A view stack has two levels at most (`web/packages/agenta-ui/src/view-stack/types.ts:60-69`). View parameters "carry addresses only, never display names" (`types.ts:44-47`). `mcpConnectView` (`.../agentTemplate/views/mcpConnectView.tsx`) is the connect view. Its form is dirty for a reconnect, or when the URL field is not empty, until the connection is made (`McpConnectViewBody.tsx:52`). The view stack reads one `dirty` flag for two jobs. Save is disabled while `!form.dirty` (`web/packages/agenta-ui/src/view-stack/ViewFormActions.tsx:54`). The leave dialog opens for a dirty form: `settle` finds the dirty form before an action (`ViewStackHost.tsx:155`), and the stack's own `dirty`, which the page guards read, is true while any form is dirty (`ViewStackHost.tsx:325`). `useViewForm` passes the form's fields to the stack (`view-stack/hooks.ts:13-28`).
- **Web, hosts of a new connect.** (1) Settings > MCPs: `McpServersSection.tsx` mounts `ViewDrawerHost` with `mcpConnectView` as the first view (`:512-515`). (2) The agent's "Add MCP server" view: `McpAddViewBody.tsx` renders `McpAddServerList`. That list returns an `EmptyState` early for a project with no servers (`McpAddServerList.tsx:84-100`), and has one search field otherwise (`:104-112`). (3) `McpServerFormView.tsx:148,244` opens `McpConnectJourney` as a modal.
- **Web, hosts of a reconnect.** `McpServerViewBody.tsx:57`, `McpAddViewBody.tsx:94-103`, `McpServerFormView.tsx:235,249`, `agenta-settings-ui/src/mcp/McpServersSection.tsx:517`, `agenta-chat/src/components/McpServerNoticeCard.tsx:82` and `clientTools/GatewayConnectToolWidget.tsx:90`. Each one builds the target with `mcpReconnectTarget`. Their reconnect does not change.
- **Web, API calls.** New calls use the generated client through `@agenta/sdk/resources` (`getGatewayMcpClient`, `web/packages/agenta-sdk/src/resources.ts:192`) and validate the answer with zod at the boundary (`web/AGENTS.md`, "Keep zod validation at the boundary", with `safeParseWithLogging`). The MCP endpoint types are hand-written (`agenta-entities/src/mcpEndpoint/core/types.ts`).
- **Web, data.** `mcpEndpointsQueryAtom` reads the query route (`agenta-entities/src/mcpEndpoint/state/atoms.ts:28-45`). `getMcpConnectionStatus` gives a row's status (`core/connectionStatus.ts:59-73`). Its type has four values (`connected`, `login_expired`, `not_signed_in`, `unreachable`, `:17`), but the function never returns `unreachable` ("Unreachable is never derived yet", `:55`). `gatewayRefusalCode` reads the `code` of a refusal (`core/refusal.ts:76`). The agent builder shows only `custom` rows (`agentTemplate/mcpRail.ts:94-95`).
- **Web, Composio catalog UI.** `IntegrationCatalog.tsx` draws its rows with `CatalogListRow` (`:328`, `:486`). `CatalogListRow` has the slots `leading`, `title`, `titleSuffix`, `children` and `action` (`agentTemplate/CatalogListRow.tsx:4-28`). `AppCard` has no action slot (`drawers/shared/CatalogAppCard.tsx:64-90`). `AppLogo` is in the same file. It renders `next/image` with `unoptimized` (`:50-62`), which renders an `<img>` element with the `logo` string as its `src`. It shows its fallback, a plug icon, only when `logo` is missing (`:51`); an image that fails to load shows nothing. Other pieces: `CategoryChips.tsx` (it reads `useToolCatalogCategories`), `CatalogRowSkeleton.tsx`, `CatalogUnavailableNotice.tsx`.
- **Bundled catalog precedent, partial.** Agent templates ship as files in `api/oss/src/resources/agent_templates/`. `AgentTemplateCatalog` (`core/agent_templates/catalog.py:123`) reads them on first use and raises on an invalid catalog.
- **CI.** `.github/workflows/12-check-unit-tests.yml` runs the API unit layer on pull requests that touch `api/**` (`:9`, `:391`).
- **Agent, discover.** The builder agent has the platform ops `list_connections` and `discover_tools` (`BUILDER_AGENT_TOOLS`, `api/oss/src/core/workflows/builder_agent.py:26-37`). `discover_tools` is a direct call to `POST /api/tools/discover` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:2129-2136`). The route needs `VIEW_TOOLS` (`api/oss/src/apis/fastapi/tools/router.py:1490-1518`). `ToolsService.discover_capabilities` runs the provider's semantic search and joins the project's `gateway_connections` rows (`api/oss/src/core/tools/service.py:1156-1194`; `core/tools/discovery.py:1-11`). `list_connections` reads `POST /api/triggers/connections/query` (`op_catalog.py:2333-2343`). Both are Composio only. No platform op lists MCP servers.
- **Agent, ask.** `request_connection` is a static client tool with the URI `client:tool:request_connection:v0` and `render.kind` `connect` (`api/oss/src/core/workflows/static_catalog.py:126-197`). Its input is `integration` (a Composio key), or `target` with `plane` (`llm` or `mcp`) and `name`, both required (`:152-174`). The rule "exactly one of `integration` or `target`" is in the descriptions, not in the schema, because some providers refuse a root-level `oneOf` (`:186-190`). The API never runs this tool. The browser settles it.
- **Agent, the card.** `ConnectRequestWidget` picks the surface from the input: `GatewayConnectToolWidget` for a `target`, `ConnectToolWidget` for an `integration` (`web/packages/agenta-entity-ui/src/clientTools/registry.tsx:39-43`). `parseGatewayTarget` needs a `plane` and a non-empty `name` (`useGatewayConnectFlow.ts:23-31`). For an MCP target whose `name` is the slug of a `custom` row, the widget opens `McpConnectJourney` as a modal with `reconnect` (`GatewayConnectToolWidget.tsx:87-92`, `useGatewayConnectFlow.ts:67-73`, `:171-172`). `McpConnectJourney` reports the connection as `{id, slug, name}` through `onConnected` (`mcpEndpoint/McpConnectJourney.tsx:95-106`).
- **Agent, the dock.** The parked `request_connection` calls of the last assistant turn show in the connect dock above the composer (`web/packages/agenta-chat/src/clientTools/connectInteractions.ts:25-38`, `hooks/useConnectionDock.ts`, `components/ConnectionDock.tsx`, mounted in `web/mobile/src/features/chat/LiveConversation.tsx:1127`). The dock owns the actions; the inline row is a passive marker (`ConnectToolWidget.tsx:148-171`). The dock reads every such call as an integration: `isConnectInteraction` tests only the render kind and the tool name (`connectInteractions.ts:17-18`), and the cards use `connectIntegrationKey(meta)` and `useConnectFlow` (`ConnectionDock.tsx:193`, `:423`, `:494`). A message sent over the dock settles each parked call with `declinedConnectOutput(meta.input)` (`useConnectionDock.ts:147-153`; `web/packages/agenta-shared/src/clientTools/index.ts:133-137`).
- **Agent, the result.** The tool result is a plain object. For an integration: `{connected, integration, slug, reason?}` (`ConnectOutput`, `agenta-shared/src/clientTools/index.ts:106-115`). For a target: `{connected: true, target}`, or `{connected: false, target, reason}` with the reason `declined`, `cancelled` or `unverified` (`useGatewayConnectFlow.ts:36-62`). A target result holds no slug, because the agent already named the server.
- **Agent, the answer and the resume.** The browser sends a client tool's answer to the server. A card's settle reaches `sendToolOutput`, which calls `respondInteractionAnswer` with the session, the tool call id and the result (`web/packages/agenta-chat/src/hooks/useAgentConversation.ts:962-1004`; the host passes it as the dock's `onOutput`, `web/mobile/src/features/chat/LiveConversation.tsx:853-858`). The server owns the interaction and gates the resume. A refusal that says the interaction is already settled is ignored. Any other refusal, for example an interaction that belongs to another execution, is stamped on the conversation as a run error (`useAgentConversation.ts:985-1000`). On the client, `agentShouldResumeAfterApproval` is the predicate for `sendAutomaticallyWhen` (`useAgentConversation.ts:462-466`): a part counts as a client-tool result when its render kind or its tool name is a client tool and its state is `output-available` or `output-error` (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:93-103`; `CLIENT_TOOL_NAMES`, `agenta-shared/src/clientTools/index.ts:24`), and the run resumes when every tool part of the turn is settled (`agentApprovalResume.ts:211`). The runner parks one interaction for each turn and defers a second `request_connection` of the same step (`agenta-entity-ui/src/clientTools/deferred.ts:1-7`).
- **Agent, the activity fold.** On `/m` the transcript row of a client tool is inside the activity fold of its turn (`web/packages/agenta-chat/src/components/activity/ActivityTimeline.tsx:497`, `:523`). The fold is closed by default, also while the turn is parked (`ActivityTimeline.tsx:403-404`). A closed fold stays mounted, hidden and `inert` (`web/packages/agenta-ui/src/components/HeightCollapse.tsx:83-90`). So a person cannot reach a button on the row without opening the fold, and the dock is the surface that a person sees. A message sent over an open dock declines its parked calls (`steerOverDocks`, `LiveConversation.tsx:883-891`); with no open dock the message waits (`LiveConversation.tsx:876`).
- **Agent, an MCP entry.** An agent's `mcps` list holds `MCPServerConfig` items: `name`, `connection`, `policy` (`sdks/python/agenta/sdk/agents/mcp/models.py:205-226`). For a project server the connection is `MCPGatewayConnection`: `{"type": "gateway", "namespace": "custom", "slug": "<slug>"}` (`models.py:68-99`). The template binder writes `{"name": endpoint.slug, "connection": {...}}` (`api/oss/src/core/agent_templates/bindings.py:187-200`), and the web writes the same connection (`buildMcpConnectionRef`, `web/packages/agenta-entities/src/mcpEndpoint/core/agentReference.ts:55-57`). `mcps` is a keyed list, keyed by `name`; `add_item` appends an item (`op_catalog.py:915`, `:928`). The server derives the slug at create (`derive_endpoint_slug`, `api/oss/src/core/gateways/mcps/service.py:211-234`), so nobody knows it before the row exists.
- **Agent, the builder's rules.** The builder's prompt has rules for connections: check what exists, name a missing connection in the plan, ask one time, build without it on a decline, add one tool entry for each connected app, never name a tool to the person (`builder_agent.py:314-329`). The builder's field reference gives the `gateway_connection` entry (`:417-425`). The builder starts with `"mcps": []` (`:866`) and has no rule for an MCP server. The SDK field reference describes only the HTTP shape of an `mcps` item (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:199-203`).
- **Server-side state of a row.** `MCPGatewayService._connection_state` gives `ready` for the mode `none`, and for a `custom` row with a `secret_id` and `flags.is_valid`; it gives `needs_auth` otherwise (`core/gateways/mcps/service.py:754-769`). `_mcp_ready` copies the rule for a `custom` row (`api/oss/src/core/agent_requirements/service.py:107-111`).

### Decisions already made by the owner

1. Three layers. Layer 3 (the connection manager above) is reused and not rebuilt.
2. Ownership does not change. An MCP server row belongs to a project. The sign-in is the project's or each person's own. No new owner kind.
3. No new auth machinery. An entry must be able to describe every auth kind above, including a key in the URL path.
4. Layer 1 has two directions. Both are specified. This design does not choose.
5. Each connection keeps its own copy of the URL and auth settings, and a reference to the entry.
6. Composio stays separate. Composio gives tools, and the catalog gives MCP servers. The UI adds no hint between them.
7. Registry rules follow the registry's own practice (Direction B): an `io.github.*` name is accepted only when it starts with `io.github.<vendor_github_org>/`, and a `server` part declares a published, non-draft `server.json` schema (D4).
8. Schedules follow the project's existing practice: a monthly re-test (D3), and in Direction B a weekly drift check like workflow 47 (D4).
9. No switch to hide the catalog while the gateway is on.
10. No `CODEOWNERS` file. Every pull request is reviewed, which covers the catalog folder.
11. A server shows a notice when its catalog entry has a new address (D9).
12. The reference is the entry key only. Nothing reads a version, and the row's own copy shows any drift.
13. An agent finds and asks for a catalog server through the request-connection loop that exists. No new client tool and no new resume rule (D13).
14. Composio tools and MCP servers are different things. The builder never mixes them and never trades one for the other. When the person asks for an MCP server, the builder uses the MCP catalog. Otherwise the integration path of today stays as it is (D13.5).
15. The agent gets the entry's description: the reviewed text, with the limits of D1 and under the rule of D11. It is still never copied into a row's description (D13.1).
16. The chat card follows the practice for secrets: the host reads the person's permission and passes it to the dock, and the card turns its create actions off without it (D13.3).
17. Logos are hosted links, not files in the repository. An entry holds an optional `logo_url`, the `https` address of the vendor's own image. The API never fetches it, and the web shows it only as an `<img>` (D6, D11).

## Goals / Non-Goals

**Goals**

- One entry format and one read API for both directions.
- A person connects a well-known server without typing a URL or a header name.
- A change to an entry never changes a connected server.
- An agent finds a catalog server and asks the person to connect it, through the request-connection loop that exists.

**Non-Goals**

See "Out of scope" in `proposal.md`.

## Decisions

### D1. Two formats: the catalog file and the domain entry

There are two shapes, with one boundary between them.

- The **catalog file** (`catalog.json`) is what people (and the Direction B sync script) write. It holds every entry in one list. Each entry has a `key` field. Its `origin` says where the title, the description and the remotes come from. Only a `registry` entry holds a `server` part, in the `server.json` shape of the MCP Registry, with that format's own names (`$schema`). That shape exists only in the catalog file and in the readers.
- The **domain entry** (`MCPCatalogEntry`) is what the reader produces, what the service holds, and what the API returns. It has Agenta's names only, in snake_case. It has no `server` part, no `$schema` and no `origin`.

The reader parses the catalog file once, when it loads it, and validates each entry on its own. For each auth option, it also builds the endpoint that a create from that option would store, so the endpoint validators run at load (below). After that, the service and the router trust `MCPCatalogEntry` and do not check its shape again. The egress guard at create is not a repeat of this validation: it applies the deployment's network policy from the environment, which a check of the file cannot know.

#### The catalog file

The file `catalog.json`, with one entry of the origin `internal`:

```json
{
  "entries": [
    {
      "key": "linear",
      "origin": {"kind": "internal"},
      "title": "Linear",
      "description": "Find and manage issues, projects, and documents in your Linear workspace.",
      "logo_url": "https://linear.app/static/logo.png",
      "listing": {
        "categories": ["project_management"],
        "tested_at": "2026-11-20T00:00:00Z"
      },
      "connection": {
        "kind": "fixed_url",
        "url": "https://mcp.linear.app/mcp",
        "auth_options": [
          {"auth_mode": "oauth", "needs_own_app": false, "default_scopes": []},
          {
            "auth_mode": "api_key",
            "credential_binding": {"kind": "header", "name": "Authorization", "prefix": "Bearer"},
            "help_url": "https://linear.app/docs"
          }
        ]
      }
    }
  ]
}
```

The auth values and the logo address show the shape. They are not verified facts about Linear (see "First list").

The entries in the list are sorted by `key`. The file is written with a stable format: a 2-space indent and one trailing newline. A change to one entry then gives a small, clean diff, and two pull requests that change different entries seldom conflict. The CI unit test (D5) fails when the list is not sorted by `key`.

| Field | Set by | Rule |
| --- | --- | --- |
| `key` | Agenta | Required. It matches `^[a-z0-9][a-z0-9-]*$`. It appears once in the file. A key is never reused for a different server. |
| `origin` | Agenta | Where the title, the description and the remotes come from. A sum type, below. |
| `title`, `description` | Agenta | Only with the origin `internal`. Plain text. `title` has at most 100 characters and `description` at most 500. A `registry` entry takes them from its `server` part, with the same limits (D4). |
| `server` | the registry | Only with the origin `registry` (D4). |
| `logo_url` | Agenta; in Direction B the sync script can propose it (D4) | Optional. The `https` address of the vendor's own logo image, with the load rules below. The reader never fetches it (D6). |
| `listing.categories` | Agenta | One or more values of `MCPCatalogCategory` (D9). |
| `listing.tested_at` | Agenta | The time a person last completed the test checklist (D11). For maintainers; the API does not return it. |
| `connection` | Agenta | How a new server connects. A sum type, below. |

`origin` is a sum type:

| Shape | Meaning |
| --- | --- |
| `{"kind": "internal"}` | A person writes `title` and `description` in the entry. The entry has no `server` part. |
| `{"kind": "registry", "name": "app.linear/linear", "pinned_version": "1.0.2", "vendor_github_org": null, "skip_version": null}` | The title, the description and the remotes come from the registry entry `name`. `pinned_version`, `vendor_github_org` and `skip_version` are optional. `skip_version` is one registry version string that the sync script and the drift check ignore (D4). The entry has no `title` or `description` of its own. The entry holds a `server` part that the sync script writes. This shape and its rules exist only in Direction B (D4). |

The catalog file is the allowlist. There is no separate allowlist file: a registry name is read only when an entry in the catalog file names it in `origin.name`.

`connection` is a sum type, so that a key in the URL and an OAuth sign-in cannot be written for one entry:

| Shape | Meaning |
| --- | --- |
| `{"kind": "fixed_url", "url": "...", "auth_options": [...]}` | A fixed address. `url` is `https`. `auth_options` has one or more items with different modes; the first is the default. For a `registry` origin, `url` must also be one of the entry's remotes (D4). |
| `{"kind": "templated_url", "url_template": "https://host/{secret}/mcp", "help_url": "..."}` | The server takes its key in the URL path. `url_template` holds exactly one `{secret}`, in the path. The auth mode is `api_key` and the binding is `{"kind": "url"}`; the shape implies both. The row stores this template with `{secret}`, never the person's key; the relay puts the key in at send time. In version 1 a `templated_url` entry has the origin `internal` (D4). |

`auth_options` is a discriminated union on `auth_mode`:

| Shape | Meaning |
| --- | --- |
| `{"auth_mode": "none"}` | No sign-in. |
| `{"auth_mode": "api_key", "credential_binding": {"kind": "header", "name": "...", "prefix": "..."}, "help_url": "..."}` | A key in a header. `prefix` is optional. |
| `{"auth_mode": "api_key", "credential_binding": {"kind": "query", "name": "..."}, "help_url": "..."}` | A key in the query. `url` must not hold that parameter. |
| `{"auth_mode": "oauth", "needs_own_app": true, "default_scopes": [...], "help_url": "..."}` | OAuth. `needs_own_app` is a fact about the vendor: `true` when the vendor registers no clients, so every deployment needs a pre-registered app (GitHub, HubSpot and Asana, per `dtos.py:172-174`). `default_scopes` are checked first on the scope screen; empty means "what the server offers". |

`credential_binding` is the existing `MCPCredentialBinding`. There is no new binding type. One load rule is added: the binding of an `api_key` option is not `{"kind": "url"}`, because a key in the URL is the `templated_url` shape. `help_url` is optional and must be `https`.

The entry does not say whether OAuth uses CIMD or DCR. That depends on the deployment (`probe.py:756-770`), so the live probe decides it at connect time, as today. With `needs_own_app` false, the gateway uses CIMD or DCR. With `needs_own_app` true, the person enters a `client_id` and picks a project secret, as today.

How the entry covers each auth kind that Agenta supports:

| Auth kind | Entry shape |
| --- | --- |
| None | `fixed_url` with `{"auth_mode": "none"}` |
| API key in a header | `fixed_url` with an `api_key` option and a `header` binding |
| API key in the query | `fixed_url` with an `api_key` option and a `query` binding |
| API key in the URL path | `templated_url` |
| OAuth through CIMD or DCR | `fixed_url` with an `oauth` option, `needs_own_app` false |
| OAuth with a pre-registered client | `fixed_url` with an `oauth` option, `needs_own_app` true |

Not in version 1, and refused by the reader: a URL with template variables other than `{secret}`, static headers on an entry, and any credential value in an entry.

#### Load rules

The reader refuses an entry when one of these rules fails. They are the same in both directions. Direction B adds the registry rules of D4.

- The `key` does not match `^[a-z0-9][a-z0-9-]*$`.
- The `key` appears twice in the file. The reader refuses both entries and reports each one.
- The connection URL (`url` or `url_template`) is not `https`, has user info, or has an IP literal as host.
- A `help_url` is not `https`.
- The `title` has more than 100 characters, or the `description` has more than 500. The limits are the same for both origins.
- `auth_options` holds one mode twice, or an `api_key` option has no binding or a `url` binding.
- A category is not a value of `MCPCatalogCategory`.
- A `logo_url` is not `https`, has user info, has an IP literal as host, or has more than 2048 characters. The reader checks the form only. It never fetches the URL.
- For each auth option (and for the one mode of a `templated_url` entry), the reader builds the `MCPEndpointCreate` that `apply_entry` would store: the option's `auth_mode`, and an `MCPEndpointRoute` with the entry's URL and binding. A `ValidationError` refuses the entry. So these existing validators run at load: `MCPCredentialBinding._fits_its_kind`, `MCPEndpointRoute._no_credential_in_base_url` with `check_url_secret_placeholder`, and `MCPEndpointCreate._url_binding_needs_a_key` (`core/gateways/mcps/dtos.py`). They refuse a `{secret}` in a `fixed_url` URL, a `url_template` with no `{secret}` or with one outside the path, a header binding with no name, a query binding with a prefix, and a query binding whose parameter is in the URL.

#### The domain entry (what the API returns)

```json
{
  "key": "linear",
  "title": "Linear",
  "description": "Find and manage issues, projects, and documents in your Linear workspace.",
  "logo_url": "https://linear.app/static/logo.png",
  "categories": ["project_management"],
  "connection": {
    "kind": "fixed_url",
    "url": "https://mcp.linear.app/mcp",
    "auth_options": [
      {"auth_mode": "oauth", "needs_own_app": false, "default_scopes": []},
      {"auth_mode": "api_key", "credential_binding": {"kind": "header", "name": "Authorization", "prefix": "Bearer"}, "help_url": "https://linear.app/docs"}
    ]
  }
}
```

`connection` and `auth_options` have the same union shapes as in the catalog file. `logo_url` is the entry's own field, unchanged; the field is absent when the entry has none (D6). The address in the example shows the shape and is not a verified address.

Types (in `api/oss/src/core/gateways/mcps/catalog/dtos.py`):

- `MCPCatalogEntryKey`: a `NewType` over `str`, so that an entry key is not mixed with an endpoint `slug` or a registry `name`.
- `MCPCatalogEntry`: `key`, `title`, `description`, `logo_url`, `categories`, `connection`.
- `MCPCatalogConnection`: `Annotated[MCPCatalogFixedUrlConnection | MCPCatalogTemplatedUrlConnection, Field(discriminator="kind")]`.
- `MCPCatalogAuthOption`: `Annotated[MCPCatalogNoAuthOption | MCPCatalogApiKeyOption | MCPCatalogOAuthOption, Field(discriminator="auth_mode")]`. `MCPCatalogApiKeyOption.credential_binding` is the existing `MCPCredentialBinding` (`core/gateways/mcps/dtos.py:55`).
- `MCPCatalogCategory`: an enum (D9). `MCPCatalogProblem`: `{path, code, message}`.
- The file models are in `catalog/files.py`, apart from the domain DTOs: `MCPCatalogFile` holds `entries: List[MCPCatalogFileEntry]`, and each `MCPCatalogFileEntry` holds `key`, `origin` (`MCPCatalogOrigin`), `listing`, `connection`, and the fields that its origin needs. In the shared groups `MCPCatalogOrigin` has the `internal` member only. Direction B adds the `registry` member and `MCPCatalogServerPart`, the model of the `server.json` fields that the reader uses (D4).

The web calls the routes with the generated client and validates each answer with a zod schema at the boundary (D9). It handles each union with an exhaustive `switch` and a `never` check.

### D2. Layer 1: two ways to supply the entry data

Every entry is in the catalog file in both directions. The directions differ only in where the title, the description and the remotes of a `registry` entry come from.

| | `internal` entries | `registry` entries | What the database stores |
| --- | --- | --- | --- |
| Direction A | all entries | none | only the MCP server rows that people connect |
| Direction B | allowed | a person runs a script that writes `server` into the entry in the catalog file, and opens a pull request | the same |

No direction adds a catalog table. The MCP server row holds a reference by key, not a foreign key, so that a removed entry does not break the row (owner decision 5).

```text
api/oss/src/resources/mcp_catalog/
  catalog.json            every entry, in one list sorted by key
  CONTRIBUTING.md         how to add and test an entry
```

### D3. Direction A: internal entries

- A person writes each whole entry in the catalog file. Every `origin` is `internal`.
- A pull request adds or changes an entry. The reviewer checks the vendor's documentation for the URL and completes the test checklist (D11).
- The CI test (D5) loads the catalog file and fails on an invalid entry.
- The catalog file ships in the API image. The running API reads it and calls no external service.
- Upkeep: a person runs the test checklist (D11) in every pull request that changes an entry, and on every entry once a month. Each run updates `tested_at`.

### D4. Direction B: registry data from the MCP Registry

The registry API is at `registry.modelcontextprotocol.io`. It is frozen at `/v0.1/`, it is still labeled preview, and its data can be reset. The source is open (`github.com/modelcontextprotocol/registry`). The registry has no category and no auth detail, so a person still writes `listing` and `connection` in the entry.

The registry has two addresses that this design uses:

| Address | Use |
| --- | --- |
| `GET /v0.1/servers` | The list of servers. The "First list" names come from it. |
| `GET /v0.1/servers/{serverName}/versions/{version}` | One server at one exact version. The version `latest` is a special value that gives the latest version. `serverName` must be URL-encoded (`app.linear%2Flinear`); a name with a raw `/` gets `404`. |

On 2026-11-22, `GET /v0.1/servers/app.linear%2Flinear/versions/1.0.2` answered `200`. The answer holds the `server` part and a `_meta` part. The registry status is at `_meta["io.modelcontextprotocol.registry/official"].status` (`active` for `app.linear/linear` on 2026-11-23). `_meta["io.modelcontextprotocol.registry/official"].isLatest` stays `true` on a deprecated version, so it does not show a deprecation.

Rules for registry names:

- A registry name is read only when an entry in the catalog file names it exactly in `origin.name`. No patterns.
- Names in `io.github.*`: the owner's rule is to never accept an `io.github.*` copy of a vendor server. On 2026-11-22 the registry listed GitHub's own server as `io.github.github/github-mcp-server` and Sentry's as `io.github.getsentry/sentry-mcp`. A flat ban on the prefix would exclude two wanted servers. Rule, as in the registry's own practice (an `io.github.<org>` name proves a login to that GitHub organization): the reader refuses an `io.github.*` name unless `origin.vendor_github_org` is set and `origin.name` starts with `io.github.<vendor_github_org>/`. The reviewer confirms that the organization belongs to the vendor.
- A registry namespace proves control of a domain or a GitHub account. It does not prove that the publisher is the vendor. The reviewer still checks.
- A registry remote writes URL variables in its own way. So a `templated_url` entry is `internal` in version 1, and the reader refuses a `templated_url` entry with a `registry` origin.
- A `registry` entry has no `title` or `description` of its own.

Rules for the `server` part. `MCPCatalogServerPart` (`catalog/files.py`) holds them:

- `$schema` is one of the accepted `server.json` schemas. The reader accepts every published, non-draft schema that holds the fields it reads (`name`, `title`, `description`, `version`, `remotes[].type`, `remotes[].url`). It refuses a draft schema and an unknown schema. The accepted list is a constant in `catalog/files.py`, and a pull request extends it when the registry publishes a new schema. The list on 2026-11-22: `2025-09-29`, `2025-10-11`, `2025-10-17`, `2025-12-11`. The registry served `2025-12-11` on 2026-11-22 (seen on `app.linear/linear`).
- `name` is equal to `origin.name`, exactly.
- `title` is required. `title` is optional in `server.json`, so a registry server can have none. The reader refuses a `registry` entry whose `server` part has no `title`, and the person then writes the entry with the origin `internal`.
- `title` and `description` are plain text, with the limits of D1: `title` at most 100 characters, `description` at most 500. The reader reads only `name`, `title`, `description`, `version`, `remotes[]` (`type`, `url`), `icons[]` (`src`, `mimeType`) and `$schema`, and drops every other field.
- `icons` is optional. The reader keeps an icon only when its `src` is an `https` URL that passes the `logo_url` rules of D1, and drops the others. An icon is never shown from the `server` part: the only logo that the API returns is the entry's reviewed `logo_url`. The sync script uses `icons` to propose that field (below).
- `connection.url` is equal to the `url` of one `streamable-http` remote. A remote of another type cannot be connected. Remote URLs are `https`.

A fact that affects this direction: a search of the registry on 2026-11-22 found no entry in a vendor namespace for Slack, HubSpot, Asana or Intercom. The search is not a full audit. If it is right, those cards need `internal` entries. A mixed catalog works, because every entry is in the catalog file.

#### Sync at build time

A script copies registry data into the catalog file. The running API does not call the registry.

| Concern | Answer |
| --- | --- |
| Which names | The entries with a `registry` origin. |
| Our own fields | In the entry. The script rewrites only `server` and `origin.pinned_version`, and only of a `registry` entry whose registry version changed. It can also set `logo_url` (next row). It leaves every other entry as it is. |
| Logo | The script picks one icon from the registry's `server.icons`: the first with an `https` `src`, and an `image/svg+xml` icon before any other type. It writes that `src` to the entry's `logo_url` in two cases: the entry has no `logo_url`, or the pick differs from the pick of the `server.icons` in the committed file. So a `logo_url` that a person wrote stays until the registry's icon changes. The person reads the new URL in the diff, opens it, and keeps or replaces it in the pull request. An entry whose registry server has no usable icon keeps what it has. |
| Which addresses | For each name, `GET /v0.1/servers/{serverName}/versions/latest` gives the latest version and its status. `GET /v0.1/servers/{serverName}/versions/{version}` reads one exact version. `serverName` and `version` are URL-encoded in the path. |
| Pinning | `origin.pinned_version` in the committed catalog file. |
| "Newer" | The registry's latest version string is different from `origin.pinned_version`. The script does not assume semantic versions. |
| A bad upstream version | `origin.skip_version` holds one version string. When the registry's latest version is equal to `skip_version`, the script and the drift check count the entry as unchanged. A person sets it through a pull request when a new upstream version fails the test checklist (D11), and removes it when a later version passes. |
| Status | The script and the drift check read `_meta["io.modelcontextprotocol.registry/official"].status` from the latest version's answer, and report an entry whose status is `deprecated` or `deleted`. They do not read `isLatest` for this, because it stays `true` on a deprecated version. |
| How it runs | A person runs `api/scripts/mcp_catalog_sync.py` as one step of the monthly re-test (D3, D11), reads the diff, and opens the pull request. A change reaches users only after a merge and a release. |
| Drift check | `.github/workflows/52-mcp-catalog-drift.yml` runs the script with `--check` once a week (and by hand with `workflow_dispatch`). In check mode the script writes nothing. It exits with an error and lists the entries when the registry has a newer version for an entry (other than its `skip_version`), or when the registry's icon address for an entry changed, or when a named entry is missing, or has the status `deprecated` or `deleted`. A failed run is the signal: a person then runs the script, tests the changed entries and opens the pull request. The job has `permissions: contents: read` and uses no secret. It never opens a pull request or pushes a commit. This follows `47-railway-template-drift.yml`, which checks drift in dry-run mode on a schedule and fails loudly. |
| What it writes | The script parses each registry answer into `MCPCatalogServerPart` with the rules above, and writes the `server` part from that validated model only, with the `icons` that the model keeps. It writes `logo_url` by the rule of the "Logo" row. Unknown fields are dropped. It writes `catalog.json` in the same stable format: entries sorted by `key`, a 2-space indent and one trailing newline. |
| Registry down | The script fails and does not change `catalog.json`. The drift check job fails, and a person runs it again later. Deployments do not change. |
| Preview and data reset | When a named entry is missing, the script reports it and does not change that entry. It never removes an entry. |
| Upstream deprecation or removal | The script reports the status `deprecated` or `deleted`. A person decides to remove the entry from the catalog file. |
| Self-hosted, no internet | The catalog file is in the image. The catalog lists. |
| Two replicas | Each pod reads the catalog file of its own image. No shared state. |
| A changed remote | When the new `server.remotes` no longer hold `connection.url`, the CI test fails on the pull request. A person chooses the new URL and runs the test checklist again. |

### D5. Read path

One service reads the catalog. There is no importer interface: in both directions there is one way to read (the catalog file), and an interface with one implementation adds a layer that only forwards.

```python
# api/oss/src/core/gateways/mcps/catalog/service.py
class MCPCatalogService:
    def __init__(self, *, root: Path) -> None: ...        # the mcp_catalog folder
    def list_entries(self) -> List[MCPCatalogEntry]: ...
    def fetch_entry(self, *, entry_key: MCPCatalogEntryKey) -> Optional[MCPCatalogEntry]: ...
    def apply(self, *, endpoint: MCPEndpointCreate) -> MCPEndpointCreate: ...   # D7
    def problems(self) -> List[MCPCatalogProblem]: ...     # for the CI test
```

- The service parses `catalog.json` once, on first use. It validates each entry on its own, parses it into an `MCPCatalogEntry`, and keeps the valid entries in a dictionary by key. `api/entrypoints/routers.py` builds it once.
- `fetch_entry` is a dictionary lookup. It never joins the key into a file path, so a key such as `..` finds nothing.
- `apply` returns an endpoint with no `catalog_entry_key` unchanged. For an endpoint with a key, it looks the entry up (none gives `MCPCatalogEntryNotFoundError`) and returns `apply_entry(entry=..., endpoint=...)`. It reads only the loaded catalog, never the registry.
- An invalid entry is skipped and logged as an error, and the other entries load. This is new behavior: `AgentTemplateCatalog` raises on an invalid catalog. The reason for the difference: the MCP catalog is not needed to run an agent or to add a server by URL, so one bad entry must not remove the other cards.
- When the catalog file is not valid JSON, or has no `entries` list, the service logs an error and serves an empty catalog. The "Custom server URL" path still works.
- **CI.** No new workflow validates the catalog. One API unit test loads the real `catalog.json` in `api/oss/src/resources/mcp_catalog/`. It fails on any problem: a file that is not valid JSON, an invalid entry (a `logo_url` of a wrong form is one), a duplicate key, or a list that is not sorted by `key`. The test makes no network request, so it does not load a logo. So it catches a broken file and a bad entry before merge. The test runs in `12-check-unit-tests.yml`.

### D6. Read API and logos

New file `api/oss/src/apis/fastapi/gateways/mcps/catalog_router.py` with `MCPCatalogRouter`, in the same folder as `router.py` and `oauth_router.py`. Mounted at `/gateways/mcps` with the tag `Gateway: MCP` and the dependency `MCP_GATEWAY_ENABLED`. Routes are registered in `__init__` with `add_api_route`. The `MCPCatalogRouter` handlers use `@intercept_exceptions()` and `@handle_gateway_exceptions()`, as the `MCPGatewayRouter` handlers do (for example `create_endpoint`, `router.py:396-398`). Its constructor takes the catalog service and the MCP gateway service. Only the discover route reads the second.

| Route | Operation id | Permission | Answer | Used by |
| --- | --- | --- | --- | --- |
| `GET /gateways/mcps/catalog/entries/` | `list_mcp_catalog_entries` | `VIEW_MCP_ENDPOINTS` | `MCPCatalogEntriesResponse {count, entries}` | the catalog in both hosts |
| `GET /gateways/mcps/catalog/entries/{entry_key}` | `fetch_mcp_catalog_entry` | `VIEW_MCP_ENDPOINTS` | `MCPCatalogEntryResponse {count, entry}`; `404` with `mcp_catalog_entry_not_found` | the connect view, a server's detail, and the address state on a Settings row |
| `POST /gateways/mcps/catalog/discover` | `discover_mcp_catalog_entries` | `VIEW_MCP_ENDPOINTS` | `MCPCatalogDiscoveryResponse {count, can_connect, entries}` | the platform op `discover_mcp_catalog` (D13.1) |

- The list returns every entry, sorted by `title`. The catalog is small (tens of entries), so there is no `Windowing`, no `/query` route and no server-side search in version 1. The UI filters in the browser.
- The list and fetch answers hold domain fields only (D1), no secret, and are the same for every project.
- The discover answer is for an agent. It is light, with no logo and no URL, and it holds the project's servers for each entry (D13.1).
- Wire models go in `api/oss/src/apis/fastapi/gateways/mcps/models.py`.

**Errors.** Domain exceptions go in `api/oss/src/core/gateways/mcps/types.py`. `handle_gateway_exceptions` in `apis/fastapi/gateways/exceptions.py` maps them with `gateway_error_envelope`:

| Exception | Status | `code` | `retryable` | `next_step` |
| --- | --- | --- | --- | --- |
| `MCPCatalogEntryNotFoundError` | `404` | `mcp_catalog_entry_not_found` | false | "Pick an entry from the catalog, or add the server by URL." |
| `MCPCatalogAuthModeNotOfferedError` | `400` | `mcp_catalog_auth_mode_not_offered` | false | "Send an auth mode that the entry offers." `details.auth_modes` lists them. |

There is no catalog code for a model validation failure at create. The reader validates every entry at load (D1), so a `ValidationError` in `apply_entry` is a bug, and the API answers `500` for it, as for any bug.

**Logos.** An entry's logo is a link to the vendor's own image. `logo_url` is an optional `https` URL in the entry (D1), and the list and fetch answers return it unchanged. The discover answer leaves it out, because a model does not need it (D13.1).

- There is no logo route, because the image is on the vendor's host. No new unauthenticated route and no change to the auth middleware.
- The API never fetches a logo: not at load, not in CI, and not when it answers. The person's browser loads the image.
- Where the URL comes from: the person who adds the entry writes the address of the vendor's own logo. In Direction B the sync script proposes the registry's icon address, and a person reviews it (D4). The vendor hosts the image. Showing a vendor's logo to name its product follows the vendor's brand guidelines, and the app already shows vendor logos for the Composio integrations.
- An entry with no `logo_url`, and an image that does not load, show the default mark.
- `AppLogo` takes a logo string and renders it with `next/image` and `unoptimized` (`drawers/shared/CatalogAppCard.tsx:49-62`), which gives an `<img>` element with that `src`. Today it shows its fallback only when the string is missing. It gets two changes: an `onError` that switches to the default mark, and `referrerPolicy="no-referrer"`. `AppLogo` is a shared component, so the Composio cards get both changes too. The chat card draws the logo with `IntegrationTile`, which already falls back when the image fails (`agenta-entity-ui/src/clientTools/IntegrationTile.tsx:57-66`); it gets `referrerPolicy="no-referrer"`.
- Content security policy: the app shell sets none today. The only policies in the web code are on the embed page (`web/mobile/src/pages/embed/[embedId].tsx`) and on the sandboxed frames of the HTML app and the office viewer. A self-hoster that adds its own policy must allow `https:` in `img-src` (D10).

### D7. Connect from a card

There is no separate create body. The existing create body gets one optional input field, `MCPEndpointCreate.catalog_entry_key`.

**What the web sends.** The web sends `catalog_entry_key` and the route fields that a create of the same server without a key would send:

| Connection kind | `auth_mode` | `data.route.base_url` | `data.route.credential_binding` |
| --- | --- | --- | --- |
| `fixed_url` | `oauth` or `none` | the entry's `url` | none |
| `fixed_url` | `api_key` | the entry's `url` | the option's `credential_binding` |
| `templated_url` | `api_key` | the entry's `url_template`, with `{secret}` | `{kind: "url"}` |

The create sends no `secret_id` for any kind. `_url_binding_needs_a_key` (`core/gateways/mcps/dtos.py:303`) needs the mode `api_key` for a `url` binding, and does not need a `secret_id`. The person's secret is bound after the create, as for every API key server today (`submitManualCredential`, `useMcpConnectJourney.ts:927-948`).

The server then overwrites `base_url`, `credential_binding` and `catalog_entry_key` from the entry (`apply_entry`, below). The web sends the entry's values so that a new web works against an old pod during a rollout (D8).

**Model validation comes first.** FastAPI validates the body as `MCPEndpointCreateRequest` (`apis/fastapi/gateways/mcps/models.py:27-28`) before the router runs. So `MCPCredentialBinding._fits_its_kind` (`dtos.py:81`), `MCPEndpointRoute._no_credential_in_base_url` (`dtos.py:132`) and `MCPEndpointCreate._url_binding_needs_a_key` (`dtos.py:303`) check the request as sent. A request that fails model validation gets `422` before the catalog code runs, as for any create. For example, a `url` binding with no `base_url` gets `422`, because `check_url_secret_placeholder` (`dtos.py:96`) needs one `{secret}` in the path. So "the entry wins" holds for a request that passes model validation. A request with a key that leaves out `base_url` and sends no binding passes model validation, so the API accepts it and takes the URL and the binding from the entry.

#### Applying an entry: one pure function

```python
# api/oss/src/core/gateways/mcps/catalog/apply.py
def apply_entry(
    *,
    entry: MCPCatalogEntry,
    endpoint: MCPEndpointCreate,
) -> MCPEndpointCreate: ...
```

- It does no I/O. A unit test calls it with no FastAPI and no database.
- It refuses an `auth_mode` that the entry does not offer (`MCPCatalogAuthModeNotOfferedError`). For a `templated_url` entry the only mode is `api_key`.
- It builds a new `MCPEndpointCreate` with `MCPEndpointCreate.model_validate(...)` from the request's dump, with these fields from the entry:
  - `data.route.base_url`: `connection.url`, or `connection.url_template` for a `templated_url` entry (the template with `{secret}`, never a key);
  - `data.route.credential_binding`: the option's binding for `api_key`; `{kind: "url"}` for a `templated_url` entry; `null` for `oauth` and `none`;
  - `catalog_entry_key`: `entry.key`.
  The entry wins over the request for these fields. The request reaches `apply_entry` only after it passed model validation (above). The reader built and validated the same route for each auth option at load (D1), so the validators cannot fail here. It does not catch `ValidationError`: one here is a bug (D6).

#### Steps, against the code that exists

1. **List.** The web reads `GET /gateways/mcps/catalog/entries/` and `mcpEndpointsQueryAtom` (`POST /gateways/mcps/endpoints/query`). The query route answers through `_endpoint_json`, which drops null fields, so a server added by URL has no `catalog_entry_key` in the JSON.
2. **Start.** The person presses Connect. The host opens `mcpConnectView` with the parameter `catalogEntryKey` (an address, not the entry). The view body reads the entry with the fetch route. While it loads, the view shows a loading state; a `404` shows the "not in the catalog" failure with "Custom server URL". Then the journey starts in catalog mode (D9). The journey keeps only the entry's `key`, `title` and `connection`.
3. **Probe.** The host starts the journey only when `useMcpCatalogStart` is ready (D9, "Connect view"). That hook reads the entry and waits for the project's server list, because a free name computed from a list that is not loaded yet can be a taken name, and with `nameTouched` true nothing computes it again. The host passes the entry and the loaded names to the journey. The journey hook does not wait for anything. Its catalog effect sets the URL to the entry's address (`connection.url`, or `connection.url_template` for a `templated_url` entry), the name to a free name from the entry's title and the names it got, and `nameTouched` to true. Then it calls the existing `submitUrl` with that URL (`useMcpConnectJourney.ts:368-385`). The call is latched with a ref, as `consentSteps` is, because React runs a mount effect twice in strict mode. Until the start is ready, the host shows its loading state. `submitUrl` already handles both kinds:
   - **`fixed_url` entry.** It runs the probe (`POST /gateways/mcps/endpoints/probe` → `_guard_custom_endpoint_url` → `MCPServerProbe.probe`). The URL screen is never shown first.
   - **`templated_url` entry.** The template holds `{secret}`, so `submitUrl` sends no probe and goes to `naming` with the mode `api_key`. The address does not exist without its key, and the probe route refuses a `{secret}` URL with no `secret_id`. The person picks a project secret. `submitName` then checks the address with that secret before the create (`checkWithSecret`, `useMcpConnectJourney.ts:646-648`).
   Because `nameTouched` is true, the probe's server name does not replace the name (`connectJourney.ts:521`, `:539`).
   The name can still be taken at create time, for example when another person connects the same entry first. The create then gets `mcp_connection_name_taken`, and the journey uses the handling that exists today: `isNameTakenRefusal` (`core/refusal.ts:157-162`) makes the hook send `name_taken` (`useMcpConnectJourney.ts:739-743`), and the reducer goes back to `naming` with the refusal (`connectJourney.ts:620-623`). The name field stays editable in catalog mode.
4. **Offered modes.** In a catalog journey the offered modes are the entry's modes, minus `oauth` when the probe's `auth.mode` is not `oauth`. The reducer never sets a mode outside that set. Four places in `connectJourney.ts` can move to a mode or to a screen today, and in catalog mode each one keeps the mode inside the offered set:
   - **`probe_succeeded`** (`:528-546`), with `detectedAuthMode` (`:35-39`). When the current mode is in the set, it stays; otherwise the first mode of the set is taken. So `detectedAuthMode` cannot move an OAuth-only entry to `api_key` or `none`. When the set is empty, the journey goes to `check_failed` with a catalog message ("This server does not answer as the catalog expects"), with Retry and "Custom server URL".
   - **`keepChoice`** (`:531-533`), inside `probe_succeeded`. It keeps a mode the person picked on a re-check. In catalog mode it keeps the mode only when the mode is in the set.
   - **`auth_mode_selected`** (`:571-595`). The reducer ignores an event whose mode is not in the set, as it ignores `oauth` today when `oauthOffered` is false (`:573`).
   - **`choose_manual_auth`** (`:697-698`). It goes to the key screen. The reducer ignores it when `api_key` is not in the set, and the screens do not offer it then.
   There is no new journey status.
5. **Own OAuth app.** The row's "Needs your own OAuth app" reads the entry's `needs_own_app`. The journey's OAuth screen still reads the probe (`needsOwnOauthApp`, `connectJourney.ts:49-50`). The two can differ: the vendor can change, and a deployment can register through CIMD where another cannot. In the flow, the probe wins.
6. **Read-only fields.** In a catalog journey the URL is read-only on every screen, including `check_failed`. For an `api_key` option the binding fields are read-only and hold the entry's binding. "Custom server URL" on a failure screen opens the empty by-URL flow, as every other "Custom server URL" button does. The connect flow that the chat opens for an agent's request does not offer this button (D13.3).
7. **Create.** The web calls `POST /gateways/mcps/endpoints/` with `catalog_entry_key`. In `MCPGatewayRouter.create_endpoint`, after the permission check, the router makes one call: `endpoint = self.catalog_service.apply(endpoint=body.endpoint)`. Then it runs `_guard_custom_endpoint_url` on `endpoint.data.route.base_url`, so the guard checks the address that is stored. Then it calls `MCPGatewayService.create_endpoint(..., endpoint=endpoint)`.
   - The service and the DAO `create_endpoint` signatures do not change. `map_mcp_endpoint_create_to_dbe` writes `dto.catalog_entry_key` to the column. `map_mcp_endpoint_dbe_to_dto` builds `MCPEndpoint` field by field (`dbs/postgres/gateways/mcps/mappings.py:43-77`), so it must read `dbe.catalog_entry_key` too. Without that line every read returns a row with no key.
   - The router is the only caller of the service create (`router.py:409`), and it always calls `apply` first. So a stored key always comes with the entry's URL and binding.
   - `catalog_service` is a required argument of `MCPGatewayRouter.__init__`. Every call site passes it. There are 11 (`grep -rn "MCPGatewayRouter(" api --include='*.py'`):
     - `api/entrypoints/routers.py:1622`, which passes the one service it builds.
     - `api/oss/tests/pytest/unit/gateways/`: `test_gateways_mcp_router.py:290,1392,1443,1567`, `test_gateways_ssrf_registration_gate.py:113`, `test_gateways_sandbox_credential.py:714`, `test_gateways_plane_flags.py:283`, `test_gateways_mcp_router_user_sign_in.py:128`, `test_gateways_mcp_oauth_callback_authorization.py:95`.
     - `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_connect.py:115`.
     The tests pass an empty catalog. There is no mode that drops a key. The constructor of `MCPGatewayService` does not change.
8. **Sign in.** Unchanged. For OAuth: `POST /gateways/mcps/endpoints/{endpoint_id}/connect` with no scopes (`MCPOAuthConnectService.discover`, `MCPGatewayService.cache_endpoint_discovery`), then with scopes (`MCPOAuthConnectService.begin`, `_resolve_client_info`), then the callback `GET /gateways/mcps/connect/callback` (`complete`, which calls the DAO `bind_endpoint_secret`). For a person's own sign-in: `connect?owner_kind=user` (`_connect_person`), unchanged.
9. **A key that is refused later.** `submitManualCredential` saves a new key with a full `PUT` that sends the URL and the binding on screen (`useMcpConnectJourney.ts:927-948`). In a catalog journey both are read-only and come from the entry. So the row has the entry's binding and the entry's address after the `PUT`, and the key stays.
10. **Check.** `POST /gateways/mcps/endpoints/{endpoint_id}/check` (`record_endpoint_check`), unchanged.

**A catalog server is a `custom` row.** It is a normal row in `mcps_endpoints`, in the namespace `custom`. It is not in `standard`: that namespace means an endpoint the service generates for a provider with no row. A catalog server needs its own stored URL, name and sign-in (owner decision 5), and the agent builder lists only `custom` rows (`mcpRail.ts:94-95`). Nothing in the relay, `_resolve_target` or agent references changes.

#### Rules for the reference

- `catalog_entry_key` is accepted on create only. It is an output field on `MCPEndpoint`. `MCPEndpointEdit` does not carry it.
- An edit keeps the key, because `map_mcp_endpoint_edit_to_dbe` does not assign it. This covers a rename and every edit that sends the full row.
- **The address rule.** In the DAO `edit_endpoint`, beside the OAuth secret rule and under the same row lock, one new comparison reuses `old_url` (`dao.py:196`): when the edit's `base_url` (or `""`) is not equal to `old_url`, `dbe.catalog_entry_key` is set to null. `_retire_for_edit` and `is_oauth_connection_at` do not change. The rule is not in the mapper, because a mapper only maps. It does not depend on `oauth_refresher`.
- For a row from the catalog, only a direct API `PUT` changes `base_url` today. The web reconnect does not offer to change the address, and a rename sends the stored URL back (see "Who changes `base_url`" above).
- A change of auth mode or binding at the same URL keeps the key, by design. The key says where the row came from. The row's own copy says what it uses.
- A project can hold more than one row from one entry (two Linear workspaces). The display name must differ, as today (`MCPConnectionNameTakenError`).
- Nothing reads the key at run time. A removed entry leaves the key on the row, and the row keeps working. A create with the key of a removed entry gets `404`.
- A server does not change when its entry changes. The web shows a notice when the address changed (D9). The notice compares URLs.

**Agent templates.** A template finds a project's server by exact `route.base_url == declaration.url` (`core/agent_templates/bindings.py:166-182`). So a server from a card satisfies a template only when the entry's URL is equal to the template's declared URL, character for character. Today no bundled template declares a catalog vendor: the only bundled MCP URL is `https://mcp.example.com/mail`. Matching on `catalog_entry_key` in place of the URL is a possible later change.

### D8. Migration

One revision in `api/oss/databases/postgres/migrations/core_oss/versions/`. The head in this checkout is `oss000000063_add_mount_visibility.py`; other branches already use later numbers, so the number is picked at merge time.

| Table | Change |
| --- | --- |
| `mcps_endpoints` | Add `catalog_entry_key` (`String`, nullable). No constraint, no index, no backfill. |

The column is additive and nullable, so it passes the migration gate (`api/AGENTS.md`, "Migration gate").

| Case | Behavior |
| --- | --- |
| Old pod, new schema | The old code does not know the column. A create leaves it null. An edit keeps it, also an edit that changes `base_url`; that gap lasts only for the rollout. |
| New web, old pod | The old `MCPEndpointCreate` has no `catalog_entry_key`. Its base models (`Slug`, `Header`, `Metadata` in `sdks/python/agenta/sdk/models/shared.py:110-158`) set no `extra` rule, and `MCPEndpointCreate` (`core/gateways/mcps/dtos.py:295`) sets none. No class in the chain sets `extra`, so Pydantic's default, `ignore`, applies: the old pod drops the field. The new web always sends the entry's URL as `base_url`, so the old pod creates a working server without a reference. The person sees no failure. |
| Old pod answers the catalog list | `404`. The UI shows the catalog error state, with the custom URL action. |
| Rollback | The column stays. Rows keep working; the key is not read. |

### D9. UI

All code goes in `web/packages` and `web/mobile`. No antd, tokens only, one component per file, text from `@agenta/i18n` (`web/mobile/AGENTS.md`). `web/oss/src/components/pages/settings/MCPEndpoints/MCPEndpoints.tsx` also mounts `McpServersSection`, so the abandoned desktop app changes with the shared section. No file in `web/oss` is edited.

**Data.** `web/packages/agenta-entities/src/mcpCatalogEntry/`:

- `api/`: calls the routes with `getGatewayMcpClient()` from `@agenta/sdk/resources`, and validates each answer with `safeParseWithLogging` (`web/AGENTS.md`, "Keep zod validation at the boundary").
- `core/schema.ts`: the zod schema of the list and fetch answers. `connection` is a discriminated union on `kind`, and each auth option is a discriminated union on `auth_mode`. `key` is `z.string().brand<"McpCatalogEntryKey">()`, so a key made anywhere else does not type-check. The entry types are `z.infer` of this schema. The schema checks each entry: an entry that does not match is logged and left out, and the other entries show.
- `core/catalogFilter.ts`: search and category filter, pure. Search matches three fields of an entry, without regard to case: its `title`, its `description`, and the host of its address (`connection.url`, or `connection.url_template` for a `templated_url` entry). It matches no other field.
- `core/entryState.ts`: the state of an entry from the project's rows, and `entryAddressChanged`.
- `state/atoms.ts`: the list query and a fetch query by key.
- `hooks/useMcpCatalogStart.ts`: the steps before a catalog journey (see "Connect view" below).

The new subpath `@agenta/entities/mcpCatalogEntry` needs an entry in the `exports` of `packages/agenta-entities/package.json` (beside `./mcpEndpoint`, `:45`). The MCP endpoint types stay hand-written in `mcpEndpoint/core/types.ts`, and `MCPEndpoint` gets the optional `catalog_entry_key` there.

**View parameters.** `McpConnectViewParams` becomes a union of three starts, each with the common `onConnected`: `{reconnect: McpReconnectTarget}`, `{catalogEntryKey: McpCatalogEntryKey}`, or `{}` for the by-URL flow. A view gets one start, so a reconnect with a catalog key cannot be written. The props of the `McpConnectJourney` modal become the same union, with `catalogEntryKey` for the chat (D13.3).

**Journey mode.** `McpJourneyState` gets `mode: {kind: "url"} | {kind: "catalog", entry}`. `entry` holds only `key`, `title` and `connection`, with no logo and no description. The hook `useMcpConnectJourney` takes one `start` option in place of `reconnect`: `{kind: "url"} | {kind: "reconnect", target} | {kind: "catalog", entry}`. A catalog start gets the entry and the loaded names from its host. It sets the URL, a free name and `nameTouched: true`, and calls `submitUrl` (D7 step 3). The wait for the project's server list is in `useMcpCatalogStart` only ("Connect view" below). These are derived from `mode` and the probe, inside the reducer and the hook, and are not separate inputs:

- the offered auth modes (D7 step 4). `AuthModeSelector` hard-codes its list in `ORDER` (`components/AuthModeSelector.tsx:22`). It gets one new optional prop, `modes?: MCPAuthMode[]`, with the default `ORDER`. A catalog journey passes the offered modes, and a by-URL journey passes nothing, so it shows today's three modes;
- whether the URL is read-only;
- the binding the key screen starts with, and whether it is read-only;
- that a probe does not pick a mode outside the offered set;
- `scopesSaved`: the entry's `default_scopes`, or `null` when it is empty, because `withOfferedScopes` reads `null` as "check every offered scope" (`connectJourney.ts:89-96`);
- `catalog_entry_key` in the create body.

**Leaving the view.** `McpConnectViewBody.tsx` sets `dirty: !done && (reconnect !== null || journey.state.url.trim() !== "")` (`:52`). Save is disabled while `!form.dirty` (`ViewFormActions.tsx:54`), so a step can run only on a dirty form. In catalog mode `dirty` is `!done`, as for a reconnect: true until the connection is made. So Save works on every step of an OAuth entry and of a `none` entry, where the person types nothing.

The leave dialog uses a separate check: in catalog mode there is no leave dialog while no row exists yet, that is, while `journey.state.endpointId` is null (the journey has not created the pending row). The view stack reads one `dirty` flag for both Save and the leave dialog, so the smallest change is one optional field on `ViewForm` (`web/packages/agenta-ui/src/view-stack/types.ts:90`):

- `guardLeave?: boolean`. When it is `false`, the stack treats the form as clean for leaving: `settle` skips it when it looks for the dirty form (`ViewStackHost.tsx:155`), and the stack's own `dirty` does not count it (`ViewStackHost.tsx:325`). Save still reads `dirty` (`ViewFormActions.tsx:54`).
- When it is left out, leaving follows `dirty`, as today. No other view changes.
- `useViewForm` passes the field to the stack with the other fields (`view-stack/hooks.ts:17-27`).

In catalog mode `McpConnectViewBody.tsx` sets `guardLeave: journey.state.endpointId !== null`. A person who opens a card and goes back before the row exists sees no leave dialog. After the journey creates the pending row, the leave dialog asks first, and leaving deletes the pending row, as today (`cancelDeletesEndpoint`, `connectJourney.ts:455-456`).

**Entry state.** An entry's state comes from the status of the project's active rows that have its key, through `getMcpConnectionStatus`. `core/entryState.ts` leaves out a row with `flags.is_active === false`, because `getMcpConnectionStatus` does not read that flag (`connectionState.ts:15-22`, `connectionStatus.ts:59-73`). It sorts an entry's rows by `slug`, the order of the discover answer (D13.1):

| State | When | Action |
| --- | --- | --- |
| Connect | no row has the key | "Connect" |
| Connected | a row with the key has the status `connected` | "Connect another"; in Settings also "View" |
| Needs sign-in | rows have the key, and each has the status `not_signed_in` or `login_expired` | "Sign in", which opens the existing reconnect for the first such row by `slug` |

A row is not "Connected" because it has the key alone. `getMcpConnectionStatus` never returns `unreachable` today (`connectionStatus.ts:55`), so the rules do not name it, and the three states cover every row.

**Address changed.** A pure function `entryAddressChanged(row, entry)` in `core/entryState.ts` is true when the row has the entry's key and the row's `base_url` is not equal to the entry's address: `connection.url` for `fixed_url`, `connection.url_template` for `templated_url`. For `templated_url`, both sides hold the template with `{secret}`, never a key (D1). When the function is true:

- the server's detail (`McpConnectionDetail.tsx`) shows a notice with the action "Add at the new address";
- the server's row in Settings (`McpServersSection.tsx`) shows the state "New address" beside its status.

The notice text shows the old and the new host as plain text: "The catalog moved this server from mcp.old.example to mcp.new.example." When only the path changed, the text names the one host. "Add at the new address" opens the catalog connect for that entry (`mcpConnectView` with `catalogEntryKey`). The new connection is a new row. The person removes the old row when the new one works. The API does not change for this.

The Settings list reads the entries with the fetch query, one query for each distinct key among its rows, and only when a row has a key. It does not read the list route, because it needs only the entries of its own rows. Rows with the same key share one query, because the query cache keys a fetch by the entry key. So the list makes one fetch call for each distinct key, with no batching layer. The detail uses the same query. A Settings list with no catalog rows makes no catalog request. `CONTRIBUTING.md` tells maintainers not to make cosmetic URL changes (a trailing slash, a change of case), because every connected user then gets the notice.

**Entry text and links.** The UI shows `title` and `description` as plain text. The web does not copy the entry's description into the row's `description`. One path gives the description to a model: the answer of `discover_mcp_catalog`, for the builder (D11, D13.1). A `help_url` is rendered as a link only when its scheme is `https:`; the web checks the scheme before it renders, and does not rely on the API check. The link has `rel="noopener noreferrer"`.

**Entry rows.** Each entry is drawn with `CatalogListRow`, the component that `IntegrationCatalog.tsx` uses: `AppLogo` in `leading`, the title, the state in `titleSuffix`, the description and "Needs your own OAuth app" as children, and the button in `action`. `AppCard` is not used, because it has no action slot. The owner's word "card" means this row. Loading uses `CatalogRowSkeleton`. A failed load uses `CatalogUnavailableNotice` with retry. `CategoryChips` reads `useToolCatalogCategories` today; it is split into a component that takes `categories` as a prop, and a thin wrapper for the tool catalog. "Composio stays separate" is a backend rule; these UI pieces are shared.

**New components** in `web/packages/agenta-entity-ui/src/mcpEndpoint/`: `McpCatalogEntryList.tsx` (presentational: entries, their states, and the callbacks `onConnect`, `onSignIn`, `onViewServer`, `onCustomUrl`) and `components/McpCatalogByUrlRow.tsx`. A new i18n catalog `entityUi.mcpCatalog`, with every supported language.

**New view.** `agentTemplate/views/mcpCatalogView.tsx` (`defineView` and `lazyView`, id `mcp.catalog`) and `agentTemplate/views/McpCatalogViewBody.tsx`, exported from `entity-ui/src/mcpEndpoint/index.ts` beside `mcpConnectView`. No new Next.js route.

**Host 1: Settings > MCPs** (`McpServersSection.tsx`).

- The button keeps its label "Connect MCP" (`settings.mcp.connect`). It always opens `mcpCatalogView` at level 1. Nothing is fetched before the click. A row's Connect pushes `mcpConnectView` with `catalogEntryKey` at level 2. "Custom server URL" pushes `mcpConnectView` with no key at level 2. A reconnect keeps `mcpConnectView` at level 1, as today.
- The catalog view has a search field and category chips, and handles four states: loading, error, no match and empty (no entries). Each state offers "Custom server URL".
- The empty state of the page says "Connect a server by URL..." today (`settings.mcp.emptyBody`). It changes to name the catalog.
- `onViewServer` sets the section's `viewingKey` (`McpServersSection.tsx:187`), which opens the server's detail.
- A row of a catalog server shows the "New address" state when `entryAddressChanged` is true (above).
- A person without `edit_mcp_endpoints` sees no "Connect MCP" button today (`readOnly`, `McpServersSection.tsx:340,486`). That does not change.

**Host 2: the agent's "Add MCP server" view** (`McpAddViewBody.tsx`, `McpAddServerList.tsx`). This view is at level 1 and its connect step is at level 2, so a catalog view between them would be a third level. The catalog is shown inline, as `IntegrationAddViewBody.tsx` shows `IntegrationCatalog`:

- `McpAddServerList` shows the project's servers, and then a section "From the catalog" with `McpCatalogEntryList`.
- The list's one search field filters the servers and the catalog entries together. The section adds the category chips and no second search field.
- A project with no servers returns an `EmptyState` early today (`McpAddServerList.tsx:84-100`). That return comes before the `SearchInput` (`:104-112`), so the catalog and the search field would never show there. That state changes: it shows the search field, the catalog section and "Custom server URL". With no servers, the search field filters the catalog only.
- A row's Connect calls a new prop `onConnectEntry(key)`. The view body pushes `mcpConnectView` with `{catalogEntryKey, onConnected}` at level 2. When the connection is made, the existing `onConnected` adds the server to the agent.
- The "Connect server" buttons stay and open today's flow. Their label becomes "Custom server URL".
- When the catalog fails to load, the section shows the notice with retry. The list and the custom URL button work as today.
- There is no "View" here: `mcpServerView` takes an item of the agent (`McpAddViewBody.tsx:76`), and a server that is not on the agent has none. A connected server is in the list above, with its Add action.
- Today this list does not check `edit_mcp_endpoints` before it offers "Connect server" (`McpAddServerList.tsx:95,115`); the API refuses a create without the permission. The catalog rows follow the same rule as that button.

**Host 3: `McpServerFormView.tsx`.** It opens `McpConnectJourney` as a modal outside the view stack (`McpServerFormView.tsx:244-249`). The form view itself opens when a person taps an MCP server on the agent that is missing, turned off or needs repair: `openRow` calls `openForm` for that server (`McpServersSectionBody.tsx:101-118`). The journey opens from the form only when the person presses its connect button (`McpServerFormView.tsx:148`) or "Reconnect" (`:235`). Version 1 leaves it as it is, with no catalog.

**Host 4: the connect dock in the chat.** An agent's catalog request shows as a card in the connect dock. "Connect" on the card makes the transcript row of the request mount `McpConnectJourney` as a modal in catalog mode, with the prop `catalogEntryKey`. The host reads the person's permission and passes it to the dock as `canEditMcpEndpoints`, as it passes `canEditSecrets` to the secret dock. D13.3 specifies this host.

**Connect view.** `McpConnectViewBody.tsx` reads the start from the parameters. For `catalogEntryKey` it calls the hook `useMcpCatalogStart(catalogEntryKey)` (`agenta-entities/src/mcpCatalogEntry/hooks/`). The hook reads the entry with the fetch query and waits for the project's server list (`mcpEndpointsQueryAtom`). It gives the loading, not-found, error and ready states, with the entry and the existing names. This is the only place that waits for the list. The view mounts the journey when the hook is ready, and passes the entry and the names to the catalog start (D7 step 3). The chat modal calls the same hook (D13.3), so the two hosts run the same steps before the journey. Cancel deletes the pending row, as today (`cancelDeletesEndpoint`).

**Refusals from the API.** The web reads the code with `gatewayRefusalCode` and handles each catalog code. Each has an i18n key and a test, and each offers "Custom server URL", except in the chat modal (D13.3):

| Code | Where it comes from | Event and status | What the person sees |
| --- | --- | --- | --- |
| `mcp_catalog_entry_not_found` | the fetch of the entry, before the journey starts | no journey event: `useMcpCatalogStart` gives its not-found state | "This server is no longer in the catalog." |
| `mcp_catalog_entry_not_found` | the create | the existing event `create_failed`, to the status `create_failed` | the same text, on the create failure screen |
| `mcp_catalog_auth_mode_not_offered` | the create | the existing event `create_failed`, to the status `create_failed` | the catalog message ("This server does not answer as the catalog expects"), on the create failure screen |

A create failure goes to `create_failed` today, not to `check_failed`: the hook sends `create_failed` for every refusal of the create that is not a taken name (`useMcpConnectJourney.ts:739-743`), and the reducer sets the status `create_failed` (`connectJourney.ts:617-618`). The catalog codes use that path with their own text. There is no new event and no new status. `check_failed` is only for a probe that fails, or for an empty set of offered modes (D7 step 4).

**Server detail** (`McpConnectionDetail.tsx`). One line "From the catalog: <title>" when the row has a `catalog_entry_key` and the fetch route returns the entry, and the address notice when it applies. The fetch query is enabled only for a row with a key, so a detail never loads the list. The catalog view is loaded with `lazyView`, so the Settings chunk does not get the catalog UI (`web/mobile/AGENTS.md`, "Speed budget").

**Categories in version 1.** A proposal for the team to edit. Each value has the i18n key `entityUi.mcpCatalog.category.<value>`.

| `MCPCatalogCategory` value | English label |
| --- | --- |
| `developer_tools` | Developer tools |
| `project_management` | Project management |
| `docs_and_knowledge` | Docs and knowledge |
| `communication` | Communication |
| `crm_and_support` | CRM and support |
| `payments` | Payments |
| `design` | Design |
| `data_and_infrastructure` | Data and infrastructure |
| `analytics` | Analytics |

**Names in code.** "Catalog" already names a server's tool list in `agenta-entities/src/mcpEndpoint/core/toolCatalog.ts` (`McpCatalogTool`, `toCatalogTools`). The new names always say `CatalogEntry` or `mcpCatalogEntry`.

**Stories.** `web/AGENTS.md` asks for Storybook stories for new components, in `web/storybook/stories/entity-ui/`. Ask the owner before starting or building Storybook.

### D10. Self-hosted behavior

- In both directions, the catalog file is in the API image. The catalog lists with no outbound request from the API.
- Logos are loaded by the person's browser from the vendors' hosts. Where the browser has no internet access, the logos do not load and each row shows the default mark; everything else works. A self-hoster that sets its own Content-Security-Policy must allow `https:` in `img-src`, or the rows show the default mark.
- Connecting a server needs outbound access to that vendor, as for a server added by URL today. The gateway's egress rules apply (`AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED`, `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST` in `api/oss/src/utils/env.py`).
- `AGENTA_MCP_GATEWAY_ENABLED=false` turns the catalog routes off with the rest of the plane. The web reads `NEXT_PUBLIC_AGENTA_MCP_GATEWAY_ENABLED` (`agenta-shared/src/api/env.ts:155-156`) and hides the settings tab (`web/mobile/src/features/settings/settingsTabs.ts`).
- OSS and EE get the same catalog. The routes are in `api/oss`.
- There is no switch to hide the catalog while the gateway is on (owner decision 9).

### D11. Security

- **Trust.** An entry is trusted only because a pull request review added it. The registry adds no trust: a registry name is an input to the review. The repository has no `CODEOWNERS` file, and this change adds none: every pull request is reviewed (owner decision 10).
- **Validate once.** The catalog file is parsed at load and in CI, with the endpoint validators for each auth option (D1). Inside the API, `MCPCatalogEntry` is trusted. A `ValidationError` in `apply_entry` is a bug (`500`).
- **No exemption from the SSRF guard.** A catalog URL goes through `_guard_custom_endpoint_url` at create (on the final URL) and at probe, and through `open_egress` on every call, like a custom URL. The catalog adds no host to `exempt_hosts`. An operator's `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST` exempts its hosts for catalog URLs exactly as for custom URLs: `exempt_hosts` reads `env.mcp_gateway.host_allowlist` (`core/gateways/egress.py:108`, `:126`), and both `validate_egress_url_format` (`egress.py:373`) and `open_egress` (`egress.py:285`) skip the guard for a host in that set. The catalog adds no host itself.
- **Rules at load.** The load rules of D1: `https` only for the connection URL and `help_url`; no user info in a URL; no IP literal as host; the same three rules and a limit of 2048 characters for a `logo_url`; the endpoint validators for each auth option. Direction B adds the registry rules of D4 (`streamable-http` only, `connection.url` is one of the remotes, the accepted schemas, the `io.github.*` rule). The union shapes of D1 make a key in the URL with OAuth, and an `api_key` option with no binding, impossible to write.
- **No credentials in entries.** An entry holds no key, no client secret and no token.
- **The key stays out of URLs.** Catalog code never builds, stores, logs or returns a URL with the key filled in. A `templated_url` row stores the template with `{secret}`, and only the relay fills it, at send time (`providers/http/adapter.py:77`). The address notice compares templates.
- **The server sets the address.** With `catalog_entry_key`, the server takes the URL and the binding from the entry, not from the request.
- **Text, links and logos.** The UI shows `title` and `description` as plain text. The entry's description is never copied to a row. It reaches a model on one path only: `discover_mcp_catalog` returns it to the builder. The description is reviewed text: plain text of at most 500 characters (D1), which a pull request reviewed. In Direction B the publisher writes it, but the sync script copies it into `catalog.json`, and a person reads the diff and opens the pull request before a release (D4). No description reaches a model at run time from the registry. A `help_url` renders only with the `https:` scheme and with `rel="noopener noreferrer"`. A logo is shown only through `AppLogo`, or through `IntegrationTile` on the chat card (D13.3). Both render an `<img>` element.
- **Logos.** A `logo_url` is reviewed in the pull request that adds or changes it, as every field of an entry is. The registry's icon address is allowed in one form only: as a reviewed `logo_url` in `catalog.json`. The API never fetches a logo. The person's browser loads the image from the vendor's host, with `referrerPolicy="no-referrer"`, so the vendor's host sees a request for the image and no address of the page. An `<img>` element runs no script in an SVG. A vendor that changes or removes the image changes what the row shows, and nothing else: the row then shows the new image or the default mark.
- **Agents.** An agent supplies an entry key only. It gets the entry's reviewed title and description, and no URL and no secret. It has no op that creates a server. A person makes the create in the browser, and the server applies the entry (D13.7).
- **What "tested" means.** A person connected the server and listed its tools on `tested_at`. It does not mean the vendor's tools or tool descriptions are safe. They stay untrusted input, as for any MCP server.
- **Direction B.** A person runs the sync script on a maintainer's machine. It writes `catalog.json` only, from the validated model, and has no access to a deployment. The person reads the diff and opens the pull request. The weekly drift check runs the script in check mode with `contents: read` and no secret, so it can change nothing in the repository.

Test checklist for an entry (in `CONTRIBUTING.md`): the URL is in the vendor's own documentation; the probe reports the expected `auth.mode`; a connection is made with each auth option; `tools/list` answers through the gateway; a person's own sign-in works for an OAuth entry; an entry whose server offers write or admin OAuth scopes names its `default_scopes`, so the scope screen does not check every scope; the `logo_url` loads in a browser and shows the vendor's logo; `tested_at` is updated. `CONTRIBUTING.md` also says: do not make cosmetic URL changes (D9). The monthly re-test runs the whole checklist, so it finds a logo that no longer loads.

### D12. Comparison of the directions

The table states trade-offs. It does not choose.

| Criterion | A, internal | B, registry at build time |
| --- | --- | --- |
| Quality of the description data | As good as the person who writes it. | Written by the publisher; we review each change. |
| Coverage | Any server. | `registry` entries for what the registry lists, `internal` entries for the others. A search on 2026-11-22 found no vendor entry for Slack, HubSpot, Asana or Intercom. |
| Our own fields | In the entry in the catalog file. | In the entry in the catalog file. |
| What is stored | Entries in the catalog file; connected rows in the database. | The same; the registry's `server` data is committed in the entries of the catalog file. |
| Upkeep | A person must notice a changed URL. | A weekly drift check fails when the registry changes one of our entries. The person then runs the sync script; its diff shows the upstream changes, and the person tests them. |
| Self-hosted, no internet | Works. | Works. |
| Failure modes | A stale entry until someone checks. | Registry down or reset: the script fails or reports, with no user effect. A preview API change breaks the script, not the product. |
| New entry or changed URL | A release. | A release. |
| Effort | The format, the service, the hand-written entries. | The same, plus the sync script, the drift check job, and their upkeep. |
| Switching later | To B: add the script; change `origin` on entries in the catalog file. | To A: remove the script; write `title` and `description` into the entries in the catalog file and remove `server`. |

### D13. Agent discovery and connect

The builder agent finds a catalog entry, asks the person to connect it, gets the new server's slug back, and adds the server to the agent it builds. It uses the loop that `request_connection` has today. D13 is the same for Direction A and Direction B: the agent and the card read `MCPCatalogEntry` only, and never the catalog file or the registry.

```text
builder                          API                              browser
  | discover_mcp_catalog          |                                 |
  |------------------------------>| entries + the project's servers |
  | request_connection            |                                 |
  |  target {plane: mcp,          |                                 |
  |   catalog_entry_key}          |------- parked client tool ----->| dock card
  |                               |                                 | Connect -> McpConnectJourney (catalog mode)
  |                               |<-- POST /gateways/mcps/endpoints/ with catalog_entry_key (D7)
  |<------- tool result {connected, target, slug, name} ------------| answer, run resumes
  | edit_agent_config / create_agent: add_item to mcps              |
```

#### D13.1 Discover: one new platform op, `discover_mcp_catalog`

A new op and a new route. The op is not folded into `discover_tools`.

| Layer | Name |
| --- | --- |
| Platform op | `discover_mcp_catalog` in `PLATFORM_OPS` (`op_catalog.py:2101`), endpoint mode, `read_only=True`, input `_EMPTY_INPUT_SCHEMA` (`op_catalog.py:1548`) |
| Route | `POST /gateways/mcps/catalog/discover`, operation id `discover_mcp_catalog_entries`, on `MCPCatalogRouter` (D6) |
| Permission | `VIEW_MCP_ENDPOINTS` |
| Answer | `MCPCatalogDiscoveryResponse {count, can_connect, entries}` |

The op is named for what it lists, the catalog. Each entry holds the project's rows in `servers`.

Reasons not to fold it into `discover_tools`:

- `discover_tools` is a Composio semantic search. It takes `use_cases` and a `provider`, calls the provider's search, and returns one tool with an input schema for each use case (`core/tools/service.py:1171-1194`). A catalog entry has no tools before a person connects it, and the catalog has no semantic search.
- Its description tells the agent to commit one `gateway_connection` tool entry for each integration (`op_catalog.py:511-522`). A catalog server is an `mcps` item. One result with both kinds invites the wrong entry.
- Composio stays separate (owner decisions 6 and 14). A fold makes `ToolsService` depend on the MCP gateway and the catalog.
- `discover_tools` needs a tool provider. The catalog must be found on a deployment that has none.

Reasons for a new route, and not the list route of D6:

- The list answer holds fields that a model must not get or does not need: the server URL, the bindings, the help links and the logo address.
- The agent needs the state of each entry for this project, so that it asks for nothing that exists. The list answer is the same for every project (D6).
- The route is `POST` with an empty body, as `list_connections` is (`op_catalog.py:2333-2343`). A later search field is then an additive change. The name follows `POST /tools/discover` and `POST /triggers/discover`.

The answer:

```json
{
  "count": 2,
  "can_connect": true,
  "entries": [
    {
      "key": "linear",
      "title": "Linear",
      "description": "Find and manage issues, projects, and documents in your Linear workspace.",
      "categories": ["project_management"],
      "needs_own_oauth_app": false,
      "servers": [{"slug": "linear-3f2a9c1b7d20", "name": "Linear", "state": "ready"}]
    },
    {
      "key": "github",
      "title": "GitHub",
      "description": "Work with repositories, issues and pull requests on GitHub.",
      "categories": ["developer_tools"],
      "needs_own_oauth_app": true,
      "servers": []
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `entries` | Every entry of the catalog, sorted by `title`. No search and no `Windowing` in version 1 (D6). Each entry is at most about 200 tokens, most of it the description. |
| `key`, `title`, `description`, `categories` | From `MCPCatalogEntry`. The description is the reviewed text of D1, under the rule of D11. The agent reads it to find the entry that the person means. |
| `needs_own_oauth_app` | True when the entry's `oauth` option has `needs_own_app` true. At the level of an entry the name says which app, because the entry has no `oauth` option around it. Such a server is harder to connect: the person must register an OAuth app first. The builder says so in the plan, before it asks. |
| `servers` | The project's active `custom` rows whose `catalog_entry_key` is this key: `slug`, `name`, `state`. Sorted by `slug`. A row with `flags.is_active` false is left out, as in `bindings.py:175-183`. |
| `servers[].state` | A `GatewayConnectionState` (`core/gateways/dtos.py:456-461`): `ready`, `needs_auth` or `needs_input`. `ready` comes from the one state rule below. A row that is not ready is `needs_auth` for the mode `oauth` and `needs_input` for the mode `api_key`, the split that the web makes (`connectionState.ts:15-22`). The builder reads two cases only: `ready`, and anything else, which means "this server needs a sign-in or a key" (D13.5). |
| `can_connect` | True when the caller has `EDIT_MCP_ENDPOINTS`. The agent then knows, before it asks, that this person cannot add a server. |

The answer holds no logo, no auth mode, no `help_url`, and nothing that D11 keeps from a model. The agent does not pick the auth mode; the person does, in the connect flow. The answer is the same for an `internal` entry and a `registry` entry.

**One state rule.** "Is this `custom` row ready" has two copies today: `MCPGatewayService._connection_state` (`core/gateways/mcps/service.py:763-769`) and `_mcp_ready` (`api/oss/src/core/agent_requirements/service.py:107-111`), whose docstring says that it copies the first. The rule moves to one pure function in `core/gateways/mcps/`: a row is ready when its mode is `none`, or when it has a `secret_id` and `flags.is_valid`. Three callers use it: `_connection_state`, `_mcp_ready` and the discovery. None of the first two changes what it returns.

Types: `MCPCatalogDiscoveredEntry`, `MCPCatalogDiscoveredServer` and `MCPCatalogDiscovery` in `core/gateways/mcps/catalog/dtos.py`. The join is one pure function, `discover_entries(*, entries, endpoints) -> List[MCPCatalogDiscoveredEntry]`, in `core/gateways/mcps/catalog/discovery.py`, as the pure functions of `core/tools/discovery.py` are. The route handler reads `MCPCatalogService.list_entries()` and `MCPGatewayService.query_endpoints(project_id=...)` (`service.py:566`), checks `EDIT_MCP_ENDPOINTS` for `can_connect`, and calls the function. `MCPCatalogRouter` holds both services (D6). With an empty catalog the answer is `{"count": 0, "can_connect": ..., "entries": []}`.

The op's description (SDK-owned, in `op_catalog.py`):

> List the entries of Agenta's MCP catalog, with this project's MCP servers for each entry. Use it only when the person asks for an MCP server. It does not replace `discover_tools`: a connected app and an MCP server are different things, and you never use one in place of the other. A server in the state `ready` needs no request: add it to the agent with its `slug`. A server in any other state needs a sign-in or a key: ask the person with `request_connection` and `target: {plane: "mcp", name: <the server's slug>}`. For an entry with no server, ask with `target: {plane: "mcp", catalog_entry_key: <key>}`. Never invent a key or a slug. When `can_connect` is false, the person cannot add a server: do not ask, and say once what is missing.

A server added by URL at the same address as an entry has no `catalog_entry_key`, so it does not show under the entry. The agent can then ask for a second server. This is the same limit as the entry state in D9, which reads the key only.

#### D13.2 Ask: `request_connection` with a catalog entry

`request_connection` gets one new optional field in `target`: `catalog_entry_key`. There is no new tool.

```json
{"target": {"plane": "mcp", "catalog_entry_key": "linear"}}
```

Changes to the input schema (`static_catalog.py:152-174`):

- `target.properties.catalog_entry_key`: a string. Description: "The key of a catalog entry, from `discover_mcp_catalog`, to connect a new MCP server from the catalog. MCP plane only. Use it in place of `name`."
- `target.required` becomes `["plane"]`. The rule "give `name` or `catalog_entry_key`" goes in the descriptions, for the reason in `static_catalog.py:186-190`: some providers refuse `oneOf` and `anyOf` in a tool schema.
- `target.additionalProperties` stays `false`.
- The tool description gets one sentence: "To connect a server from the MCP catalog, send `target` with `plane: "mcp"` and `catalog_entry_key`. The result holds the new server's `slug`."
- The description of `target.name` says that on the MCP plane it is the slug of a server that exists.

The field name is `catalog_entry_key`, the same as on the create body (D7), by the "Catalog keys" convention: `<thing>_key` outside the catalog.

**One classifier.** Validation is in the browser, because the API never runs a client tool. One pure function in `@agenta/shared/clientTools`, `connectRequestKind(input)`, puts every `request_connection` call in one of three kinds. The transcript and the dock both read it, so a call has one kind everywhere:

| Kind | When | Transcript row | Dock card |
| --- | --- | --- | --- |
| `catalog_entry` | the call has a `target` object, `target.plane` is `mcp`, and `target.catalog_entry_key` is present | `McpCatalogConnectToolWidget` | the catalog card (D13.3) |
| `named_target` | the call has a `target` object and is not a `catalog_entry` call | `GatewayConnectToolWidget` | the named-target card (D13.3) |
| `integration` | the call has no `target` object | `ConnectToolWidget` | the integration card, as today |

The rules that follow from the table:

- **A call with a `target` object is never an `integration` call.** Today a `target` that `parseGatewayTarget` refuses falls to the integration surface with an empty key (`registry.tsx:39-43`), and that card can start a Composio connect for nothing. The agent meant a target, so the call gets a target surface.
- **A `catalog_entry_key` of a wrong form is still a `catalog_entry` call.** The key pattern of D1 is `^[a-z0-9][a-z0-9-]*$`. `parseCatalogConnectTarget(input)` returns `{plane: "mcp", catalogEntryKey}` only for a key that matches, branded as `McpCatalogEntryKey`, and `null` otherwise. With `null` the card makes no request and shows the not-in-catalog state (D13.3 step 7). A key of a wrong form never reaches the fetch route.
- **A call with both `name` and `catalog_entry_key` on the MCP plane is a `catalog_entry` call.** The agent asks for a new server from the entry.
- **A `named_target` call with no usable `name`** (no `name`, an empty `name`, or a `plane` that is not `llm` or `mcp`) gets a card with the message "This request names no server." and one button, "Not now". There is nothing to connect.
- A call with `plane: "llm"` and a `catalog_entry_key` is a `named_target` call. The catalog is on the MCP plane only.
- `ConnectRequestWidget` (`registry.tsx:39-43`) picks its widget from the kind.

**Every kind shows in the dock.** `isConnectInteraction` (`connectInteractions.ts:17-18`) does not change: it selects every `request_connection` call. A `named_target` call must not leave the dock:

- On `/m` its transcript row is inside the activity fold, which is closed by default and `inert` while closed ("What exists today", "Agent, the activity fold"). The buttons of `GatewayConnectToolWidget` (`GatewayConnectToolWidget.tsx:139-155`) are then out of reach.
- A message that the person types declines a parked call only through an open dock (`steerOverDocks`). With no dock the message waits, and the run stays parked.

So the dock gets a card for a `named_target` call, in place of the integration card with an empty key that such a call gets today (`ConnectionDock.tsx:193`, `:423`, `:494`). D13.3 specifies it.

`declinedConnectOutput(input)` (`agenta-shared/src/clientTools/index.ts:133-137`) returns the decline of the call's kind: the integration shape of today; the target shape for a `named_target` call (`{connected: false, target, reason: "declined"}`, as `gatewayDeclinedOutput`, `useGatewayConnectFlow.ts:41-45`); and the catalog shape for a `catalog_entry` call. So a message over the dock declines each call in its own shape.

The functions are in `@agenta/shared`, because `@agenta/chat` and `@agenta/entity-ui` both need them and `@agenta/entity-ui` must not import `@agenta/chat` (`registry.tsx:12-20`).

The tool result of a catalog request (D13.4 has every state):

```json
{
  "connected": true,
  "target": {"plane": "mcp", "catalog_entry_key": "linear"},
  "slug": "linear-3f2a9c1b7d20",
  "name": "Linear"
}
```

`slug` is what the agent commits. It is at the top level, as in the integration result (`ConnectOutput.slug`, `agenta-shared/src/clientTools/index.ts:106-115`), so the builder's rule is the same for both: "the `slug` from the result". The slug does not exist before the create (`derive_endpoint_slug`, `service.py:211-234`), so the result must carry it. A `named_target` result holds no slug, because the agent already named the server.

#### D13.3 The first UI flow, step by step

Two components show one request, as for an integration request today: a row in the transcript and a card in the connect dock. The card owns the buttons. The row owns the surface that the buttons open, because the row stays mounted and the dock does not (step 4).

**1. The call parks.** The runner streams the tool call with `render.kind` `connect`. The turn pauses.

**2. The transcript row.** `ConnectRequestWidget` renders a new widget, `McpCatalogConnectToolWidget` (`agenta-entity-ui/src/clientTools/`). While the call is parked, the row shows the entry's logo and "Connect Linear below", which brings the card to the front of the dock (`useConnectFocus`), as `ConnectToolWidget` does (`ConnectToolWidget.tsx:148-171`). The row has no button of its own. It mounts the journey modal when the card asks (step 4). After the call settles, the row shows the result (step 8).

**3. The dock card.** The call shows in the connect dock (`ConnectionDock`), with the other parked connects. The card reads one thing: the entry, with the fetch query by key (D9, `mcpCatalogEntry/state/atoms.ts`), which never loads the list. It does not read the project's servers. The builder already has their state from `discover_mcp_catalog`, and it asks for a catalog entry only when the entry has no server (D13.5). The card shows:

| Part | Content | Source |
| --- | --- | --- |
| Logo | The entry's `logo_url`, through `IntegrationTile`, which renders an `<img>` and falls back to initials when there is no address or the image does not load (`IntegrationTile.tsx:57-66`) | `entry.logo_url` |
| Header | "The agent is waiting for you" (`chat.connectionDock.agentWaiting`), and the progress dots | as today |
| Title | The entry's `title`, plain text | `entry.title` |
| Description | The entry's `description`, plain text, at most two lines | `entry.description` |
| Auth hint | One line from the auth mode of the first auth option: "Sign in with your account" for `oauth`, "Needs an API key" for `api_key`, nothing for `none`. A `templated_url` entry has the mode `api_key`, so its hint is "Needs an API key". | `entry.connection` |
| Own app | "Needs your own OAuth app", when the `oauth` option has `needs_own_app` true | `entry.connection` |
| Actions | "Not now" and "Connect" | |
| Permission notice | "You do not have permission to add this server. Ask a project admin.", when the person cannot add a server | `canEditMcpEndpoints` |

The texts are new keys in `chat.connectionDock` and `entityUi.clientTools`, for each supported language.

The dock reads `connectRequestKind(meta.input)` (D13.2) in three places:

- The identity of a card (`ConnectionDock.tsx:193`, `:366`, `:423`): a new hook `useConnectRequestIdentity(meta)` in `@agenta/entity-ui/clientTools` gives `{label, logo}`: from the entry for a `catalog_entry` call, the target's `name` for a `named_target` call (as `gatewayTargetLabel`, `useGatewayConnectFlow.ts:34`), and `useIntegrationIdentity` for an integration.
- The body of the front card (`ConnectionDock.tsx:459-592`): `ConnectBody` renders one of three bodies: today's integration body, a new `McpCatalogConnectBody`, or a new `NamedTargetConnectBody`.
- The dismiss output (`useConnectionDock.ts:147-153`): `declinedConnectOutput` returns the decline of the call's kind.

**The named-target card.** `NamedTargetConnectBody` shows the target's `name`, the prompt text of the row (`entityUi.clientTools.connectLabelMcpServer` or `connectLabelModelProvider`, `GatewayConnectToolWidget.tsx:141-144`), "Not now" and "Connect". "Connect" asks the row to open its surface (step 4), and the row runs the `runConnect` that it has today (`useGatewayConnectFlow.ts:166-177`): the provider drawer, the reconnect of a server that exists, or the tool catalog drawer. There is one open path, in the row. "Not now" settles the call with the target-shaped decline. The row keeps its own two buttons, for a person who opens the fold. The builder uses this card for a server that needs a sign-in or a key (D13.5).

**Permission.** The catalog card follows the practice of the secret dock. For a secret, the host reads `useProjectPermission(projectId, "edit_secret")` and passes `canEditSecrets` to the dock (`web/mobile/src/features/chat/LiveConversation.tsx:304`, `:1105`). Without the permission the dock says "You do not have permission to add this secret. Ask a project admin." and turns the action off (`agenta-entity-ui/src/clientTools/SecretRequestDock.tsx:380-383`, `:580-581`). For a catalog request:

- The host, `web/mobile/src/features/chat/LiveConversation.tsx`, reads `useProjectPermission(projectId, "edit_mcp_endpoints")`, as Settings does (`web/mobile/src/features/settings/McpServersTab.tsx:12`), and passes `canEditMcpEndpoints` to `ConnectionDock` (`LiveConversation.tsx:1127-1131`). The dock passes it to `McpCatalogConnectBody`. The prop is optional and its default is `false`, as `canEditSecrets` is (`SecretRequestDock.tsx:85`).
- Without the permission, "Connect" is turned off, and the card shows the permission notice.
- "Not now" still works and settles `declined`.

**Keyboard.** The integration body binds Cmd or Ctrl with Enter to its primary action and Escape to its back action, with guards for an open overlay and for typing (`ConnectionDock.tsx:501-531`). That effect moves to one hook in `@agenta/chat`, `useDockCardShortcuts({onCommit, onBack, busy, enabled})`. The three bodies call it, so every card answers the same keys by the same rules. On a catalog card and on a named-target card, Enter with the modifier presses "Connect", and Escape presses "Not now". `busy` is true while the row's surface is open. Enter does nothing while "Connect" is turned off or not offered.

**4. The person presses "Connect".** The card does not mount the journey. It writes the call's `toolCallId` to one atom in `@agenta/entity-ui/clientTools`, `connectRequestOpenAtom`. The transcript row of that call reads the atom. A catalog row mounts `McpConnectJourney` in catalog mode; a named-target row runs its `runConnect`. A shared atom is how widgets of this package already share one surface (`toolCatalogDrawerOpenAtom`, `useGatewayConnectFlow.ts:111`). The atom holds one id, so one surface is open at a time. The row clears the atom when the surface closes.

The journey is in the row because of what each component lives through:

- The host unmounts the dock when the run is stopped or the conversation is locked: the dock is enabled only with `parkedDocks && !locked`, and it renders only while `connects.open` (`LiveConversation.tsx:853-858`, `:1124`).
- A journey that unmounts does not delete its pending row. The unmount effect calls `abandonAttempt` (`McpConnectJourney.tsx:576`), which stops the consent watch and cancels the attempt (`useMcpConnectJourney.ts:292-296`). Only `cancel`, which the close button calls, deletes the row (`useMcpConnectJourney.ts:1149-1164`).
- So a journey inside the dock card leaves a pending row behind when the run stops with the journey open. The transcript row stays mounted in both cases, also inside a closed activity fold, and `GatewayConnectToolWidget` mounts its journey from the transcript row for the same reason (`GatewayConnectToolWidget.tsx:87-92`). The modal is drawn outside the fold, so a closed fold does not hide it.

When the run stops with the journey open, the dock closes and the journey stays. The person finishes the connection or closes the journey. Closing runs `cancel`, and the pending row is deleted.

**A late answer is not sent.** The answer of a client tool goes to the server, which owns the interaction ("What exists today", "Agent, the answer and the resume"). When the person finishes the journey after the run was stopped, the interaction is over, and a new execution can already be live. An answer sent then can be refused as an interaction of another execution, and that refusal is stamped on the conversation as a run error (`useAgentConversation.ts:985-1000`). So the row's hook sends an answer only while its call is still the parked interaction of the live execution. It reads that from `useConnectFocus(meta.toolCallId)`, which gives a value only while the dock holds this call (`agenta-entity-ui/src/clientTools/connectFocus.ts`). With no value, the hook sends nothing: a finished connection leaves a connected server, the row shows "Linear connected", and the builder finds the server with `discover_mcp_catalog` on its next turn. The same rule covers a journey that is closed late.

`McpConnectJourney` is the modal that the chat already opens for a reconnect (`GatewayConnectToolWidget.tsx:87-92`, `agenta-chat/src/components/McpServerNoticeCard.tsx:78-87`). The chat has no view stack, so it does not use `mcpConnectView`. The modal and the view render the same screens, through `useMcpConnectScreens`.

- `McpConnectJourneyProps` (`McpConnectJourney.tsx:95-106`) gets one optional prop, `catalogEntryKey?: McpCatalogEntryKey`. It cannot be set with `reconnect`: the props become a union of the three starts, as the view parameters do in D9.
- The steps before the journey are the same as in `McpConnectViewBody.tsx` (D7 steps 2 and 3). The modal calls `useMcpCatalogStart(catalogEntryKey)` (D9), shows a loading state until the hook is ready, and then mounts the journey body with `{kind: "catalog", entry}` and the loaded names.
- From here the flow is D7: the URL is read-only; a `fixed_url` entry is probed at once; a `templated_url` entry goes to the name screen.

A new hook in the row, `useMcpCatalogConnectFlow(target, meta, settle)`, holds the journey's open state and answers the call from the journey's two callbacks (steps 6 and 7), under the rule above. `settle` is the row's own settle prop (`ClientToolWidgetProps.settle`), which is a no-op once the call is settled.

**5. Configuration, inside the journey.** These are the screens of today, with the catalog rules of D7 and D9:

| Step | What the person does |
| --- | --- |
| Name | The name starts as a free name from the entry's title. The person can change it. A taken name comes back to this screen with the refusal (D7 step 3). |
| Auth mode | `AuthModeSelector` shows the offered modes only: the entry's modes, minus `oauth` when the server does not offer it (D7 step 4). With one mode there is nothing to pick. |
| API key | The person picks a project secret, or adds one with `CreateSecretDrawer`. The binding fields are read-only and hold the entry's binding (D7 step 6). The person never types a key into the chat. |
| Own OAuth app | When the probe says that the server registers no clients, the OAuth screen asks for a `client_id` and a project secret, as today. The probe wins over the entry (D7 step 5). |
| OAuth scopes | The scope screen starts with the entry's `default_scopes` checked, or with every offered scope when the list is empty (D9). Then the consent window opens. |
| Verify | The journey checks the connection and goes to `connected`. |

The sign-in that this journey makes is the project's sign-in, as for every connect journey today. A person's own sign-in (`owner_kind=user`) is not a step of this journey. It stays where it is today: a member signs in to a server that exists, and an agent's `mcps` item selects it with `account_source: "user"` (`models.py:82-86`). The builder writes no `account_source` in version 1 (D13.5).

**6. The journey reports the connection.** `onConnected` gives `{id, slug, name}`. The row's hook answers the call with the connected result and clears the atom. The card leaves the dock.

**7. Cancel, decline and failure.**

| What happens | What the person sees | Result `reason` |
| --- | --- | --- |
| The person presses "Not now" on the card, or presses Escape, with or without the permission to add a server | The card leaves the dock. The row says "Not connected". | `declined` |
| The person sends a chat message over the dock | The same; the message follows (`useConnectionDock.ts:147-153`) | `declined` |
| The person closes the journey before the connection is made | The pending row is deleted, as today (`cancelDeletesEndpoint`, `connectJourney.ts:455-456`). The row says "Connection not completed". | `cancelled` |
| The check fails (`check_failed`) | The journey shows the catalog message with Retry (D7 step 4). The call stays parked while the modal is open. When the person closes the modal, the call settles. | `cancelled` |
| The create is refused: a blocked address, a catalog code (D9, "Refusals from the API"), or a permission that the person lost after the card showed | The journey shows the refusal on its create failure screen (`create_failed`). When the person closes the modal, the call settles. | `cancelled` |
| The consent window is closed or refused | The journey shows `consent_cancelled` or `consent_failed` with its retry, as today. Closing settles. | `cancelled` |
| The entry is not in the catalog: the key has a wrong form, or the fetch route answers `404` with `mcp_catalog_entry_not_found` | The card shows "This server is not in the catalog." and one button, "Not now". | `declined` |
| The fetch fails for another reason (network, an old API pod) | The card shows the load error with "Retry" and "Not now". | `declined`, when the person presses "Not now" |
| The run is stopped while the card is open | The dock closes. The row says that the request ended, as today (`isInteractionEndedOutput`). An open journey stays open (step 4). | no result |

There are two reasons, `declined` and `cancelled`. A key that is not in the catalog has no reason of its own: the builder does the same thing for every result that is not connected. No state settles on its own. Every result follows a press by the person, as for every other connect card.

"Custom server URL" is not offered in the chat modal. On the failure screens of D7 and D9 that button opens the empty by-URL flow. In the chat the agent asked for one entry, and a server added by URL has no reference and is not what the agent asked for. `McpConnectJourney` in catalog mode from the chat hides the button; the person closes the modal, and the agent continues without the server.

Closing after a failure gives `cancelled`, as the named-target flow does today (`useGatewayConnectFlow.ts:194-203`).

**A server that exists.** The catalog card does not look for one. Its "Connect" always starts a new server from the entry. Two things keep that right:

- The builder reads `discover_mcp_catalog` before it asks. It adds a `ready` server with no request, and it asks for a server that needs a sign-in or a key by the server's slug, which is a `named_target` request (D13.5).
- A project may hold more than one row from one entry (D7, "Rules for the reference").

One limit stays. Between the discover call and the card, another person can connect the same entry. The person then makes a second row for that entry, with another name. The design allows this row, and the person can remove it in Settings.

**Several requests.** The runner parks one interaction for each turn. A second `request_connection` of the same step is settled as deferred, and the agent asks for it again on its next turn (`agenta-entity-ui/src/clientTools/deferred.ts:1-7`). So the person normally sees one card at a time: the first request, and after it settles and the run resumes, the next one. A deferred catalog row shows the quiet note that `ConnectToolWidget.tsx:89-100` shows, with no action. The dock itself can hold a stack (`useConnectionDock.ts:96-139`), and cards of the three kinds can be in one stack: the dots, "N of M" and `bringForward` do not change, and only the front card has actions.

**8. The settled row.** `McpCatalogConnectToolWidget` shows one chip, in the words of the existing rows: "Linear connected" with the logo; "Not connected" for `declined`; "Connection not completed" for `cancelled`. There is no Retry on a settled catalog row in version 1: the person asks the builder, which asks again.

#### D13.4 The answer and the resume

The answer path and the resume rule do not change. No file in `@agenta/playground` changes.

1. A press on the card settles through the dock's settle (`ConnectionDock.tsx:475-492`). The host passes `connects.settle` as the dock's `onOutput` (`LiveConversation.tsx:1129`), and `connects.settle` wraps `conversation.sendToolOutput` (`LiveConversation.tsx:853-858`). A result of the journey settles through the row's settle prop, which reaches the same `sendToolOutput`.
2. `sendToolOutput` sends the answer to the server with `respondInteractionAnswer`: the session, the tool call id, and the result as `{outcome: "completed", output}` (`useAgentConversation.ts:962-1004`). The server owns the interaction and gates the resume.
3. The server can refuse the answer. A refusal that says the interaction is already settled is ignored, because the answer is already in. Any other refusal is stamped as a run error (`useAgentConversation.ts:985-1000`). The rule of D13.3 step 4 keeps a late answer from reaching this path. Task 11.16 confirms the code that the server gives for an answer to an interaction of an older execution.
4. On the client the part goes to `output-available`. The tool name is still `request_connection`, and the render kind is still `connect`, so `isClientToolResult` is true (`agentApprovalResume.ts:93-103`), and `agentShouldResumeAfterApproval` returns true when every tool part of the turn is settled (`useAgentConversation.ts:462-466`, `agentApprovalResume.ts:211`). The run continues with the result.

Every result is an `output`, never an `errorText`, as in the named-target flow (`useGatewayConnectFlow.ts:125-134`). So a decline is not an error for the model.

| State | Result |
| --- | --- |
| Connected | `{"connected": true, "target": {"plane": "mcp", "catalog_entry_key": "linear"}, "slug": "...", "name": "..."}` |
| Declined, also for an entry that is not in the catalog | `{"connected": false, "target": {...}, "reason": "declined"}` |
| Cancelled or failed | `{"connected": false, "target": {...}, "reason": "cancelled"}` |

Two pure functions in `@agenta/shared/clientTools` build these objects, beside `declinedConnectOutput` (`index.ts:133-137`): `catalogConnectedOutput(target, {slug, name})` and `catalogNotConnectedOutput(target, reason)`, where `reason` is `declined` or `cancelled`. `target` is echoed as the agent sent it, as the named-target outputs do today (`useGatewayConnectFlow.ts:36-51`). The result holds nothing that D11 keeps from a model.

#### D13.5 Add the server to the agent

The builder reads the `servers` of the entry in `discover_mcp_catalog`, and does one of three things:

| The entry has | The builder |
| --- | --- |
| a server in the state `ready` | adds that server to the agent with its `slug`. It asks for nothing. With several ready servers it takes the first, and the list is sorted by `slug`. |
| servers, and none is `ready` (`needs_auth` or `needs_input`) | asks for the first one by its slug: `request_connection` with `target: {plane: "mcp", name: <slug>}`. This is the `named_target` request that exists; its card opens the reconnect of that server (D13.3). After a connected result it adds the server with that slug. |
| no server | asks for the entry: `request_connection` with `target: {plane: "mcp", catalog_entry_key: <key>}`. After a connected result it adds the server with the `slug` from the result. |

Then it adds one item to `parameters.agent.mcps` of the agent it builds, with `create_agent` or `edit_agent_config`:

```json
{
  "operation": "add_item",
  "target": ["parameters", "agent", "mcps"],
  "value": {
    "name": "linear-3f2a9c1b7d20",
    "connection": {"type": "gateway", "namespace": "custom", "slug": "linear-3f2a9c1b7d20"}
  }
}
```

- The item is an `MCPServerConfig` (`models.py:205-226`) with an `MCPGatewayConnection` (`models.py:68-99`). A route in the namespace `custom` needs `slug` only, and no `provider` (`models.py:92-94`).
- `name` is the slug, as the template binder writes it (`bindings.py:200`). A slug has the form `<name>-<12 hex>` (`api/oss/src/utils/helpers.py:56-70`) and fits the pattern of `name` (`models.py:224`). The slug is unique in the project, so two servers of one entry do not collide in the keyed list.
- The builder writes no `policy`. The default applies. It writes no `account_source`, so the agent uses the project's sign-in.
- The builder reads the configuration back and confirms that the item is there, as for a tool entry (`builder_agent.py:326-329`).

Changes to the builder (`api/oss/src/core/workflows/builder_agent.py`):

- `BUILDER_AGENT_TOOLS` gets `"discover_mcp_catalog": "allow"` (`:26-37`).
- "Connections and secrets" (`:314-329`). The rules of today already cover an MCP server: check first, name the limit once, ask one time, build without it on a decline, never name a tool to the person. The section gets these lines:
  - "A connected app and an MCP server are different things. Never mix them, and never use one in place of the other. Use the MCP path only when the person asks for an MCP server. In every other case, use connected apps as these rules say."
  - "When the person asks for an MCP server, look in `discover_mcp_catalog`. Read each entry's title and description to find the one the person means."
  - "When the entry has a server in the state `ready`, use that server and ask for nothing. When its servers are in another state, the server needs a sign-in or a key: ask with `request_connection` and the server's slug as `target.name`. When the entry has no server, ask with `request_connection` and its `catalog_entry_key`."
  - "When no entry fits the MCP server that the person asks for, say so once. Do not ask for a connected app in its place."
  - "When the entry has `needs_own_oauth_app` true, say in the plan that the person must register an OAuth app first."
  - "For each MCP server that the agent you build uses, add one item for that server to the agent's `mcps`. This holds for a server that was connected earlier and for one that the person connects now. Use the `slug` from the result or from `discover_mcp_catalog`. Never invent the slug."
  - "When `discover_mcp_catalog` says `can_connect` is false, do not ask. Say once that a project admin must add the server."
- `_CONFIG_FIELDS_PREFACE` (`:413-428`) gets one block beside "A connected app is one tool entry": "**An MCP server is one `mcps` item.** `{ "name": "<the server slug>", "connection": { "type": "gateway", "namespace": "custom", "slug": "<the slug from the result of request_connection or from discover_mcp_catalog>" } }`. Never invent the slug. Then read the configuration back and confirm that the item is there."
- The builder's `references/config-fields.md` is the preface plus the SDK field reference (`builder_agent.py:733-734`). The SDK field reference describes only the HTTP shape of an `mcps` item today (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:199-203`). Its `### mcps` section gets the gateway shape: "For an MCP server of the project, `connection` is `{ "type": "gateway", "namespace": "custom", "slug": "<the server slug>" }`, with no `url`, no `headers` and no `credentials`." The preface and the section then agree.
- "Which tool for which job" (`:675-685`) gets: "Which MCP servers exist or can be added, when the person asks for an MCP server: `discover_mcp_catalog`."
- "Create an agent", step 1 (`:696-700`), keeps `discover_tools` for the tools, and adds: when the person asks for an MCP server, find it with `discover_mcp_catalog`.

The builder's own `"mcps": []` (`:866`) does not change. The builder adds the server to the agent it builds, not to itself.

**Two catalogs, one app.** An app can be in the Composio catalog and in the MCP catalog. A Composio integration gives tools through a `gateway_connection` tool entry. A catalog server is an MCP server in `mcps`. They are different things (owner decisions 6 and 14), and the builder does not choose between them:

- The person asks for an MCP server ("add the Linear MCP server", "use an MCP server for GitHub"): the builder uses the MCP catalog, and only the MCP catalog.
- In every other case the integration path of today stays as it is: `list_connections`, `discover_tools`, and `request_connection` with `integration`.
- The builder never offers one as a fallback for the other. When the MCP catalog has no entry for the server that the person asks for, the builder says so and does not ask for a Composio integration in its place. When a Composio connection fails or is declined, the builder does not ask for an MCP server in its place.
- A connection of one kind is not a reason to skip the other kind. When the person asks for the Linear MCP server and the project has a Composio connection for Linear, the builder still uses the MCP catalog.

#### D13.6 Other agents

Version 1 gives `discover_mcp_catalog` to the builder only.

- The op is in `PLATFORM_OPS`, but not in `DEFAULT_BUILD_KIT_OPS` (`api/oss/src/core/workflows/build_kit.py:35-62`). An agent in the playground, and a runtime agent, do not get it.
- `request_connection` is one static tool, embedded in every build kit (`build_kit.py:68-72`). So the field `catalog_entry_key` is in the schema that every such agent sees, and the web handles a catalog request from any agent. An agent without the discover op has no keys to send; for a key that it invents, the card says that the server is not in the catalog.
- A runtime agent that was refused for an MCP server that exists still uses `target.name`, as today. Its request now has a card in the dock (D13.2).
- The runner's prompt hint for `request_connection` tells the model to send `target: {plane, name}` (`services/runner/src/extensions/agenta.ts:304-308`). It gets one clause: "for a server from the MCP catalog, send `catalog_entry_key` and no `name`". Without it, the hint and the tool description disagree, and a model follows the hint. The hint is prompt text, not a field of the `/run` wire contract, so the mirror rule of `services/runner/AGENTS.md` ("The wire contract is mirrored") does not apply: `protocol.ts`, `wire.py` and the golden fixtures do not change. The runner test of the hint changes (`services/runner/tests/unit/extension-tools.test.ts:822`).

Reason: the build kit can already change its own agent. It has `read_config` and `commit_revision` (`build_kit.py:41-42`), so a playground agent could add the server to itself. What it lacks is the text: no skill of the build kit tells the model when to look for an MCP server, how to keep the two catalogs apart, or what an `mcps` item is. The build kit keeps an op only when a skill says when to use it (`build_kit.py:33-34`). Those rules are written for the builder first (D13.5), and the builder is where a person asks for a new app. The build kit follows when the rules have worked there.

#### D13.7 Security and permissions

D11 holds the rules for what a model gets: the reviewed title and description of an entry, and no URL and no secret. D13.7 adds what is specific to the agent path.

- **Who can create.** The create is the route of D7, with `EDIT_MCP_ENDPOINTS`. The browser makes the request as the person. The agent makes no create request and has no op that creates a server.
- **A person without the permission.** There are two guards before the API's own check. First, `discover_mcp_catalog` needs `VIEW_MCP_ENDPOINTS` and returns `can_connect: false`, so the builder does not ask. Second, if an agent asks anyway, the card reads `canEditMcpEndpoints` from the host and turns "Connect" off, with the notice "You do not have permission to add this server. Ask a project admin." (D13.3, "Permission"). "Not now" settles `declined`. The builder can still add a `ready` server to an agent, because that creates no server: it reads the project's servers with `VIEW_MCP_ENDPOINTS`, and it writes the agent with `create_agent` or `edit_agent_config`, which have their own permission. Running the server's tools needs `USE_MCP_ENDPOINTS`, as today. The API still checks `EDIT_MCP_ENDPOINTS` on every create; the card is not the guard.
- **A person without `VIEW_MCP_ENDPOINTS`.** The op answers `403`. The builder continues without the catalog.
- **What the agent gets.** The discover answer holds a key, a title, a description, categories, `needs_own_oauth_app`, and for each server a slug, a name and a state. The tool result holds the target, a slug and a name. The person picks or adds a secret in the journey, never in the chat.
- **The server still applies the entry.** The agent supplies a key only. The browser sends the create with `catalog_entry_key`, and `MCPCatalogService.apply` sets the URL and the binding from the entry before the egress guard (D7 step 7). An agent cannot make the person connect to an address that is not in the catalog through this path.
- **A person confirms.** No server is created without a press on "Connect". `create_agent` and `edit_agent_config` keep the permission `ask` (`builder_agent.py:29-30`), so a person also confirms each server that the builder adds to an agent.
- **Text from the project.** `servers[].name` and the result's `name` are the display name of a row, which a project member with `EDIT_MCP_ENDPOINTS` typed. This text reaches the builder model. It has the trust level of the connection names and slugs that `list_connections` gives the builder today: text from a member of the same project, not from a vendor or a publisher.
- **The gateway switch.** With `AGENTA_MCP_GATEWAY_ENABLED=false` the discover route is off with the plane (D10). The op then fails, and the builder continues without the catalog.

#### D13.8 Mixed versions

| Case | Behavior |
| --- | --- |
| New API, old web | The old `parseGatewayTarget` needs `name`, so a catalog request goes to the integration surface with an empty key (`registry.tsx:39-43`). "Not now" settles it as a decline, and the builder builds without the server. The API and the web normally ship together. |
| New web, old API | The old tool schema has no `catalog_entry_key`, and the builder has no discover op. No catalog request is made. |
| Old pod answers the discover route | `404`. The op fails, and the builder continues without the catalog. |
| New API, old agent service | The builder's tool list names `discover_mcp_catalog`, and the SDK in the old service image has no such op. `get_platform_op` raises `UnknownPlatformOpError` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:2406-2411`, called for each tool in `platform_tools.py:83`), so every builder turn fails. The release order below prevents this case. |
| Old runner, new API | The prompt hint has no catalog clause. The tool description still carries the rule. |

**Release order.** The builder's tool list is API data, and the op is SDK code that the agent service runs. So the op ships first:

1. Ship the SDK with the op `discover_mcp_catalog` and the `### mcps` text (task 11.5), and the service image that holds that SDK.
2. Then ship the API change that adds the op to `BUILDER_AGENT_TOOLS` and the builder's rules (task 11.7).

The two steps are two releases, or one release in which the service rolls out before the API. A rollback goes in the reverse order.

## First list (a proposal for the team to edit)

This list is a proposal. Nothing in it is decided. "Registry name" is what `GET /v0.1/servers` returned on 2026-11-22; "not found" means a search found no entry in a vendor namespace, not that none exists. "Answered 401" means the URL refused an anonymous MCP `initialize` on that date, so something is there and wants auth. Every auth cell marked "verify" is from memory or from a code comment and was not tested. Each entry must pass the test checklist before it ships.

| Key | Vendor | Server URL | Registry name (version) | Auth kind | URL check |
| --- | --- | --- | --- | --- | --- |
| `github` | GitHub | `https://api.githubcopilot.com/mcp/` | `io.github.github/github-mcp-server` (2.2.0) | OAuth, `needs_own_app` true: GitHub has no dynamic client registration (`core/gateways/mcps/dtos.py:172-174` names GitHub); API key as `Authorization: Bearer` (verify) | registry; answered 401 |
| `linear` | Linear | `https://mcp.linear.app/mcp` | `app.linear/linear` (1.0.2) | OAuth (verify); API key as `Authorization: Bearer` | registry; answered 401 |
| `notion` | Notion | `https://mcp.notion.com/mcp` | `com.notion/mcp` (1.0.1) | OAuth (verify) | registry |
| `atlassian` | Atlassian (Jira, Confluence) | `https://mcp.atlassian.com/v2/mcp` | `com.atlassian/atlassian-mcp-server` (2.0.0) | OAuth (verify) | registry; it also lists `/v1/mcp/authv2`; verify which one |
| `sentry` | Sentry | `https://mcp.sentry.dev/mcp` | `io.github.getsentry/sentry-mcp` (0.50.0) | OAuth (verify) | registry; answered 401 |
| `stripe` | Stripe | `https://mcp.stripe.com` | `com.stripe/mcp` (0.2.4) | OAuth; API key as `Authorization: Bearer` (verify both) | registry |
| `figma` | Figma | `https://mcp.figma.com/mcp` | `com.figma.mcp/mcp` (1.0.3) | OAuth; it may accept only approved clients (verify) | registry |
| `vercel` | Vercel | `https://mcp.vercel.com` | `com.vercel/vercel-mcp` (0.0.3) | OAuth; it may accept only approved clients (verify) | registry; answered 401 |
| `supabase` | Supabase | `https://mcp.supabase.com/mcp` | `com.supabase/mcp` (0.19.0) | OAuth (verify) | registry |
| `neon` | Neon | `https://mcp.neon.tech/mcp` | `com.neon/mcp` (2.0.0) | OAuth; API key (verify both) | registry |
| `posthog` | PostHog | `https://mcp.posthog.com/mcp` | `com.posthog/mcp` (1.0.0) | API key as `Authorization: Bearer`; OAuth (verify both) | registry |
| `monday` | monday.com | `https://mcp.monday.com/mcp` | `com.monday/monday.com` (0.0.1) | OAuth (verify) | registry |
| `canva` | Canva | `https://mcp.canva.com/mcp` | `com.canva.mcp/mcp` (1.0.0) | OAuth (verify) | registry |
| `paypal` | PayPal | `https://mcp.paypal.com/mcp` | `com.paypal.mcp/mcp` (1.0.0) | OAuth (verify) | registry |
| `cloudflare-docs` | Cloudflare | `https://docs.mcp.cloudflare.com/mcp` | `com.cloudflare.mcp/mcp` (1.0.0), one of 15 Streamable HTTP remotes | None (verify) | registry; the team picks which remotes become cards |
| `slack` | Slack | `https://mcp.slack.com/mcp` | not found | OAuth, `needs_own_app` true: Slack needs a pre-registered app | answered 401; URL in vendor documentation |
| `hubspot` | HubSpot | `https://mcp.hubspot.com/` | not found | OAuth, `needs_own_app` true: HubSpot needs a pre-registered app (`dtos.py:172-174` names HubSpot) | answered 401; URL in vendor documentation |
| `asana` | Asana | `https://mcp.asana.com/v2/mcp` | not found | OAuth, `needs_own_app` true: Asana needs a pre-registered app (`dtos.py:172-174` names Asana) | answered 401; URL in vendor documentation |
| `intercom` | Intercom | `https://mcp.intercom.com/mcp` | not found | OAuth (verify) | answered 401; URL in vendor documentation |

Notes:

- The registry served entries with the schema `2025-12-11` on 2026-11-22. D4 says which schemas the reader accepts.
- An entry with `needs_own_app` true is harder to connect than the others. The team may want an API key option first on those cards, or leave them out of the first list.
- No bundled agent template declares one of these servers today (D7).
- The first list has no `templated_url` entry. The shape stays, because an entry must be able to describe every auth kind (owner decision 3).

## Naming

Conventions read: root `AGENTS.md`; `api/AGENTS.md` (domain layout, routes, migrations, exceptions, typed returns); `web/AGENTS.md` (Fern client, zod at the boundary, entity folders, stories); `web/mobile/AGENTS.md`; and these rows of `.agents/skills/naming-and-resources/references/project-conventions.md`: Catalog keys, Display text, Enums, Table name, Constraint and index names, Standard routes, Path parameters, Operation ids, Responses, Errors, Domain layout, Frontend entities.

### Terms

**Catalog entry**: one MCP server that Agenta has configured and tested, as it appears in the catalog.
_Avoid_: preset (it means a permission preset in `mcpPresets.ts`), template (agent templates), connector, integration (Composio), provider, "catalog" alone in a code name (`McpCatalogTool` and `toCatalogTools` already mean a server's tool list).

**Catalog file**: `catalog.json`, the one JSON file that holds every catalog entry.

**MCP server**: a project's own connection to a server, stored as a row. In code and routes it is an "endpoint".
_Avoid_: connection (`gateway_connections` is Composio), catalog entry, standard endpoint (the namespace `standard` means a generated provider endpoint).

**Entry key**: the id of a catalog entry in the catalog. It is the `key` field of an entry in the catalog file.
_Avoid_: slug (a slug is the address of a stored item, unique per owner; an entry has no owner), name (the registry's name).

**Origin**: where an entry's title, description and remotes come from: the entry in the catalog file (`internal`) or the registry (`registry`).
_Avoid_: source, provider, direction, importer.

**Catalog reference**: the entry key that a connected server stores in `catalog_entry_key`. It says where the row came from. Nothing reads it to route a call.

**Auth option**: one way to authenticate to the entry's server, with its settings.
_Avoid_: auth kind (the row's field is `auth_mode`).

**Catalog connect request**: a `request_connection` call whose `target` holds a `catalog_entry_key`.
_Avoid_: integration request (Composio), named-target request (a `target` with a `name`, which means a server or a provider that exists).

### Names in each layer

| Term | Table | Column or index | ORM model | DTO field | Route | JSON or config field | UI label | Differs because |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Catalog entry | none (D2) | | | `MCPCatalogEntry` | `/gateways/mcps/catalog/entries/`; `list_mcp_catalog_entries`, `fetch_mcp_catalog_entry` | `entry`, `entries`; an item of `entries` in `catalog.json` | a row in "From the catalog" | |
| Entry key | `mcps_endpoints` | `catalog_entry_key` | `MCPEndpointDBA.catalog_entry_key` | `MCPCatalogEntry.key` (`MCPCatalogEntryKey`); `MCPEndpoint.catalog_entry_key` (output); `MCPEndpointCreate.catalog_entry_key` (input) | `{entry_key}` | `key`; `catalog_entry_key`; field `key` in `catalog.json`; view parameter `catalogEntryKey`; web type `McpCatalogEntryKey` (a zod brand) | not shown | Catalog keys row: `key` inside the catalog, `<thing>_key` outside it. The owner's word was "slug". |
| Origin | | | | `MCPCatalogOrigin` (file model only): `internal`; Direction B adds `registry` | | `origin.kind` | not shown | |
| Category | | | | `MCPCatalogEntry.categories`; enum `MCPCatalogCategory` (D9) | | `categories`; `listing.categories` in `catalog.json` | chip label per value | |
| Logo | | | | `MCPCatalogEntry.logo_url` | | `logo_url` in `catalog.json` and in the list and fetch answers; not in the discover answer | the row image, or the default mark | The Composio catalog DTO calls its field `logo` (`api/oss/src/core/gateway/catalog/dtos.py:41`). The MCP catalog uses `logo_url` in every layer, because the value is always a URL. The web passes it to the `logo` prop of `AppLogo` and `IntegrationTile`, which are shared with Composio. |
| Server URL | `mcps_endpoints` | `data` | | `MCPCatalogFixedUrlConnection.url`; `MCPCatalogTemplatedUrlConnection.url_template`; `MCPEndpointRoute.base_url` | | `connection.url`, `connection.url_template`; `data.route.base_url` | "Server URL" | `base_url` is the shipped row field. Mapped in `apply_entry` only. |
| Connection kind | | | | `MCPCatalogConnection.kind`: `fixed_url`, `templated_url` | | `connection.kind` | not shown | |
| Auth option | `mcps_endpoints` | `auth_mode` | `MCPEndpointDBA.auth_mode` | `MCPCatalogAuthOption.auth_mode` (`oauth`, `api_key`, `none`) | | `connection.auth_options[].auth_mode` | "OAuth", "API key", "None" (the shipped labels in `web/packages/agenta-i18n/locales/en/entityUi.mcpConnect.json`) | |
| Credential binding | | | | `MCPCatalogApiKeyOption.credential_binding` (the existing `MCPCredentialBinding`) | | `credential_binding` | the read-only header fields | the same type as the row's, so nothing is mapped |
| Needs own app | | | | `MCPCatalogOAuthOption.needs_own_app`; `MCPCatalogDiscoveredEntry.needs_own_oauth_app` | | `needs_own_app` on the `oauth` option; `needs_own_oauth_app` on an entry of the discover answer | "Needs your own OAuth app" | On the `oauth` option the name needs no more words. At the level of an entry there is no option around the field, so the name says which app. |
| Default scopes | | | | `MCPCatalogOAuthOption.default_scopes` | | `default_scopes` | checked boxes on the scope screen | the row's `oauth_config.scopes` is the person's selection; this is the start value |
| Entry state | | | | none; derived in the web | | | "Connect", "Connected", "Needs sign-in" | |
| Address changed | | | | none; derived in the web (`entryAddressChanged`) | | | the notice, and "New address" on a Settings row | |
| Server added by URL | | | | no field: a row with no catalog reference | | the field is absent in the JSON; journey start and mode `{kind: "url"}` | "Custom server URL" | The UI label is shipped text. In code and prose the flow is "by URL", because `custom` is the name of the namespace of every stored row, also of a row from the catalog. |
| Templated URL | `mcps_endpoints` | `data` | | `MCPCatalogTemplatedUrlConnection.url_template`; on the row, `MCPCredentialBinding` with `kind: "url"` and `base_url` with `{secret}` | | `connection.kind: "templated_url"`, `connection.url_template`; `credential_binding.kind: "url"` | "Needs an API key" | The shipped names stay: the `url` binding and `with_url_secret` (`providers/http/adapter.py:77`). The entry kind names the shape of the address and pairs with `fixed_url` and `url_template`. It is not an auth mode: the mode of such an entry is `api_key`. |
| Catalog discovery | | | | `MCPCatalogDiscovery`, `MCPCatalogDiscoveredEntry`, `MCPCatalogDiscoveredServer` | `POST /gateways/mcps/catalog/discover`; `discover_mcp_catalog_entries` | platform op `discover_mcp_catalog`; `entries[]`, `entries[].needs_own_oauth_app`, `servers[]`, `servers[].state`, `can_connect` | not shown | The op and the route both say `catalog`, the thing they list. `servers` and `server` name the project's rows. The verb follows `discover_tools` and `/tools/discover`. |
| Catalog connect request | | | | none; a client tool input | | `target.catalog_entry_key` in the `request_connection` input; web `connectRequestKind` (`catalog_entry`, `named_target`, `integration`), `parseCatalogConnectTarget`, `McpCatalogEntryKey` | the dock card | The same field name as on the create body. The kind values name what the call holds: an entry of the catalog, a target with a name, or an integration key. |
| Connect result | | | | none; a client tool output | | `connected`, `target`, `slug`, `name`, `reason` (`declined`, `cancelled`) | "Linear connected", "Not connected", "Connection not completed" | `slug` is at the top level, as in the integration result (`ConnectOutput.slug`). A named-target result holds no slug. |

### Item kinds against the template

| Kind | Missing or extra fields | Actions | Owner kinds and owner rules | Differs because |
| --- | --- | --- | --- | --- |
| Catalog entry | No `id`, `slug`, owner columns, lifecycle fields, `flags`, `tags`, `meta`. It has `key`. | List, fetch and discover only. All three are reads. | No owner. One catalog for the deployment, the same for every organization, project and person. | It is not a stored item. It is release data, like a Composio catalog integration or an agent template. |
| MCP server (changed) | Adds `catalog_entry_key` (input on create, then output). | No new action. Create takes one new optional field. | Unchanged: a project row in the namespace `custom`. The sign-in is `project` or `user`. The field means the same for both sign-in owners. | |

### Caller examples (proposed)

1. List the catalog: `GET /gateways/mcps/catalog/entries/` → `{"count": 19, "entries": [{"key": "linear", "title": "Linear", ..., "connection": {"kind": "fixed_url", ...}}]}`.
2. Connect Linear with OAuth: `POST /gateways/mcps/endpoints/` with `{"endpoint": {"name": "Linear", "auth_mode": "oauth", "catalog_entry_key": "linear", "data": {}}}` → the row, with the entry's URL and `catalog_entry_key: "linear"`. Then `POST /gateways/mcps/endpoints/{endpoint_id}/connect` twice, as today.
3. A mistake: the client sends `"auth_mode": "none"` for an entry that offers only `oauth` → `400` with `detail` `{"code": "mcp_catalog_auth_mode_not_offered", "message": "...", "retryable": false, "next_step": "Send an auth mode that the entry offers.", "details": {"auth_modes": ["oauth"]}}`. Recovery: send an `auth_mode` from the list, or add the server by URL, with no `catalog_entry_key`.
4. The person asks the builder for the Linear MCP server: `discover_mcp_catalog` → `{"count": 19, "can_connect": true, "entries": [{"key": "linear", "title": "Linear", "description": "Find and manage issues, projects, and documents in your Linear workspace.", "categories": ["project_management"], "needs_own_oauth_app": false, "servers": []}, ...]}`. Then `request_connection` with `{"target": {"plane": "mcp", "catalog_entry_key": "linear"}}` → `{"connected": true, "target": {...}, "slug": "linear-3f2a9c1b7d20", "name": "Linear"}`. Then `edit_agent_config` with `add_item` on `["parameters", "agent", "mcps"]`.

### Deferred surface

- `Windowing`, `POST /gateways/mcps/catalog/entries/query`, and server-side search or category filter.
- A categories route.
- A logo route, or copies of the logos on our own host.
- A filter on the endpoints query by `catalog_entry_key`.
- A version number on the reference. It is one more nullable column, if a reader for it appears.
- A `deprecated` status for an entry.
- Static headers on an entry.
- `tested_at` in the API answer.
- A search field and `Windowing` on `POST /gateways/mcps/catalog/discover`.
- `discover_mcp_catalog` in the build kit, and a catalog request from a runtime agent.
- A `failed` reason, apart from `cancelled`, on the connect result.
- A catalog card that looks for a server that exists, with an action to use it or to sign in to it.
- A Retry on a settled catalog row.
- A person's own sign-in as a step of the chat flow.

### Costly choices

| Choice | Option 1 (proposed) | Option 2 | Migration cost later |
| --- | --- | --- | --- |
| The reference column | `catalog_entry_key` holds the entry key (`linear`). | `catalog_entry_name` holds the registry name (`app.linear/linear`). | A column rename fails the migration gate; it needs expand and contract. |
| The route segment | `/gateways/mcps/catalog/entries/` | `/gateways/mcps/catalog/servers/` | A route rename needs both routes for a time, and a new generated client. |

Option 1 for the column: the registry name belongs to the publisher and is not unique in the catalog (one registry server, several remotes, several cards). An `internal` entry has no registry name. The key is ours.

### Exceptions

| Name | Rule it breaks | Reason | Plan |
| --- | --- | --- | --- |
| "MCP server" in the UI, `endpoint` in routes, DTOs and the table | One term per concept | Shipped names | Permanent exception. New names in this change use `catalog_entry` and do not add a third word. |
| `McpCatalogTool`, `toCatalogTools` (a server's tool list) beside `mcpCatalogEntry` (this catalog) | One word, one meaning | Shipped names in `toolCatalog.ts` | New names always say `CatalogEntry` or `mcpCatalogEntry`. A rename of the tool-list names is outside this change. |
| `connection.url` in the entry, `base_url` on the row | One term per concept | `base_url` is shipped | Mapped in `apply_entry` only. |
| No `Windowing` on the list route | Pagination row | The list is tens of items | Add `Windowing` if the catalog passes about 200 entries. |

The `server.json` shape (`$schema` and its other names) is not an exception: it exists only in the Direction B entries of the catalog file and in the readers, and never in the API.

## Risks / Trade-offs

- A vendor changes a URL or its auth, and a card stops working → the live probe in the connect flow shows the failure, or the catalog message on `check_failed`; the health-check job is later work.
- A server needs a pre-registered OAuth app, and the card looks "one click" but is not → the row says "Needs your own OAuth app" before the person starts, with the `help_url`. The probe can disagree with the entry; in the flow the probe wins (D7 step 5).
- Vendors that accept only approved OAuth clients may refuse Agenta → such an entry fails the test checklist and does not ship.
- Two "Connect another" creates at the same time can get the same display name → `_check_name_is_free` is a check with no constraint behind it (`service.py:328-334` says so). The catalog makes this more likely, because two people start from the same suggested name. The fix is outside this change.
- A catalog URL that differs from a template's URL by one character makes the template not find the server → no bundled template declares a catalog vendor today; the only bundled MCP URL is `https://mcp.example.com/mail`. When a bundled template declares a catalog vendor, add a unit test then that the two URLs are equal.
- A maintainer makes a cosmetic change to an entry URL (a trailing slash, a change of case) → every connected user gets the address notice. `CONTRIBUTING.md` says not to.
- A change of auth mode or binding at the same URL keeps the key → by design; the row's own copy shows what it uses.
- A project gets the same vendor twice, once from Composio and once from this catalog → accepted; Composio gives tools and the catalog gives MCP servers, and the backends stay separate.
- In both directions, a new entry needs a release → accepted; it is what makes the catalog reviewed.
- Direction B: the script depends on a preview API → a break stops syncs, not the product.
- A vendor moves or removes its logo image → the row shows the default mark until the next re-test, which checks that each logo loads (D11).
- A vendor's host learns that a person opened the catalog → the image request carries no referrer and no credential; this is the same exposure as the logos of the Composio integrations today.
- The agent gets every entry on each call, with its description → at most about 200 tokens for each entry; 19 entries are at most about 4,000 tokens. The builder calls the op only when the person asks for an MCP server. Add a search field when the catalog passes about 100 entries.
- A description is written to steer a model → it is reviewed text with the limits of D1, and in Direction B a person reads each change in the sync diff (D11). `CONTRIBUTING.md` tells the reviewer that the builder model reads the description.
- An app is in the Composio catalog and in the MCP catalog → the builder does not choose: it uses the MCP catalog only when the person asks for an MCP server (owner decision 14). A project can then have both for one vendor, which is accepted (see above).
- A server added by URL at an entry's address has no key, so the agent asks for a second server → the same limit as the entry state in D9. The person presses "Not now".
- An agent sends a key that it invented, or a key of a wrong form → the card says that the server is not in the catalog, with "Not now"; the result is a decline, and the builder does not ask again.
- A catalog request reaches an old web build → the integration card shows with an empty name; "Not now" settles it (D13.8).
- Another person connects the entry between the builder's discover call and the card → the person makes a second row for that entry, which the design allows (D7, "Rules for the reference"). The catalog card does not look for a server that exists (D13.3).
- A person finishes the journey after the run was stopped → no answer is sent for the old call (D13.3 step 4), so no run error shows; the builder finds the server on its next turn.
- The person leaves the conversation while the journey is open, and the transcript row unmounts → the pending row stays, as for every modal host of the journey today; an unmount only abandons the attempt (`McpConnectJourney.tsx:576`). An abandoned pending row is inert (`useMcpConnectJourney.ts:1158-1159`). A stopped run does not unmount the row (D13.3 step 4).
- The API ships before the agent service, and every builder turn fails → the release order of D13.8.

## Migration Plan

1. Ship the API (the column, the catalog service, the routes and the catalog file) and the web in either order. A new web against an old API shows the catalog error state and the custom URL path (D8). An old web against a new API does not use the catalog. D13.8 gives the mixed versions of the agent path, and its release order: the SDK op and the agent service ship before the builder's tool list.
2. Rollback: revert the web or the API. The column stays and is not read.

No data backfill. Existing MCP servers keep a null reference and are servers added by URL.

## Open Questions

1. **Direction A or Direction B.** The team decides. See D3, D4 and D12.
2. **The first list.** Which of the 19 ship first? Do entries with `needs_own_app` true ship in the first list?
