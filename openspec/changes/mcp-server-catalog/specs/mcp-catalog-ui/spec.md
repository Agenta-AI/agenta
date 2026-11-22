## ADDED Requirements

### Requirement: Catalog in Settings
In Settings > MCPs of the app at `/m`, the "Connect MCP" button SHALL always open a catalog view, and the app SHALL fetch nothing for the catalog before the click. The view SHALL show one row for each entry, with the logo (or the default mark), the title, the description and the entry's state. A row SHALL open the connect step as the second level of the view stack. The code SHALL be in `web/mobile` and `web/packages` only.

#### Scenario: Open from settings
- **WHEN** a project editor presses "Connect MCP" in Settings > MCPs
- **THEN** the app SHALL open the catalog view, and SHALL NOT open the empty URL step

#### Scenario: Entry needs its own OAuth app
- **WHEN** an entry's first auth option is `oauth` with `needs_own_app` true
- **THEN** the row SHALL say "Needs your own OAuth app" before the person presses Connect

#### Scenario: Entry and probe disagree about the OAuth app
- **WHEN** an entry has `needs_own_app` false, and the probe in the connect flow reports that the server registers no clients for this deployment
- **THEN** the flow SHALL follow the probe and SHALL ask for the person's own OAuth app

#### Scenario: Reconnect
- **WHEN** a person reconnects a server from Settings, a chat notice or a tool widget
- **THEN** the app SHALL open the connect step directly, as today, with no catalog

#### Scenario: Member who cannot edit
- **WHEN** a member without `edit_mcp_endpoints` opens Settings > MCPs
- **THEN** the page SHALL show no "Connect MCP" button, as today

### Requirement: Catalog inside the agent's add view
The agent's "Add MCP server" view SHALL show the catalog rows inside the view, after the project's servers. It SHALL show them also when the project has no servers. The view SHALL have one search field, which filters the project's servers and the catalog entries together. The view SHALL show the search field also when the project has no servers; the field then filters the catalog only. A row SHALL open the connect step as the second level of the view stack. The app SHALL NOT open a third level.

#### Scenario: Connect from an agent
- **WHEN** a person presses Connect on a catalog row in an agent's "Add MCP server" view and completes the connection
- **THEN** the app SHALL add the new server to that agent, as the by-URL flow does today

#### Scenario: Project with no servers
- **WHEN** a person opens the add view in a project with no MCP servers
- **THEN** the view SHALL show the search field, the catalog rows and "Custom server URL"

#### Scenario: Search with no servers
- **WHEN** a person types "lin" in the add view of a project with no MCP servers
- **THEN** the view SHALL filter the catalog rows with that text

#### Scenario: One search field
- **WHEN** a person types "lin" in the add view
- **THEN** the view SHALL filter the project's servers and the catalog rows with that text, and SHALL show no second search field

#### Scenario: Catalog does not load
- **WHEN** the catalog request fails in the add view
- **THEN** the view SHALL still list the project's servers and SHALL still offer "Custom server URL"

### Requirement: Search and categories
The catalog SHALL have search and category chips. Search SHALL match the entry's title, its description and the host of its address, and no other field. A chip SHALL show the entries of one category, and "All" SHALL show every entry. Search and a chip SHALL apply together.

#### Scenario: Search by name
- **WHEN** a person types "lin"
- **THEN** the catalog SHALL show the Linear row and SHALL hide rows that do not match

#### Scenario: Category and search
- **WHEN** a person picks the chip "Project management" and types "not"
- **THEN** the catalog SHALL show only entries in that category that match "not"

