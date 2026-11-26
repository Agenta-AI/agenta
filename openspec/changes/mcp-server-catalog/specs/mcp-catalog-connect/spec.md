## ADDED Requirements

### Requirement: A catalog entry prefills the existing create
The create route `POST /gateways/mcps/endpoints/` SHALL accept an optional `catalog_entry_key` on the endpoint. There SHALL be no separate create body for the catalog. With a key, the request MAY leave out `data.route.base_url` when it sends no credential binding. The web client SHALL still send the route fields that a create without a key would send, so that a create works against a pod that does not know the key: for a `fixed_url` entry, the entry's `url` as `base_url` and, for `api_key`, the option's binding; for a `templated_url` entry, the mode `api_key`, the template with `{secret}` as `base_url` and the binding `{kind: "url"}`. The create SHALL need no `secret_id` for a `templated_url` entry. The request SHALL pass the model validation of the create body before the catalog code runs: a request that fails it SHALL get `422`, as for any create. For a request that passes it, the system SHALL overwrite these fields from the entry. The system SHALL set the new server's address from the entry's `connection`. It SHALL set `data.route.credential_binding` from the entry for an `api_key` server, to the URL binding for a `templated_url` entry, and to null for an `oauth` or `none` server. The entry's values SHALL win over the values in the request for these fields. The system SHALL apply the same permission (`EDIT_MCP_ENDPOINTS`) and the same display-name check as for a create without a key. The system SHALL add no new connect, probe, OAuth or callback route.

#### Scenario: Connect Linear with OAuth
- **WHEN** a project editor creates an endpoint with `catalog_entry_key` `linear`, `auth_mode` `oauth` and no `base_url`
- **THEN** the system SHALL create a project MCP server whose URL is the entry's `connection.url`, and the existing `connect` route SHALL run discovery and consent for it

#### Scenario: Request carries another URL
- **WHEN** a create request has `catalog_entry_key` `linear` and a `base_url` of `https://other.example/mcp`
- **THEN** the system SHALL create the server with the entry's URL and SHALL NOT store the URL from the request

#### Scenario: API key in a header
- **WHEN** a project editor creates an endpoint from an entry whose `api_key` option binds the header `Authorization` with the prefix `Bearer`, and picks a project secret
- **THEN** the server's `credential_binding` SHALL be the entry's, and its `secret_id` SHALL be the picked secret

#### Scenario: Request that fails model validation
- **WHEN** a create request has `catalog_entry_key` `linear`, a `credential_binding` of kind `url` and no `base_url`
- **THEN** the system SHALL answer `422` before the catalog code runs, and SHALL write no row

#### Scenario: templated-URL entry from the web
- **WHEN** the web creates a server from a `templated_url` entry
- **THEN** the request SHALL hold the mode `api_key`, the entry's template with `{secret}` as `base_url` and the binding `{kind: "url"}`, and SHALL hold no `secret_id`

#### Scenario: Request carries a binding for an OAuth server
- **WHEN** a create request has `catalog_entry_key` `linear`, `auth_mode` `oauth` and a `credential_binding`
- **THEN** the stored server SHALL have no `credential_binding`

#### Scenario: Name already used
- **WHEN** the project has a server named "Linear" and a person connects the Linear entry again with the same name
- **THEN** the system SHALL refuse with the existing code `mcp_connection_name_taken`, and the connect flow SHALL go back to the name screen with the refusal and ask for another name, as it does for a server added by URL

### Requirement: The guards run on the address that is stored
The MCP gateway service's create SHALL apply the entry to the endpoint with one call to the catalog service, before it checks the URL, for every caller and not only the create route. That call SHALL return the request unchanged when it has no `catalog_entry_key`. The URL guard that a custom server gets SHALL run on the entry's URL, not on the URL in the request. The applied endpoint SHALL be built by model validation from values that the reader validated at load, so that applying an entry does not fail a model rule. The catalog SHALL add no exemption to the outbound guard. The code that applies an entry SHALL be one pure function with no I/O.

