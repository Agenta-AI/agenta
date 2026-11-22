# MCP server catalog

Status: proposal, not implemented. One decision is open: where the catalog entries come from (Direction A or B below). The team makes that decision. Everything else in this change is the same for both directions.

## Why

Today a person adds an MCP server by hand. The person must know the server URL, the auth kind, the header name for a key, and sometimes the steps to register an OAuth app. The connect flow (`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx`) starts with an empty URL field.

Most people want a well-known server: GitHub, Linear, Notion. Other products give a list of tested servers (Langdock has about 82, Gumloop has more than 50). Agenta has the machinery to connect to these servers, but no list.

## What Changes

- Add a catalog of MCP servers that Agenta has configured and tested. Each item is a **catalog entry**.
- Add one entry format. One JSON file, the **catalog file** `catalog.json`, holds every entry in a list. Each entry holds a `key`, `origin`, a `listing` (categories and the tested date), an optional `logo_url`, and a `connection` with the URL, the auth options and the default OAuth scopes. An `internal` entry also holds its `title` and `description`. A `registry` entry takes them from the MCP Registry, and holds a `server` part in the registry's `server.json` shape. The API returns Agenta's own field names only.
- Add a read API: `GET /gateways/mcps/catalog/entries/` and `GET /gateways/mcps/catalog/entries/{entry_key}`. An entry holds an optional `logo_url`, a link to the vendor's own image; the API never fetches it, and there is no logo route.
- Add connect-from-card. A card starts the connect flow that exists today, with the URL, the name and the auth settings filled in. The create request `POST /gateways/mcps/endpoints/` gets one new optional input field, `catalog_entry_key`.
- Each MCP server row keeps its own copy of the URL and auth settings, as today. It also keeps a reference to the entry: `catalog_entry_key`, the entry key. The server sets it. A removed or changed entry does not change a connected server.
- A server from a card is a normal `custom` row in `mcps_endpoints`. It is not a `standard` endpoint.
- Add the catalog UI in `web/mobile` and `web/packages`: cards, search, categories, a Connect button, a connected state, and "Custom server URL", which is today's by-URL flow. It reuses the row, logo, skeleton, notice and chip components of the Composio catalog UI.
- A server from the catalog shows a notice when its entry has a new address, with "Add at the new address". The notice is in the server's detail and on its row in Settings. The server itself does not change.
- Add agent discovery. The builder agent gets one platform op, `discover_mcp_catalog`, over a read route for agents, `POST /gateways/mcps/catalog/discover`. The answer is light: each entry's key, title, description and categories, and the project's servers from that entry with their state. It holds no logo and no URL. The description is the reviewed text of the catalog file.
- Extend the client tool `request_connection`: `target` gets one optional field, `catalog_entry_key`, for `plane: "mcp"`. The chat shows the request as a card in the connect dock, with the entry's logo, title, description and auth hint. "Connect" opens the connect flow that exists, in catalog mode. One classifier gives each request one kind: a catalog entry, a target with a name (a server or a provider that exists), or a Composio integration. Each kind has its own card in the dock; today a request with a target gets an integration card with an empty name. The catalog card offers "Connect" and "Not now". It follows the practice of the secret dock for permissions: without `edit_mcp_endpoints`, "Connect" is turned off and the card says to ask a project admin. The tool result returns the new server's `slug`, and the run resumes as it does today.
- The builder agent adds the connected server to the `mcps` list of the agent it builds. Its prompt gets the rules for an MCP server, which follow its rules for a connected app. Composio tools and MCP servers are different things: the builder never mixes them and never trades one for the other. It uses the MCP catalog only when the person asks for an MCP server.
- Propose a first list of 19 servers for the team to edit (design, "First list").

The connection manager does not change. This change reuses the MCP gateway in `api/oss/src/core/gateways/mcps/` (`service.py`, `probe.py`, `oauth/`), the `mcps_endpoints` rows, and the encrypted credentials in `secrets`. It adds no auth machinery and no owner kind. An MCP server row belongs to a project. The sign-in is the project's or each person's own (`owner_kind` `project` or `user`), as shipped in the accounts package (`docs/design/accounts-package/spec.md`).

## Open decision: where entries come from

The catalog has three layers. Layer 1 is the source of the entry data. Layer 2 is the curated catalog and its cards. Layer 3 is the connection manager, which exists. Layer 1 has two directions. The design specifies both and does not choose.

