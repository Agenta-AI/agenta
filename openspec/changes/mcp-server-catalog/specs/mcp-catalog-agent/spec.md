## ADDED Requirements

### Requirement: An agent lists the catalog with the project's state
The system SHALL add the route `POST /gateways/mcps/catalog/discover` with the operation id `discover_mcp_catalog_entries`. The route SHALL need `VIEW_MCP_ENDPOINTS` and SHALL be off when the MCP gateway is off. The answer SHALL be `{count, can_connect, entries}`. Each entry SHALL hold `key`, `title`, `description`, `categories`, `needs_own_oauth_app` and `servers`. `description` SHALL be the reviewed description of the domain entry, as plain text of at most 500 characters, and no other text. `needs_own_oauth_app` SHALL be true only when the entry's `oauth` option has `needs_own_app` true. `servers` SHALL be sorted by `slug` and SHALL hold, for each active `custom` row of the project whose `catalog_entry_key` is the entry's key, the row's `slug`, `name` and `state`. `state` SHALL be a gateway connection state: `ready`, `needs_auth` or `needs_input`. One pure function SHALL decide whether a `custom` row is ready, and the gateway's own state, the agent requirements check and this answer SHALL all call it. A row that is not ready SHALL be `needs_auth` for the mode `oauth` and `needs_input` for the mode `api_key`. `can_connect` SHALL be true only when the caller has `EDIT_MCP_ENDPOINTS`. The answer SHALL NOT hold a `logo_url`, a server URL, an auth mode, a credential binding, a help link, a secret id or a secret. The entries SHALL be sorted by `title`. The answer SHALL be built from the domain entries only, so that it is the same for an `internal` entry and a `registry` entry. The system SHALL add the platform op `discover_mcp_catalog`, read-only, with no input, as a direct call to this route. The system SHALL NOT add catalog entries to the answer of `discover_tools`.

#### Scenario: An entry with no server
- **WHEN** the project has no row with the key `linear` and an agent calls `discover_mcp_catalog`
- **THEN** the `linear` entry SHALL have `servers` equal to an empty list

#### Scenario: An entry with a connected server
- **WHEN** the project has a row with the key `linear`, a secret and `flags.is_valid` true
- **THEN** the `linear` entry SHALL list that row's `slug` and `name` with the state `ready`

#### Scenario: An OAuth row with an unfinished sign-in
- **WHEN** the project has an OAuth row with the key `linear` and no secret
- **THEN** the `linear` entry SHALL list that row with the state `needs_auth`

#### Scenario: An API key row with no key
- **WHEN** the project has an `api_key` row with the key `linear` and no secret
- **THEN** the `linear` entry SHALL list that row with the state `needs_input`

#### Scenario: A row with no auth
- **WHEN** the project has a row with the key of an entry and the mode `none`
- **THEN** the entry SHALL list that row with the state `ready`

#### Scenario: An inactive row
- **WHEN** the project's only row with the key `linear` has `flags.is_active` false
- **THEN** the `linear` entry SHALL have `servers` equal to an empty list

#### Scenario: A server added by URL at the same address
- **WHEN** the project has a row with the entry's URL and no `catalog_entry_key`
- **THEN** the entry's `servers` SHALL NOT list that row

#### Scenario: A caller who cannot add a server
- **WHEN** the caller has `VIEW_MCP_ENDPOINTS` and not `EDIT_MCP_ENDPOINTS`
- **THEN** the answer SHALL have `can_connect` false and SHALL still list the entries and the servers

#### Scenario: A caller who cannot view servers
- **WHEN** the caller has no `VIEW_MCP_ENDPOINTS`
- **THEN** the route SHALL answer `403`

#### Scenario: Light answer
- **WHEN** an entry has a `logo_url`, a description and a `help_url`
- **THEN** the entry in the answer SHALL hold the description, and SHALL hold no `logo_url` and no `help_url`