### Requirement: Connect from a catalog row
A row's Connect button SHALL open the existing connect flow for that entry. The view SHALL get the entry's key, not the entry, and SHALL read the entry before the flow starts. The flow SHALL start through the existing URL submit with the entry's address, once, and SHALL NOT show the URL screen first. For a `fixed_url` entry it SHALL start with the check of the URL. The URL SHALL be read-only on every screen, including the screen for a failed check. For an API key option, the binding fields SHALL hold the entry's binding and SHALL be read-only. The flow SHALL wait until the project's server list has loaded before it picks the name and starts. The probe SHALL NOT replace the name from the entry. The step's Save button SHALL work from the first screen until the connection is made, also when the person types nothing. The view SHALL NOT ask the person to confirm leaving while the flow has not created the pending server.

#### Scenario: OAuth entry
- **WHEN** a person presses Connect on an entry that offers `oauth` with `needs_own_app` false
- **THEN** the person SHALL reach the provider's consent page without typing a URL, a header name or a client ID

#### Scenario: API key entry
- **WHEN** a person presses Connect on an entry that offers `api_key` with a header binding
- **THEN** the flow SHALL ask only for the name and the secret, SHALL show the header name and prefix as read-only, and SHALL show the entry's help link when it has one

#### Scenario: Help link
- **WHEN** an entry's `help_url` does not have the scheme `https:`
- **THEN** the app SHALL NOT render it as a link; an `https:` link SHALL have `rel="noopener noreferrer"`

#### Scenario: OAuth entry with nothing to type
- **WHEN** a person opens the connect step of an entry that offers only `oauth` or only `none`, and the check of the URL succeeds
- **THEN** the step's Save button SHALL be enabled, and pressing it SHALL continue the flow

#### Scenario: Server list still loading
- **WHEN** a person opens the connect step from a row while the project's server list is still loading, and the project has a server named "Linear"
- **THEN** the flow SHALL start only after the list has loaded, and SHALL start with a name that no server in the project uses

#### Scenario: Probe suggests another name
- **WHEN** the probe returns a server name that differs from the entry's title
- **THEN** the name field SHALL keep the name from the entry

#### Scenario: Check fails
- **WHEN** the check of the entry's URL fails
- **THEN** the flow SHALL show the failure with the URL read-only, a retry action and "Custom server URL", and SHALL create no server

#### Scenario: Custom server URL from a failure
- **WHEN** a person presses "Custom server URL" on a failure screen of a catalog journey
- **THEN** the app SHALL open the by-URL flow at the URL step with nothing filled in, and a server created there SHALL have no catalog reference

#### Scenario: Leave at once
- **WHEN** a person opens the connect step from a row and goes back before the flow created the pending server
- **THEN** the app SHALL NOT ask the person to confirm leaving

#### Scenario: Leave after the pending server exists
- **WHEN** the flow created the pending server, and the person goes back before sign-in is complete
- **THEN** the app SHALL ask the person to confirm leaving

#### Scenario: Cancel
- **WHEN** a person cancels after the flow created the row and before sign-in is complete
- **THEN** the flow SHALL delete the pending row, as the by-URL flow does today

### Requirement: The flow offers only modes that the entry and the server share
In a catalog journey, the offered auth modes SHALL be the entry's modes, without `oauth` when the probe does not find OAuth. The flow SHALL never select a mode outside that set: not after a check, not when it keeps a mode the person picked, not when the person picks a mode, and not when the flow moves to the API key screen. The flow SHALL NOT offer the API key screen when the set has no `api_key`. When the set is empty, the flow SHALL show the failed check with a message that the server does not answer as the catalog expects, with a retry action and "Custom server URL".

#### Scenario: OAuth-only entry, probe finds nothing it knows
- **WHEN** an entry offers only `oauth` and the probe reports the auth mode `unknown`
- **THEN** the flow SHALL NOT select the API key mode, and SHALL show the failed check with the catalog message

#### Scenario: OAuth-only entry, probe finds no auth
- **WHEN** an entry offers only `oauth` and the probe reports the auth mode `none`
- **THEN** the flow SHALL NOT select "None", and SHALL show the failed check with the catalog message

#### Scenario: Two modes, OAuth not found
- **WHEN** an entry offers `oauth` and `api_key`, and the probe does not find OAuth
- **THEN** the flow SHALL offer and select the API key mode only