- **Direction A, internal.** People write each entry in the catalog file in the repository. A pull request reviews each change. The file ships with each release.
- **Direction B, registry at build time.** For a `registry` entry, the title, the description and the remotes come from the official MCP Registry (`registry.modelcontextprotocol.io`). During the monthly re-test, a person runs a script that copies the registry data into the catalog file, and opens a pull request. The catalog file is the allowlist: a registry name is read only when an entry in the file names it in `origin`. People still write the Agenta fields. The running API reads the catalog file, as in Direction A.

Both directions give the same entry format and the same read API. The UI and the connect flow do not know the source. Each entry records its `origin` (`internal` or `registry`). The design has a comparison table (D12).

## Capabilities

### New Capabilities

- `mcp-catalog-entries`: the entry format, validation, the read API, and the rules of each layer-1 direction.
- `mcp-catalog-connect`: connect-from-card, the reference on the MCP server row, and what happens when an entry changes.
- `mcp-catalog-ui`: the catalog cards, search, categories, connected state, the address notice and the custom URL path.
- `mcp-catalog-agent`: how an agent finds catalog entries, asks the person to connect one through `request_connection`, gets the server's slug back, and adds the server to an agent.

### Modified Capabilities

None. No MCP gateway capability is archived in `openspec/specs/`.

## Impact

API, new:

- `api/oss/src/core/gateways/mcps/catalog/` (`dtos.py`, `files.py`, `service.py`, `apply.py`, and `discovery.py`, the pure join of entries and the project's servers).
- `api/oss/src/apis/fastapi/gateways/mcps/catalog_router.py`, with the list, fetch and discover routes.
- The catalog file `catalog.json` in `api/oss/src/resources/mcp_catalog/`, and one API unit test that validates it. No new CI workflow for validation.

API, changed:

- `api/oss/src/core/gateways/mcps/dtos.py` (`MCPEndpointCreate`, `MCPEndpoint`) and `types.py` (new exceptions).
- `api/oss/src/dbs/postgres/gateways/mcps/dbas.py`, `dao.py` (`edit_endpoint`), `mappings.py` (`map_mcp_endpoint_create_to_dbe` writes the key, and `map_mcp_endpoint_dbe_to_dto` reads it).
- `api/oss/src/apis/fastapi/gateways/mcps/router.py` (`create_endpoint`, constructor), `models.py`, and `api/oss/src/apis/fastapi/gateways/exceptions.py`.
- `api/entrypoints/routers.py` (wiring), and the tests that build `MCPGatewayRouter`.
- `api/oss/src/core/gateways/mcps/service.py` and `api/oss/src/core/agent_requirements/service.py` (the rule "is this `custom` row ready" becomes one pure function, which `_connection_state`, `_mcp_ready` and the discovery all call).
- `api/oss/src/core/workflows/static_catalog.py` (the `request_connection` input schema and descriptions).
- `api/oss/src/core/workflows/builder_agent.py` (`BUILDER_AGENT_TOOLS`, the connection rules, the field reference).

The service and the DAO `create_endpoint` signatures do not change.

SDK, changed:

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (the platform op `discover_mcp_catalog`).
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` (the gateway shape of an `mcps` item in the field reference).

Runner, changed:

- `services/runner/src/extensions/agenta.ts` (one clause in the prompt hint of `request_connection`). No `/run` wire field changes.

Release order: the SDK op and the agent service image that holds it ship before the API adds the op to the builder's tool list (design D13.8).

Database: one additive `core_oss` revision. It adds one nullable column, `catalog_entry_key`, to `mcps_endpoints`. No catalog table in either direction.

Web, new:

- `web/packages/agenta-entities/src/mcpCatalogEntry/` (with a zod schema for the entry answers), and its entry in the `exports` of `web/packages/agenta-entities/package.json`.
- `web/packages/agenta-entity-ui/src/mcpEndpoint/McpCatalogEntryList.tsx` and `components/McpCatalogByUrlRow.tsx`.
- `.../agentTemplate/views/mcpCatalogView.tsx` and `McpCatalogViewBody.tsx`.
- The i18n catalog `entityUi.mcpCatalog`.
- `web/packages/agenta-entities/src/mcpCatalogEntry/hooks/useMcpCatalogStart.ts` (the steps before a catalog journey, for the connect view and the chat modal).
- `web/packages/agenta-entity-ui/src/clientTools/McpCatalogConnectToolWidget.tsx`, `McpCatalogConnectBody.tsx`, `NamedTargetConnectBody.tsx`, `useMcpCatalogConnectFlow.ts` and `useConnectRequestIdentity.ts` (the chat card and the transcript row of an agent's catalog request, and the dock card of a request for a server that exists).
- `web/packages/agenta-chat/src/hooks/useDockCardShortcuts.ts` (the keyboard rule that every card of the connect dock shares).
- Stories in `web/storybook/stories/entity-ui/`.

Web, changed:

- `agenta-entities/src/mcpEndpoint/core/connectJourney.ts`, `core/types.ts`, `hooks/useMcpConnectJourney.ts`.
- `agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx` (`useMcpConnectScreens`, and the `catalogEntryKey` prop of the modal), `components/AuthModeSelector.tsx`, `McpAddServerList.tsx`, `McpConnectionDetail.tsx` and its i18n keys, `index.ts`.
- `.../agentTemplate/views/mcpConnectView.tsx`, `McpConnectViewBody.tsx`, `McpAddViewBody.tsx`, and `agentTemplate/CategoryChips.tsx` (made generic).
- `agenta-ui/src/view-stack/types.ts`, `ViewStackHost.tsx` and `hooks.ts` (one optional `ViewForm` field, `guardLeave`, so a form can enable Save and still not ask before leaving).
- `agenta-settings-ui/src/mcp/McpServersSection.tsx` (the catalog view and the address state on a row) and `agenta-i18n/locales/*/settings.mcp.json` (the empty-state text).
- `agenta-shared/src/clientTools/index.ts` (`connectRequestKind`, `parseCatalogConnectTarget`, the catalog result builders, `declinedConnectOutput`).
- `agenta-entity-ui/src/clientTools/registry.tsx` (`ConnectRequestWidget`), `GatewayConnectToolWidget.tsx` (it opens its surface when the dock card asks) and `index.ts`.
- `agenta-chat/src/components/ConnectionDock.tsx` (the identity and the body of a card, for each of the three kinds of request).
- `agenta-i18n/locales/*/chat.connectionDock.json` and `entityUi.clientTools.json`.
- `web/mobile/src/features/chat/LiveConversation.tsx` (it reads the `edit_mcp_endpoints` permission and passes `canEditMcpEndpoints` to the connect dock).
- `agenta-entity-ui/src/drawers/shared/CatalogAppCard.tsx` (`AppLogo` shows the default mark when an image fails to load, and sends no referrer; the Composio cards get this too) and `clientTools/IntegrationTile.tsx` (no referrer).
- The generated API client in `web/packages/agenta-api-client/`.

No file in `web/oss` or `web/ee` is edited. `web/oss/src/components/pages/settings/MCPEndpoints/MCPEndpoints.tsx` mounts the shared `McpServersSection`, so the abandoned desktop app changes with it.

Docs: `docs/docs/guides/04-add-an-mcp-server.mdx` (the catalog path and the custom URL path).

Direction B only: a sync script that a person runs during the monthly re-test, and a weekly GitHub job (`.github/workflows/52-mcp-catalog-drift.yml`) that runs the script in check mode. The job has read-only access and no secret. It fails when the registry changed one of our entries, and it never opens a pull request.

Composio's backend does not change. The Composio integrations catalog (`gateway_connections`, `/tools/catalog/...`) stays separate.

The agent path changes none of these: the `/run` wire contract, the resume rule in `@agenta/playground`, the connect flow of a `target` with a `name` (`useGatewayConnectFlow.ts`), and the Composio connect flow (`useConnectFlow.ts`, `ConnectToolWidget.tsx`). The op list of the build kit does not change. The static `request_connection` tool that every build kit embeds does change: every agent that has the tool sees the field `catalog_entry_key`.

## Out of scope

Each item is possible later work.

- Organization admin allowlist: a customer blocks catalog entries. It is not complete while a person can still add a server by URL.
- Per-tool controls in the catalog: hidden tools and approval defaults per entry.
- A scheduled health-check job and snapshots of tool descriptions, to find a server that changed.
- stdio and local servers. The gateway is remote-only and speaks Streamable HTTP.
- A merge with Composio. Composio is not a source of entries.
- Organization-owned MCP servers.
- Private catalog entries that a customer adds.
- A `deprecated` status for an entry. In version 1 a person removes the entry from the catalog file: new connections are then refused, and connected servers keep working.
- Static headers on an entry.
- A catalog request from an agent other than the builder, with its own discover op. In version 1 only the builder agent finds catalog entries.