#### Scenario: Both origins
- **WHEN** the catalog holds an `internal` entry and a `registry` entry
- **THEN** both SHALL have the same fields in the answer, and each `description` SHALL be the text that the catalog file holds for that entry

#### Scenario: One state rule
- **WHEN** a `custom` row is ready by the gateway's rule
- **THEN** the gateway's own state, the agent requirements check and the discover answer SHALL all say that it is ready

#### Scenario: Gateway off
- **WHEN** `AGENTA_MCP_GATEWAY_ENABLED` is false
- **THEN** the route SHALL NOT answer, as the other routes of the plane

### Requirement: An agent asks for a catalog server with the request-connection tool
The client tool `request_connection` SHALL accept an optional `catalog_entry_key` in `target`. The system SHALL add no new client tool, no new tool URI and no new render kind. In the input schema, `target.required` SHALL be `["plane"]`, `target.additionalProperties` SHALL stay false, and the schema SHALL hold no `oneOf`, `anyOf` or `allOf`. The descriptions SHALL say that, on the MCP plane, `target` holds `name` (the slug of a server that exists) or `catalog_entry_key` (a key from `discover_mcp_catalog`), and that the result of a catalog request holds the new server's `slug`. One pure function SHALL put every `request_connection` call in one of three kinds, and the transcript and the dock SHALL both read it: `catalog_entry` when the call has a `target` object whose `plane` is `mcp` and that holds a `catalog_entry_key`; `named_target` for every other call that has a `target` object; `integration` for a call with no `target` object. A call that has a `target` object SHALL never be an `integration` call. The runner's prompt hint for `request_connection` SHALL say that a catalog request holds `catalog_entry_key` and no `name`. The system SHALL change no field of the `/run` wire contract.

#### Scenario: A catalog request
- **WHEN** an agent calls `request_connection` with `{"target": {"plane": "mcp", "catalog_entry_key": "linear"}}`
- **THEN** the call SHALL be a `catalog_entry` call, and the web SHALL show the catalog card for the entry `linear`

#### Scenario: A name and a key
- **WHEN** a call holds `target.name` and `target.catalog_entry_key` on the MCP plane
- **THEN** the call SHALL be a `catalog_entry` call

#### Scenario: A key on the LLM plane
- **WHEN** a call holds `plane` `llm`, a `name` and a `catalog_entry_key`
- **THEN** the call SHALL be a `named_target` call

#### Scenario: A key with a wrong form
- **WHEN** `target.plane` is `mcp` and `catalog_entry_key` is `../x`
- **THEN** the call SHALL be a `catalog_entry` call, the web SHALL NOT call the catalog fetch route with that value, and the card SHALL say that the server is not in the catalog

#### Scenario: A target with no name and no key
- **WHEN** a call holds `{"target": {"plane": "mcp"}}`
- **THEN** the call SHALL be a `named_target` call, its card SHALL offer "Not now" only, and the web SHALL NOT show an integration card for it

#### Scenario: A server that exists
- **WHEN** a call holds `{"target": {"plane": "mcp", "name": "acme-notion"}}`
- **THEN** the call SHALL be a `named_target` call, and "Connect" SHALL open the reconnect of that server, as today

#### Scenario: An integration
- **WHEN** a call holds `{"integration": "github"}`
- **THEN** the call SHALL be an `integration` call and SHALL get the card and the row it gets today

### Requirement: Every request-connection call has a card in the dock
While a `request_connection` call is parked, the web SHALL show it as a card in the connect dock and as a row in the transcript, for each of the three kinds. The dock SHALL stack the cards with one front card that owns the actions. A `named_target` call SHALL get its own card, and SHALL NOT get an integration card. That card SHALL show the target's name, "Connect" and "Not now". Its "Connect" SHALL ask the transcript row of the call to open the surface that the row opens today: the provider drawer, the reconnect of a server that exists, or the tool catalog drawer. Its "Not now" SHALL settle the call with the target-shaped decline. A chat message that the person sends over the dock SHALL decline each parked call in the shape of its kind. Every card SHALL answer the same keys by one shared rule: Enter with Cmd or Ctrl for "Connect", and Escape for "Not now".