#### Scenario: OAuth-only entry, no API key screen
- **WHEN** an entry offers only `oauth`
- **THEN** the flow SHALL NOT offer the API key screen, and SHALL NOT move to it

#### Scenario: Two modes, OAuth found
- **WHEN** an entry offers `oauth` and `api_key`, and the probe finds OAuth
- **THEN** the auth selector SHALL show these two modes and SHALL NOT show "None"

### Requirement: Default scopes
For an OAuth entry, the scope screen SHALL first check the entry's `default_scopes` that the server offers. When `default_scopes` is empty, the screen SHALL check every scope the server offers.

#### Scenario: Entry names two scopes
- **WHEN** an entry has `default_scopes` `read` and `write`, and the server offers `read`, `write` and `admin`
- **THEN** the screen SHALL check `read` and `write` and SHALL leave `admin` unchecked

#### Scenario: Entry names no scopes
- **WHEN** an entry has an empty `default_scopes` and the server offers three scopes
- **THEN** the screen SHALL check all three

### Requirement: Entry state comes from the connection status
A row SHALL show one of three states, from the connection status of the project's active servers that have the entry's key. A server with `flags.is_active` false SHALL be ignored. The states are: "Connect" when no server has the key; "Connected" when a server with the key has the status `connected`; "Needs sign-in" when servers have the key and each has the status `not_signed_in` or `login_expired`. A row SHALL NOT show "Connected" because a server has the key alone. A connected row SHALL offer "Connect another", and in Settings also "View". A "Needs sign-in" row SHALL offer "Sign in", which opens the existing reconnect for the first such server by `slug`.

#### Scenario: After connecting
- **WHEN** a person connects the Linear entry, finishes the sign-in, and returns to the catalog
- **THEN** the Linear row SHALL show "Connected"

#### Scenario: Sign-in not finished
- **WHEN** the project has a server with the Linear key whose OAuth sign-in is not finished
- **THEN** the Linear row SHALL show "Needs sign-in" and SHALL NOT show "Connected"

#### Scenario: Two servers need sign-in
- **WHEN** two servers have the Linear key and neither is signed in, and a person presses "Sign in"
- **THEN** the app SHALL open the reconnect for the first of the two by `slug`

#### Scenario: A server that is turned off
- **WHEN** the only server with the Linear key has `flags.is_active` false
- **THEN** the Linear row SHALL show "Connect"

#### Scenario: Second account
- **WHEN** a person presses "Connect another" on a connected row
- **THEN** the flow SHALL start with a name that no server in the project uses

#### Scenario: Server detail
- **WHEN** a person opens a server that has a catalog reference, and the entry exists
- **THEN** the detail SHALL show "From the catalog: <title>", and SHALL read that one entry, not the full list

#### Scenario: Server detail of a server added by URL
- **WHEN** a person opens a server with no catalog reference
- **THEN** the app SHALL make no catalog request

### Requirement: A notice when the entry has a new address
When a server has a catalog key and its `base_url` is not equal to the entry's current address (`connection.url` for `fixed_url`, `connection.url_template` for `templated_url`), the server's detail SHALL show a notice that the catalog has a new address, and the server's row in the Settings list SHALL show the state "New address". The notice SHALL show the old and the new host as plain text. It SHALL offer "Add at the new address", which opens the catalog connect for that entry and makes a new server. The app SHALL NOT change the existing server. For a `templated_url` entry, the comparison SHALL use the stored template with `{secret}`, and SHALL NOT use a URL with the key filled in.

#### Scenario: The entry URL changed
- **WHEN** a server was created from `linear` with URL A on `mcp.linear.app`, and a later release sets the entry's URL to B on `mcp2.linear.app`
- **THEN** the server's detail SHALL show the notice with `mcp.linear.app` and `mcp2.linear.app`, its Settings row SHALL show "New address", and the server SHALL keep URL A