#### Scenario: Request URL is one the egress guard refuses
- **WHEN** a create request has `catalog_entry_key` `linear` and a `base_url` that the egress guard refuses
- **THEN** the system SHALL check the entry's URL, SHALL create the server with it, and SHALL NOT refuse because of the request's URL

#### Scenario: A caller other than the route
- **WHEN** code calls the MCP gateway service's create directly with `catalog_entry_key` `linear`
- **THEN** the stored row SHALL have the entry's URL and binding, exactly as for a create through the route

#### Scenario: Entry URL that the deployment refuses
- **WHEN** a create has `catalog_entry_key` `linear` and the deployment's egress policy refuses the entry's URL
- **THEN** the system SHALL answer `400` with the code `mcp_endpoint_url_refused` and SHALL write no row

#### Scenario: Entry URL resolves to a blocked address
- **WHEN** a catalog URL resolves to a blocked address range when a call is made
- **THEN** the outbound guard SHALL refuse the call, as for a server added by URL

#### Scenario: Entry that a model rule refuses
- **WHEN** an entry in the catalog file has a route that an MCP endpoint validator refuses
- **THEN** the reader SHALL refuse the entry at load, and a create with its key SHALL answer `404` with the code `mcp_catalog_entry_not_found`

### Requirement: Create refuses an entry it cannot use
With `catalog_entry_key` set, the system SHALL refuse the create when no entry has the key (`404`, code `mcp_catalog_entry_not_found`), or when the request's `auth_mode` is not one that the entry offers (`400`, code `mcp_catalog_auth_mode_not_offered`). Each refusal SHALL use the gateway error envelope with `retryable` false and a `next_step`. A refused create SHALL write no row. The MCP gateway service SHALL always have the catalog service, and SHALL have no mode that drops a key.

#### Scenario: Unknown key
- **WHEN** a create request has `catalog_entry_key` `nope`
- **THEN** the system SHALL answer `404` with the code `mcp_catalog_entry_not_found` and SHALL write no row

#### Scenario: Entry removed in a release
- **WHEN** a release removed the `linear` entry from the catalog file, and a create request has `catalog_entry_key` `linear`
- **THEN** the system SHALL answer `404` with the code `mcp_catalog_entry_not_found`

#### Scenario: Auth mode not offered
- **WHEN** a create request has `auth_mode` `none` for an entry that offers only `oauth`
- **THEN** the system SHALL answer `400` with the code `mcp_catalog_auth_mode_not_offered`, and `details` SHALL list the modes the entry offers

#### Scenario: OAuth for a templated-URL entry
- **WHEN** a create request has `auth_mode` `oauth` for an entry with a `templated_url` connection
- **THEN** the system SHALL answer `400` with the code `mcp_catalog_auth_mode_not_offered`

### Requirement: A server from a card is a `custom` row
A server created from an entry SHALL be a row in `mcps_endpoints` in the namespace `custom`. It SHALL NOT be a `standard` endpoint. Agent references, the relay and the agent builder SHALL treat it as any custom server.

#### Scenario: Agent builder
- **WHEN** a project has a server created from the Linear entry
- **THEN** the agent's "Add MCP server" list SHALL show it with the project's other `custom` rows

#### Scenario: Agent template
- **WHEN** a bundled agent template declares an MCP server whose URL is equal to an entry's URL, and the project has a server from that entry
- **THEN** the template SHALL find that server by its URL, as it finds a server added by URL today

### Requirement: A connected server keeps its own copy and a reference
A server created from an entry SHALL store its own URL and auth settings in its row, as every MCP server does. It SHALL also store a catalog reference: `catalog_entry_key`, the entry's key. The system SHALL accept `catalog_entry_key` as input on create only. A null `catalog_entry_key` SHALL be absent from the JSON answer. The system SHALL NOT read an entry to route or authenticate a call to a connected server. For a `templated_url` entry, the row SHALL store the template with `{secret}`, and the system SHALL NOT store, log or return a URL with the person's key filled in.