#### Scenario: A named target in the dock
- **WHEN** a call with `target.name` is parked, and the activity fold of its turn is closed
- **THEN** the dock SHALL show a card with the target's name, "Connect" and "Not now"

#### Scenario: Connect on a named target
- **WHEN** the person presses "Connect" on that card, and the target is an MCP server that exists
- **THEN** the reconnect of that server SHALL open, and a finished reconnect SHALL settle the call as connected with the target

#### Scenario: A message over a named target
- **WHEN** the person sends a chat message while a `named_target` call is parked
- **THEN** the call SHALL settle with `connected` false, the `target` and the reason `declined`, and SHALL hold no `integration` field

#### Scenario: Two requests in one step
- **WHEN** an agent asks for a catalog server and for an integration in one step, and the runner defers the second request
- **THEN** the dock SHALL show one card, the row of the deferred request SHALL show the deferred note with no action, and the second card SHALL show when the agent asks again

#### Scenario: Keys
- **WHEN** a catalog card is in front and the person presses Escape outside a text field
- **THEN** the call SHALL settle as declined, as an integration card does

### Requirement: The person sees a card for a catalog request
The catalog card SHALL read the entry with the fetch route by key, and SHALL NOT read the list route or the project's servers. The card SHALL show the entry's logo, its title and its description as plain text, an auth hint from the auth mode of the entry's first auth option, and "Needs your own OAuth app" when the entry's `oauth` option has `needs_own_app` true. The auth hint SHALL name an auth mode only: an entry with a templated URL has the mode `api_key`, and its hint SHALL be the API key hint. The card SHALL offer two actions, "Connect" and "Not now". The host SHALL read the person's `edit_mcp_endpoints` permission and SHALL pass it to the dock and the card, as it does for `edit_secret` and the secret dock. Without the permission, "Connect" SHALL be turned off, and the card SHALL say "You do not have permission to add this server. Ask a project admin." "Not now" SHALL still work. When the key has a wrong form, or the fetch route answers `404` with the code `mcp_catalog_entry_not_found`, the card SHALL say that the server is not in the catalog and SHALL offer "Not now" only. For any other failure of the fetch, the card SHALL offer "Retry" and "Not now".

#### Scenario: The card of an OAuth entry
- **WHEN** an agent asks for an entry whose first auth option is `oauth` with `needs_own_app` false
- **THEN** the card SHALL show the logo, the title, the description, the sign-in hint, "Not now" and "Connect", and SHALL NOT show "Needs your own OAuth app"

#### Scenario: An entry that needs the person's own OAuth app
- **WHEN** the entry's `oauth` option has `needs_own_app` true
- **THEN** the card SHALL show "Needs your own OAuth app"

#### Scenario: An entry with a templated URL
- **WHEN** an agent asks for a `templated_url` entry
- **THEN** the card SHALL show the API key hint

#### Scenario: The description is HTML-like text
- **WHEN** an entry's description holds `<b>` or a markdown link
- **THEN** the card SHALL show the characters as text

#### Scenario: A person who cannot add a server
- **WHEN** a catalog request is parked for a person without `edit_mcp_endpoints`
- **THEN** "Connect" SHALL be turned off, the card SHALL show the permission notice, and no journey SHALL open

#### Scenario: Not now without the permission
- **WHEN** that person presses "Not now"
- **THEN** the call SHALL settle with `reason` `declined`

#### Scenario: A key that is not in the catalog
- **WHEN** the fetch route answers `404` with `mcp_catalog_entry_not_found`
- **THEN** the card SHALL say that the server is not in the catalog, SHALL offer one button, "Not now", and SHALL NOT settle the call before a press