#### Scenario: A templated-URL entry with a new template
- **WHEN** a server was created from a `templated_url` entry, and a later release changes the entry's `url_template`
- **THEN** the detail SHALL show the notice, and the app SHALL compare the stored template with the entry's template

#### Scenario: A templated-URL entry with the same template
- **WHEN** a server was created from a `templated_url` entry, and the entry's `url_template` did not change
- **THEN** the detail SHALL NOT show the notice

### Requirement: The app handles each catalog refusal
The app SHALL handle each catalog error code of the API with its own text from `@agenta/i18n`: `mcp_catalog_entry_not_found` and `mcp_catalog_auth_mode_not_offered`. Each SHALL offer "Custom server URL", except in the connect flow that the chat opens for an agent's request (capability `mcp-catalog-agent`).

#### Scenario: Entry gone before the create
- **WHEN** the create answers `mcp_catalog_entry_not_found`
- **THEN** the flow SHALL go to its create failure state, SHALL say that the server is no longer in the catalog, and SHALL offer "Custom server URL"

#### Scenario: Entry gone before the view opens
- **WHEN** the connect view reads the entry and gets `404`
- **THEN** the view SHALL show the same message and SHALL start no journey

#### Scenario: Auth mode not offered
- **WHEN** the create answers `mcp_catalog_auth_mode_not_offered`
- **THEN** the flow SHALL go to its create failure state, as for any refused create, and SHALL show the catalog message there

### Requirement: Custom server URL stays available
Each place that shows the catalog SHALL offer "Custom server URL" in every state: loading, error, no match, empty and filled. It SHALL open today's by-URL connect flow, with nothing filled in, which creates a server with no catalog reference.

#### Scenario: Server not in the catalog
- **WHEN** a person presses "Custom server URL" in the catalog
- **THEN** the app SHALL open the connect flow at the URL step, with nothing filled in

#### Scenario: Empty catalog
- **WHEN** the catalog has no entries and a person presses "Connect MCP"
- **THEN** the catalog view SHALL open, SHALL say that the catalog is empty, and SHALL offer "Custom server URL"

#### Scenario: Catalog request fails
- **WHEN** the list request fails
- **THEN** the view SHALL show the notice with "Retry", and "Custom server URL"

#### Scenario: No match
- **WHEN** no entry matches the search
- **THEN** the catalog SHALL say so, SHALL keep the typed text, and SHALL offer "Custom server URL"

### Requirement: Shared components, entry data and page weight
The catalog SHALL draw its rows with the list row, logo, skeleton, notice and chip components that the Composio catalog UI uses, and SHALL NOT add parallel ones. The logo SHALL be drawn by the shared logo component, which renders an `<img>` element from the entry's `logo_url`, sends no referrer, and shows the default mark when the image does not load. Every text the app owns SHALL come from `@agenta/i18n`; the entry's title and description SHALL be shown as plain text from the API. The app SHALL NOT copy the entry's description into a server row. The web SHALL NOT put the description in a model's context; the one path to a model is the discover answer for the builder agent (capability `mcp-catalog-agent`). The app SHALL validate each catalog answer with a zod schema at the API boundary, and the entry types SHALL come from that schema.

#### Scenario: Entry that does not match the schema
- **WHEN** one entry in the list answer has a `connection.kind` that the schema does not know
- **THEN** the app SHALL log the problem, SHALL leave that entry out, and SHALL show the other entries

#### Scenario: Phone width
- **WHEN** the catalog is 375 px wide
- **THEN** the rows SHALL fit the width, and the page SHALL NOT scroll sideways

#### Scenario: Settings page weight
- **WHEN** a person opens Settings > MCPs and does not open the catalog
- **THEN** the page SHALL NOT load the catalog view's code and SHALL NOT request the catalog list

#### Scenario: Settings with no catalog servers
- **WHEN** a person opens Settings > MCPs, and no server in the project has a catalog key
- **THEN** the page SHALL make no catalog request