#### Scenario: Entry removed in a later release
- **WHEN** a release removes the `linear` entry, and a project has a server created from it
- **THEN** the server SHALL keep working with its stored URL and credentials, and its `catalog_entry_key` SHALL stay `linear`

#### Scenario: Entry URL changed in a later release
- **WHEN** a release changes the `connection.url` of the `linear` entry
- **THEN** existing servers SHALL keep their stored URL and their `catalog_entry_key`, and a server created after the release SHALL get the new URL

#### Scenario: templated-URL server
- **WHEN** a person connects a `templated_url` entry with a project secret
- **THEN** the stored `base_url` SHALL be the entry's template with `{secret}`, and the relay SHALL put the key in only when it sends a call

#### Scenario: Server added by URL
- **WHEN** a person creates a server with no `catalog_entry_key`
- **THEN** the system SHALL create it exactly as today, and the answer SHALL hold no `catalog_entry_key`

### Requirement: An edit keeps the reference unless the address moves
An edit of a server SHALL keep `catalog_entry_key` when the server's `base_url` does not change. An edit that changes the `base_url` SHALL set `catalog_entry_key` to null, in the same write as the edit and under the same row lock. The rule SHALL be an exact comparison of the stored and the new `base_url` strings. An edit that changes only the auth mode or the credential binding at the same URL SHALL keep the key. The rule SHALL apply on every deployment, with or without an OAuth refresher.

#### Scenario: Rename
- **WHEN** a person changes only the name of a server that has a reference
- **THEN** the reference SHALL stay

#### Scenario: URL changed through the API
- **WHEN** a caller edits a server that has a reference with a `PUT` that changes its `base_url`
- **THEN** the system SHALL clear `catalog_entry_key` on that server

#### Scenario: Auth mode changed at the same URL
- **WHEN** a person moves a catalog server from OAuth to an API key and keeps its `base_url`
- **THEN** `catalog_entry_key` SHALL stay

#### Scenario: Key replaced in a catalog journey
- **WHEN** a person replaces a refused key on a catalog server, and the flow saves the row with the entry's URL and the entry's binding
- **THEN** the row SHALL hold the entry's binding, and the reference SHALL stay

#### Scenario: No OAuth refresher
- **WHEN** the service runs with no OAuth refresher, and an edit changes the `base_url` of a server that has a reference
- **THEN** the system SHALL clear the reference

### Requirement: A templated-URL entry is checked with its key
For an entry with a `templated_url` connection, the connect flow SHALL NOT probe the address without a secret. It SHALL ask for the project secret first and SHALL check the address with that secret before it creates the server.

#### Scenario: Connect a templated-URL entry
- **WHEN** a person presses Connect on a templated-URL entry
- **THEN** the flow SHALL open on the screen that asks for the secret, with the API key mode set, and SHALL send no probe before the person picks a secret

#### Scenario: Wrong key
- **WHEN** the check with the picked secret fails
- **THEN** the flow SHALL show the existing key refusal and SHALL create no server

### Requirement: Ownership and sign-in do not change
A server created from an entry SHALL be a project's MCP server. Its sign-in SHALL be the project's or each person's own, through the existing `connect` route and its `owner_kind` parameter (`project` or `user`). The catalog SHALL add no owner kind, and SHALL be the same for every organization, project and person.

#### Scenario: Personal sign-in to a catalog server
- **WHEN** a project has a server created from an OAuth entry, and a member calls `connect` with `owner_kind=user`
- **THEN** the system SHALL write that member's own sign-in, as for any project MCP server

#### Scenario: Two projects
- **WHEN** two projects each connect the same entry
- **THEN** each project SHALL have its own server row and its own credentials

### Requirement: Composio stays separate
The MCP catalog SHALL NOT list Composio integrations, and a Composio connection SHALL NOT get a catalog reference. The Composio catalog routes and the `gateway_connections` table SHALL NOT change.

#### Scenario: Same vendor in both
- **WHEN** GitHub is a Composio integration and also an MCP catalog entry
- **THEN** connecting the MCP catalog entry SHALL create a row in `mcps_endpoints` only, and SHALL NOT create or change a row in `gateway_connections`