#### Scenario: The entry was connected a moment ago
- **WHEN** another person connects the entry after the agent read the catalog, and the person presses "Connect" on the card
- **THEN** the flow SHALL make a second server for that entry, and the name screen SHALL ask for a name that is free

### Requirement: Connect opens the existing connect flow in catalog mode
"Connect" SHALL open `McpConnectJourney` with the entry's key, in the catalog mode of the connect journey. The system SHALL add no second connect flow. The transcript row SHALL mount the journey, and the dock card SHALL only ask the row to open it, so that the journey stays when the dock closes. When the run stops with the journey open, the journey SHALL stay open, and closing it SHALL delete the pending row. The modal SHALL read the entry and wait for the project's server list before the journey starts, with the same steps as the connect view. In this flow the URL SHALL be read-only, the offered auth modes SHALL be the entry's modes that the server offers, an API key SHALL be a project secret that the person picks or adds, and the scope screen SHALL start from the entry's default scopes. The create request SHALL hold `catalog_entry_key`, and the server SHALL set the URL and the binding from the entry. The flow SHALL make the project's sign-in. The chat modal SHALL NOT offer "Custom server URL". The card SHALL create no row before the person presses "Connect".

#### Scenario: Connect an OAuth entry from the chat
- **WHEN** the person presses "Connect" on the card of an OAuth entry and completes the consent
- **THEN** the project SHALL have a new `custom` row with the entry's URL and `catalog_entry_key`, and the tool call SHALL settle as connected with that row's `slug`

#### Scenario: Connect an API key entry from the chat
- **WHEN** the person presses "Connect" on the card of an entry with an `api_key` option and picks a project secret
- **THEN** the binding fields SHALL be read-only and hold the entry's binding, and the person SHALL NOT type a key into the chat

#### Scenario: The run stops with the journey open
- **WHEN** the journey has created the pending row, and the person stops the run before the connection is made
- **THEN** the dock SHALL close, the journey SHALL stay open, and after the person closes it the project SHALL have no row from this request

#### Scenario: No custom URL in the chat
- **WHEN** the check fails in a catalog journey that the chat opened
- **THEN** the screen SHALL show the catalog message with Retry and SHALL NOT show "Custom server URL"

#### Scenario: The permission is lost after the card shows
- **WHEN** a person presses "Connect", and the create is refused because the person no longer has `EDIT_MCP_ENDPOINTS`
- **THEN** the journey SHALL show the refusal on its create failure screen, no row SHALL exist, and closing the journey SHALL settle the call with `reason` `cancelled`

### Requirement: The tool result tells the agent what happened
The web SHALL settle a catalog request with a tool output, never with an error text. The output SHALL hold `connected` and SHALL echo `target`. A connected output SHALL hold `slug` and `name`, the slug and the name of the MCP server row, at the top level of the output. An output that is not connected SHALL hold `reason`, which SHALL be one of two values: `declined` when the person presses "Not now" or sends a chat message over the dock, also on the card of an entry that is not in the catalog; `cancelled` when the journey closes with no connection, also after a failed check or a refused create. The web SHALL NOT settle a catalog request on its own: every result SHALL follow a press by the person. The output SHALL NOT hold a URL, a secret id or a secret. Closing the journey before the connection is made SHALL delete the pending row, as today. The web SHALL send an answer only while the call is the parked interaction of the live execution. After the run was stopped, a finished or closed journey SHALL send no answer, and SHALL NOT put a run error on the conversation.

#### Scenario: Connected
- **WHEN** the journey reports a connection with the slug `linear-3f2a9c1b7d20` and the name "Linear"
- **THEN** the output SHALL be `{"connected": true, "target": {"plane": "mcp", "catalog_entry_key": "linear"}, "slug": "linear-3f2a9c1b7d20", "name": "Linear"}`

#### Scenario: Not now
- **WHEN** the person presses "Not now"
- **THEN** the output SHALL have `connected` false and `reason` `declined`

#### Scenario: A message over the dock
- **WHEN** the person sends a chat message while a catalog request is parked
- **THEN** the request SHALL settle with `reason` `declined` and the catalog `target`, and SHALL NOT hold an `integration` field

#### Scenario: The journey is closed
- **WHEN** the person closes the journey after the pending row was created and before the connection is made
- **THEN** the pending row SHALL be deleted and the output SHALL have `reason` `cancelled`

#### Scenario: The check fails
- **WHEN** the server check fails and the person closes the journey
- **THEN** the output SHALL have `reason` `cancelled`

#### Scenario: Not now for a key that is not in the catalog
- **WHEN** the card says that the server is not in the catalog, and the person presses "Not now"
- **THEN** the output SHALL have `connected` false and `reason` `declined`

#### Scenario: The catalog cannot be read
- **WHEN** the fetch route fails with a network error
- **THEN** the call SHALL stay parked and the card SHALL offer "Retry" and "Not now"

#### Scenario: The journey finishes after the run was stopped
- **WHEN** the person stops the run with the journey open, a new run starts, and the person then completes the connection
- **THEN** the project SHALL have the connected server, the web SHALL send no answer for the old call, and the conversation SHALL show no run error

### Requirement: The run resumes as for any request-connection call
A settled catalog request SHALL resume the run by the rules that exist for a client tool: the browser sends the answer to the server, which owns the interaction, and the run resumes when every tool part of the turn is settled. The system SHALL change no file of the resume rule and SHALL add no resume state. A decline and a cancel SHALL resume the run as a connected result does.

#### Scenario: Resume after connect
- **WHEN** the only parked call of the turn is a catalog request and it settles as connected
- **THEN** the chat SHALL send the result and the agent SHALL continue

#### Scenario: Resume after a decline
- **WHEN** the person presses "Not now"
- **THEN** the run SHALL resume and the agent SHALL get the declined result

### Requirement: The builder adds the server to the agent it builds
The builder agent SHALL have the op `discover_mcp_catalog` with the permission `allow`. A connected app and an MCP server are different things: its instructions SHALL tell it to never mix them and to never use one in place of the other. The builder SHALL use the MCP catalog only when the person asks for an MCP server; in every other case the integration path SHALL stay as it is today. Its instructions SHALL tell it to read `discover_mcp_catalog` before it asks for an MCP server, and to act on the entry's servers: to add a server in the state `ready` with no request; to ask for a server in any other state by its slug, with `target.name`; and to ask for an entry with no server by its key, with `target.catalog_entry_key`. Its instructions SHALL also tell it to ask one time, to build without the server when the result is not connected, to not ask when `can_connect` is false, and to never name a tool to the person. For each MCP server that the built agent uses, the builder SHALL add one item to that agent's `mcps`: `{"name": <slug>, "connection": {"type": "gateway", "namespace": "custom", "slug": <slug>}}`, with the `slug` from the tool result or from `discover_mcp_catalog`. It SHALL NOT invent a slug and SHALL NOT write a URL, a header or a secret in the item. The builder's field reference SHALL give this item shape in its preface and in its `mcps` section, and the two SHALL agree. The SDK that the agent service runs SHALL hold the op before the builder's tool list names it. The builder SHALL read the configuration back and confirm that the item is there. In version 1 no other agent gets `discover_mcp_catalog` by default.

#### Scenario: The person asks for an MCP server
- **WHEN** the person asks for the Linear MCP server
- **THEN** the builder SHALL read `discover_mcp_catalog` and SHALL use the `linear` entry, and SHALL NOT call `request_connection` with `integration` for Linear

#### Scenario: The person does not ask for an MCP server
- **WHEN** the person asks for an agent that reads Linear issues, and does not ask for an MCP server
- **THEN** the builder SHALL use the integration path as today, and SHALL NOT call `request_connection` with a `catalog_entry_key`

#### Scenario: No entry for the MCP server
- **WHEN** the person asks for an MCP server that the catalog does not have
- **THEN** the builder SHALL say so once, and SHALL NOT ask for a Composio integration in its place

#### Scenario: A Composio connection exists for the same vendor
- **WHEN** the person asks for the Linear MCP server, and the project has a Composio connection for Linear
- **THEN** the builder SHALL still use the MCP catalog entry, and SHALL NOT use the Composio connection in its place

#### Scenario: An integration is declined
- **WHEN** the person declines a Composio connection that the builder asked for
- **THEN** the builder SHALL NOT ask for an MCP server in its place

#### Scenario: The server is ready
- **WHEN** `discover_mcp_catalog` lists a `ready` server for the entry the agent needs
- **THEN** the builder SHALL add that server's slug to the agent's `mcps` and SHALL NOT call `request_connection` for it

#### Scenario: The server needs a sign-in or a key
- **WHEN** the entry's only server has the state `needs_auth` or `needs_input`
- **THEN** the builder SHALL call `request_connection` with `{"target": {"plane": "mcp", "name": <that server's slug>}}`, and SHALL NOT send a `catalog_entry_key`

#### Scenario: The entry has no server
- **WHEN** the entry's `servers` is empty and `can_connect` is true
- **THEN** the builder SHALL call `request_connection` with the entry's `catalog_entry_key`

#### Scenario: The server is connected now
- **WHEN** a catalog request settles as connected with a `slug`
- **THEN** the builder SHALL add one `mcps` item with that slug to the agent it builds

#### Scenario: The person declines
- **WHEN** a catalog request settles with `reason` `declined` or `cancelled`
- **THEN** the builder SHALL build the agent without the server, SHALL say once what the agent cannot do, and SHALL NOT ask again

#### Scenario: The person cannot add a server
- **WHEN** `discover_mcp_catalog` answers `can_connect` false and the entry has no ready server
- **THEN** the builder SHALL NOT call `request_connection` for it

#### Scenario: The saved item is valid
- **WHEN** the builder saves the item `{"name": "linear-3f2a9c1b7d20", "connection": {"type": "gateway", "namespace": "custom", "slug": "linear-3f2a9c1b7d20"}}`
- **THEN** the agent configuration SHALL validate, and a run of that agent SHALL reach the server through the gateway

#### Scenario: The build kit
- **WHEN** a playground agent is built from the default build kit
- **THEN** its tools SHALL NOT hold `discover_mcp_catalog`

### Requirement: The agent path gives no way around the catalog rules
The agent SHALL supply an entry key only. The browser SHALL make the create request as the person, with `EDIT_MCP_ENDPOINTS`, and the server SHALL apply the entry and run the egress guard as for a create from a catalog row. The system SHALL add no platform op that creates, edits or deletes an MCP server. The discover answer and the tool result SHALL hold no secret, no secret id and no URL. The only catalog text that reaches a model SHALL be the entry's reviewed `title` and `description`, through the discover answer. The system SHALL read no description from the registry at run time, and SHALL NOT copy an entry's description into a row.

#### Scenario: An agent sends a URL
- **WHEN** a call holds `target.catalog_entry_key` and an extra field with a URL
- **THEN** the web SHALL ignore the extra field, and the created server SHALL have the entry's URL

#### Scenario: The description comes from the reviewed catalog
- **WHEN** an agent calls `discover_mcp_catalog` for a `registry` entry
- **THEN** the `description` SHALL be the text in the catalog file of the running release, and the API SHALL make no request to the registry

#### Scenario: No description on the row
- **WHEN** a person connects a catalog entry from the chat card
- **THEN** the new row's `description` SHALL NOT hold the entry's description, and the tool result SHALL hold no description
